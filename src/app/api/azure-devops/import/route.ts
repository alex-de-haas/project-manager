export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import * as azdev from 'azure-devops-node-api';
import { WorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import db from '@/lib/db';
import type { Settings, AzureDevOpsSettings, Task } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

interface ImportRequest {
  workItemIds?: number[];
  query?: string;
  assignedToMe?: boolean;
}

const getUserEmail = (userId: number): string | null => {
  const user = db
    .prepare('SELECT email FROM users WHERE id = ?')
    .get(userId) as { email?: string | null } | undefined;
  return user?.email?.trim() || null;
};

const escapeWiqlString = (value: string): string => value.replace(/'/g, "''");

const hasCurrentProjectScope = (query: string, project: string): boolean => {
  const normalizedQuery = query.replace(/\s+/g, " ").toLowerCase();
  const normalizedProject = escapeWiqlString(project).toLowerCase();
  return (
    normalizedQuery.includes("system.teamproject") &&
    (normalizedQuery.includes("@project") ||
      normalizedQuery.includes(`'${normalizedProject}'`))
  );
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body: ImportRequest = await request.json();
    const userEmail = getUserEmail(userId);

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Current user email is required to import assigned work items.' },
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

    let workItemIds: number[] = [];

    // Determine which work items to import
    if (body.workItemIds && body.workItemIds.length > 0) {
      workItemIds = body.workItemIds;
    } else if (body.assignedToMe) {
      // Query for work items assigned to the authenticated app user
      const escapedUserEmail = escapeWiqlString(userEmail);
      const wiql = {
        query: `
          SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
          FROM WorkItems
          WHERE [System.AssignedTo] = '${escapedUserEmail}'
            AND [System.TeamProject] = @project
            AND [System.State] <> 'Closed'
            AND [System.State] <> 'Removed'
          ORDER BY [System.ChangedDate] DESC
        `
      };

      const queryResult = await witApi.queryByWiql(wiql, { project: settings.project });
      workItemIds = queryResult?.workItems?.map(wi => wi.id!).filter(Boolean) || [];
    } else if (body.query) {
      // Custom WIQL query
      if (!hasCurrentProjectScope(body.query, settings.project)) {
        return NextResponse.json(
          {
            error:
              "Custom WIQL queries must include a System.TeamProject filter for the configured project.",
          },
          { status: 400 }
        );
      }
      const wiql = { query: body.query };
      const queryResult = await witApi.queryByWiql(wiql, { project: settings.project });
      workItemIds = queryResult?.workItems?.map(wi => wi.id!).filter(Boolean) || [];
    } else {
      return NextResponse.json(
        { error: 'No work items specified. Provide workItemIds, set assignedToMe=true, or provide a WIQL query.' },
        { status: 400 }
      );
    }

    if (workItemIds.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, message: 'No work items found to import' });
    }

    // Fetch work item details
    const workItems = await witApi.getWorkItems(
      workItemIds,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const imported: Task[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const workItem of workItems || []) {
      if (!workItem.id || !workItem.fields) {
        continue;
      }

      const title = workItem.fields['System.Title'] as string || `Work Item ${workItem.id}`;
      const workItemType = (workItem.fields['System.WorkItemType'] as string || 'Task').toLowerCase();
      const status = workItem.fields['System.State'] as string || null;
      const tags = workItem.fields['System.Tags'] as string || null;
      const closedDate = workItem.fields['Microsoft.VSTS.Common.ClosedDate'] as string || 
                        workItem.fields['Microsoft.VSTS.Common.ResolvedDate'] as string || 
                        workItem.fields['System.ClosedDate'] as string || 
                        null;
      
      // Map Azure DevOps work item types to our task types
      let taskType: 'task' | 'bug' = 'task';
      if (workItemType === 'bug') {
        taskType = 'bug';
      }

      // Check if already imported
      const existing = db
        .prepare('SELECT id FROM tasks WHERE external_id = ? AND user_id = ? AND project_id = ?')
        .get(workItem.id, userId, projectId);
      
      if (existing) {
        skipped.push({ id: workItem.id, reason: 'Already imported' });
        continue;
      }

      // Get the current max display_order and add 1 for the new task
      const maxOrder = db
        .prepare('SELECT MAX(display_order) as max_order FROM tasks WHERE user_id = ? AND project_id = ?')
        .get(userId, projectId) as { max_order: number | null };
      const newOrder = (maxOrder.max_order ?? -1) + 1;

      // Insert task
      const stmt = db.prepare(`
        INSERT INTO tasks (user_id, project_id, title, type, status, tags, external_id, external_source, display_order, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'azure_devops', ?, ?)
      `);

      const result = stmt.run(
        userId,
        projectId,
        title,
        taskType,
        status,
        tags,
        workItem.id,
        newOrder,
        closedDate
      );
      
      const newTask = db
        .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
        .get(result.lastInsertRowid, userId, projectId) as Task;
      imported.push(newTask);
    }

    return NextResponse.json({
      imported: imported.length,
      skipped: skipped.length,
      tasks: imported,
      skippedDetails: skipped
    });

  } catch (error) {
    console.error('Azure DevOps import error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to import from Azure DevOps', details: errorMessage },
      { status: 500 }
    );
  }
}
