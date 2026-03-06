export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import * as azdev from 'azure-devops-node-api';
import { WorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import { JsonPatchDocument, JsonPatchOperation, Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import db from '@/lib/db';
import type { Settings, AzureDevOpsSettings, Task } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

interface ExportRequest {
  taskId: number;
  parentWorkItemId?: number;
}

const getUserEmail = (userId: number): string | null => {
  const user = db
    .prepare('SELECT email FROM users WHERE id = ?')
    .get(userId) as { email?: string | null } | undefined;
  return user?.email?.trim() || null;
};

const isUnsupportedStateError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const hasStateFieldMention =
    message.includes("field 'state'") || message.includes("field \"state\"") || message.includes("system.state");
  const hasUnsupportedValueMention =
    message.includes("supported values") ||
    message.includes("allowed values") ||
    message.includes("invalid value");

  return hasStateFieldMention && hasUnsupportedValueMention;
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body: ExportRequest = await request.json();
    const { taskId, parentWorkItemId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Get the task from database
    const task = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
      .get(taskId, userId, projectId) as Task | undefined;

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Check if task is already linked to Azure DevOps
    if (task.external_source === 'azure_devops' && task.external_id) {
      return NextResponse.json(
        { error: 'Task is already linked to Azure DevOps' },
        { status: 400 }
      );
    }

    // Get Azure DevOps settings
    const settingRow = db
      .prepare('SELECT id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?')
      .get('azure_devops', projectId) as Settings | undefined;
    
    if (!settingRow) {
      return NextResponse.json(
        { error: 'Azure DevOps settings not configured. Please configure in Settings.' },
        { status: 400 }
      );
    }

    let settings: AzureDevOpsSettings;
    try {
      settings = JSON.parse(settingRow.value) as AzureDevOpsSettings;
    } catch {
      return NextResponse.json(
        { error: 'Invalid Azure DevOps settings format' },
        { status: 400 }
      );
    }

    if (!settings.organization || !settings.project || !settings.pat) {
      return NextResponse.json(
        { error: 'Azure DevOps settings incomplete. Please check organization, project, and PAT.' },
        { status: 400 }
      );
    }

    // Create Azure DevOps connection
    const orgUrl = `https://dev.azure.com/${settings.organization}`;
    const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);

    const witApi: WorkItemTrackingApi = await connection.getWorkItemTrackingApi();

    // Use the task owner's email when setting assignment (supports release-planner user selection)
    const assigneeUserId = task.user_id ?? userId;
    const assignedUserEmail = getUserEmail(assigneeUserId);

    // Map local task type to Azure DevOps work item type
    const workItemType = task.type === 'bug' ? 'Bug' : 'Task';

    const buildPatchDocument = (includeState: boolean): JsonPatchDocument => {
      const patchOperations: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: '/fields/System.Title',
          value: task.title
        } as JsonPatchOperation,
      ];

      // Add assigned to only when we have the selected assignee's email
      if (assignedUserEmail) {
        patchOperations.push({
          op: Operation.Add,
          path: '/fields/System.AssignedTo',
          value: assignedUserEmail
        } as JsonPatchOperation);
      }

      // Try preserving local state, but this can be unsupported in custom Azure workflows.
      if (includeState && task.status) {
        patchOperations.push({
          op: Operation.Add,
          path: '/fields/System.State',
          value: task.status
        } as JsonPatchOperation);
      }

      // Add parent link if provided
      if (parentWorkItemId) {
        patchOperations.push({
          op: Operation.Add,
          path: '/relations/-',
          value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: `https://dev.azure.com/${settings.organization}/_apis/wit/workItems/${parentWorkItemId}`,
            attributes: {
              comment: 'Parent work item'
            }
          }
        } as JsonPatchOperation);
      }

      return patchOperations;
    };

    let createdWorkItem;
    try {
      createdWorkItem = await witApi.createWorkItem(
        undefined,
        buildPatchDocument(true),
        settings.project,
        workItemType
      );
    } catch (error) {
      // Fallback for projects where the local status is not valid for initial state.
      if (!task.status || !isUnsupportedStateError(error)) {
        throw error;
      }

      console.warn(
        `Azure DevOps export: retrying work item creation without System.State (taskId=${taskId}, status="${task.status}")`
      );
      createdWorkItem = await witApi.createWorkItem(
        undefined,
        buildPatchDocument(false),
        settings.project,
        workItemType
      );
    }

    if (!createdWorkItem || !createdWorkItem.id) {
      return NextResponse.json(
        { error: 'Failed to create work item in Azure DevOps' },
        { status: 500 }
      );
    }

    // Update local task to link to the new Azure DevOps work item
    db.prepare(`
      UPDATE tasks 
      SET external_id = ?, external_source = 'azure_devops' 
      WHERE id = ? AND user_id = ? AND project_id = ?
    `).run(createdWorkItem.id.toString(), taskId, userId, projectId);

    return NextResponse.json({
      success: true,
      workItemId: createdWorkItem.id,
      message: `Successfully exported to Azure DevOps as work item #${createdWorkItem.id}`
    });

  } catch (error) {
    console.error('Error exporting to Azure DevOps:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export to Azure DevOps' },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch potential parent work items
export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    // Get Azure DevOps settings
    const settingRow = db
      .prepare('SELECT id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?')
      .get('azure_devops', projectId) as Settings | undefined;
    
    if (!settingRow) {
      return NextResponse.json(
        { error: 'Azure DevOps settings not configured.' },
        { status: 400 }
      );
    }

    let settings: AzureDevOpsSettings;
    try {
      settings = JSON.parse(settingRow.value) as AzureDevOpsSettings;
    } catch {
      return NextResponse.json(
        { error: 'Invalid Azure DevOps settings format' },
        { status: 400 }
      );
    }

    if (!settings.organization || !settings.project || !settings.pat) {
      return NextResponse.json(
        { error: 'Azure DevOps settings incomplete.' },
        { status: 400 }
      );
    }

    // Create Azure DevOps connection
    const orgUrl = `https://dev.azure.com/${settings.organization}`;
    const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);

    const witApi: WorkItemTrackingApi = await connection.getWorkItemTrackingApi();

    // Query for potential parent work items (User Stories, Features, Epics, Product Backlog Items)
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
        FROM WorkItems
        WHERE ([System.WorkItemType] = 'User Story' 
          OR [System.WorkItemType] = 'Feature'
          OR [System.WorkItemType] = 'Epic'
          OR [System.WorkItemType] = 'Product Backlog Item')
          AND [System.State] <> 'Closed'
          AND [System.State] <> 'Removed'
          AND [System.State] <> 'Done'
        ORDER BY [System.ChangedDate] DESC
      `
    };

    const queryResult = await witApi.queryByWiql(wiql, { project: settings.project });
    const workItemIds = queryResult?.workItems?.map(wi => wi.id!).filter(Boolean) || [];

    if (workItemIds.length === 0) {
      return NextResponse.json({ parentWorkItems: [] });
    }

    // Limit to first 100 items
    const limitedIds = workItemIds.slice(0, 100);

    // Fetch work item details
    const workItems = await witApi.getWorkItems(
      limitedIds,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const parentWorkItems = (workItems || [])
      .filter(wi => wi.id && wi.fields)
      .map(wi => ({
        id: wi.id!,
        title: wi.fields?.['System.Title'] || 'Untitled',
        type: wi.fields?.['System.WorkItemType'] || 'Unknown',
        state: wi.fields?.['System.State'] || 'Unknown',
      }));

    return NextResponse.json({ parentWorkItems });
  } catch (error) {
    console.error('Error fetching parent work items:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch parent work items' },
      { status: 500 }
    );
  }
}
