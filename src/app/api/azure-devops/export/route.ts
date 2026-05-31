export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  JsonPatchDocument,
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import db from "@/lib/db";
import type { Task } from "@/types";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import {
  createAzureDevOpsConnectionContext,
  getAzureDevOpsSettingsForUser,
  getStoredAzureDevOpsUserIdentity,
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";
import { displayWorkItemStatus, upsertExternalLink } from "@/lib/work-items";

interface ExportRequest {
  taskId: number;
  parentWorkItemId?: number;
}

const getAzureDevOpsAssignmentValue = (
  userId: number,
  projectId: number
): string | null => {
  const identity = getStoredAzureDevOpsUserIdentity(userId, projectId);
  return (
    identity?.uniqueName?.trim() ||
    identity?.displayName?.trim() ||
    identity?.descriptor?.trim() ||
    identity?.id?.trim() ||
    null
  );
};

const isUnsupportedStateError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    (message.includes("field 'state'") ||
      message.includes('field "state"') ||
      message.includes("system.state")) &&
    (message.includes("supported values") ||
      message.includes("allowed values") ||
      message.includes("invalid value"))
  );
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body: ExportRequest = await request.json();
    const { taskId, parentWorkItemId } = body;

    if (!taskId) {
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
    }

    const task = db
      .prepare(
        `
          SELECT
            wi.*,
            wi.assigned_user_id AS user_id,
            link.external_id,
            link.provider AS external_source
          FROM work_items wi
          LEFT JOIN work_item_external_links link
            ON link.work_item_id = wi.id
            AND link.provider = 'azure_devops'
          WHERE wi.id = ?
            AND wi.assigned_user_id = ?
            AND wi.project_id = ?
            AND wi.type IN ('task', 'bug')
        `
      )
      .get(taskId, userId, projectId) as Task | undefined;

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.external_source === "azure_devops" && task.external_id) {
      return NextResponse.json(
        { error: "Task is already linked to Azure DevOps" },
        { status: 400 }
      );
    }

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json({ error: settingsResult.message }, { status: 400 });
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);
    const assigneeUserId = task.user_id ?? userId;
    const assignedUserIdentity = getStoredAzureDevOpsUserIdentity(assigneeUserId, projectId);
    const assignedUserValue = getAzureDevOpsAssignmentValue(assigneeUserId, projectId);
    const workItemType = task.type === "bug" ? "Bug" : "Task";
    const nativeStatus = displayWorkItemStatus(task.status);

    const buildPatchDocument = (includeState: boolean): JsonPatchDocument => {
      const patchOperations: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/fields/System.Title",
          value: task.title,
        } as JsonPatchOperation,
      ];

      if (task.description) {
        patchOperations.push({
          op: Operation.Add,
          path: "/fields/System.Description",
          value: task.description,
        } as JsonPatchOperation);
      }

      if (assignedUserValue) {
        patchOperations.push({
          op: Operation.Add,
          path: "/fields/System.AssignedTo",
          value: assignedUserValue,
        } as JsonPatchOperation);
      }

      if (includeState && task.status) {
        patchOperations.push({
          op: Operation.Add,
          path: "/fields/System.State",
          value: nativeStatus,
        } as JsonPatchOperation);
      }

      if (parentWorkItemId) {
        patchOperations.push({
          op: Operation.Add,
          path: "/relations/-",
          value: {
            rel: "System.LinkTypes.Hierarchy-Reverse",
            url: `https://dev.azure.com/${settings.organization}/_apis/wit/workItems/${parentWorkItemId}`,
            attributes: {
              comment: "Parent work item",
            },
          },
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
      if (!task.status || !isUnsupportedStateError(error)) throw error;
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

    if (!createdWorkItem?.id) {
      return NextResponse.json(
        { error: "Failed to create work item in Azure DevOps" },
        { status: 500 }
      );
    }

    upsertExternalLink({
      workItemId: task.id,
      projectId,
      provider: "azure_devops",
      externalId: createdWorkItem.id,
      nativeType: workItemType,
      nativeStatus,
      nativeAssigneeId: assignedUserIdentity?.id ?? assignedUserIdentity?.descriptor ?? null,
      nativeAssigneeName: assignedUserIdentity?.displayName ?? null,
      nativeAssigneeUniqueName: assignedUserIdentity?.uniqueName ?? null,
      nativeAssigneeIsCurrentUser: assigneeUserId === userId,
      sanitizedSnapshot: {
        id: createdWorkItem.id,
        title: task.title,
        type: workItemType,
        state: nativeStatus,
      },
    });

    db.prepare(
      `
        UPDATE work_items
        SET sync_state = 'synced',
            updated_by_user_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND project_id = ?
      `
    ).run(userId, task.id, projectId);

    return NextResponse.json({
      success: true,
      workItemId: createdWorkItem.id,
      message: `Successfully exported to Azure DevOps as work item #${createdWorkItem.id}`,
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Error exporting to Azure DevOps:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export to Azure DevOps" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json({ error: settingsResult.message }, { status: 400 });
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
        FROM WorkItems
        WHERE ([System.WorkItemType] = 'User Story'
          OR [System.WorkItemType] = 'Feature'
          OR [System.WorkItemType] = 'Epic'
          OR [System.WorkItemType] = 'Product Backlog Item')
          AND [System.TeamProject] = @project
          AND [System.State] <> 'Closed'
          AND [System.State] <> 'Removed'
          AND [System.State] <> 'Done'
        ORDER BY [System.ChangedDate] DESC
      `,
    };

    const queryResult = await witApi.queryByWiql(wiql, { project: settings.project });
    const workItemIds = queryResult?.workItems?.map((wi) => wi.id!).filter(Boolean) || [];

    if (workItemIds.length === 0) {
      return NextResponse.json({ parentWorkItems: [] });
    }

    const workItems = await witApi.getWorkItems(
      workItemIds.slice(0, 100),
      undefined,
      undefined,
      undefined,
      undefined
    );

    const parentWorkItems = (workItems || [])
      .filter((wi) => wi.id && wi.fields)
      .map((wi) => ({
        id: wi.id!,
        title: wi.fields?.["System.Title"] || "Untitled",
        type: wi.fields?.["System.WorkItemType"] || "Unknown",
        state: wi.fields?.["System.State"] || "Unknown",
      }));

    return NextResponse.json({ parentWorkItems });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Error fetching parent work items:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch parent work items" },
      { status: 500 }
    );
  }
}
