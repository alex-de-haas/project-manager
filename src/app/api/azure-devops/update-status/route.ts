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
  getAzureDevOpsAuthenticatedUser,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";
import {
  isAzureDevOpsIdentityAssignedToUser,
  normalizeAzureDevOpsWorkItemIdentity,
} from "@/lib/azure-devops/identity";
import {
  applyLocalStatusChange,
  displayWorkItemStatus,
  mapAzureDevOpsStatusToWorkItemStatus,
  mapAzureDevOpsTypeToWorkItemType,
  markExternalLinkSyncFailed,
  upsertExternalLink,
} from "@/lib/work-items";

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const taskId = Number(body?.taskId ?? body?.id);
    const status = typeof body?.status === "string" ? body.status : "";

    if (!Number.isInteger(taskId) || taskId <= 0 || !status) {
      return NextResponse.json(
        { error: "Task ID and status are required" },
        { status: 400 }
      );
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

    const localUpdate = applyLocalStatusChange({
      workItemId: taskId,
      projectId,
      userId,
      status,
    });
    if (!localUpdate.ok) {
      return NextResponse.json({ error: localUpdate.error }, { status: 400 });
    }

    if (task.external_source !== "azure_devops" || !task.external_id) {
      return NextResponse.json({
        success: true,
        message: "Status updated successfully",
        localOnly: true,
      });
    }

    try {
      const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
      if (isAzureDevOpsConfigProblem(settingsResult)) {
        markExternalLinkSyncFailed(taskId, "azure_devops", settingsResult.message);
        return NextResponse.json({
          success: true,
          message: `Status updated locally. ${settingsResult.message}`,
          localOnly: true,
        });
      }

      const { settings, connection, witApi } =
        await createAzureDevOpsConnectionContext(settingsResult);
      const authenticatedUser = await getAzureDevOpsAuthenticatedUser(connection);
      const externalWorkItemId = Number.parseInt(task.external_id, 10);
      if (!Number.isInteger(externalWorkItemId) || externalWorkItemId <= 0) {
        return NextResponse.json({
          success: true,
          message: "Status updated locally. Invalid work item ID.",
          localOnly: true,
        });
      }

      const nativeStatus = displayWorkItemStatus(status);
      const patchOperations: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/fields/System.State",
          value: nativeStatus,
        } as JsonPatchOperation,
      ];

      const shouldUpdateCompletedWork =
        (task.type === "task" && nativeStatus === "Closed") ||
        (task.type === "bug" && nativeStatus === "Resolved");

      if (shouldUpdateCompletedWork) {
        const timeEntries = db
          .prepare(
            `
              SELECT SUM(hours) as total
              FROM time_entries
              WHERE work_item_id = ?
                AND user_id = ?
            `
          )
          .get(taskId, userId) as { total: number | null } | undefined;
        const totalHours = timeEntries?.total || 0;
        if (totalHours > 0) {
          patchOperations.push({
            op: Operation.Add,
            path: "/fields/Microsoft.VSTS.Scheduling.CompletedWork",
            value: totalHours,
          } as JsonPatchOperation);
        }
      }

      await witApi.updateWorkItem(
        undefined,
        patchOperations as JsonPatchDocument,
        externalWorkItemId,
        settings.project
      );

      const refreshedWorkItems = await witApi.getWorkItems(
        [externalWorkItemId],
        undefined,
        undefined,
        undefined,
        undefined
      );
      const refreshedWorkItem = refreshedWorkItems?.[0];

      if (refreshedWorkItem?.fields) {
        const title =
          (refreshedWorkItem.fields["System.Title"] as string) || task.title;
        const nativeType =
          (refreshedWorkItem.fields["System.WorkItemType"] as string) ||
          (task.type === "bug" ? "Bug" : "Task");
        const refreshedNativeStatus =
          (refreshedWorkItem.fields["System.State"] as string) || nativeStatus;
        const normalizedStatus = mapAzureDevOpsStatusToWorkItemStatus(
          refreshedNativeStatus
        );
        const tags = (refreshedWorkItem.fields["System.Tags"] as string) || null;
        const assignedTo = normalizeAzureDevOpsWorkItemIdentity(
          refreshedWorkItem.fields["System.AssignedTo"]
        );
        const isAssignedToCurrentUser = isAzureDevOpsIdentityAssignedToUser(
          assignedTo,
          authenticatedUser
        );
        const closedDate =
          (refreshedWorkItem.fields["Microsoft.VSTS.Common.ClosedDate"] as string) ||
          (refreshedWorkItem.fields["Microsoft.VSTS.Common.ResolvedDate"] as string) ||
          (refreshedWorkItem.fields["System.ClosedDate"] as string) ||
          null;

        db.prepare(
          `
            UPDATE work_items
            SET title = ?,
                type = ?,
                status = ?,
                tags = ?,
                completed_at = ?,
                sync_state = 'synced',
                updated_by_user_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
          `
        ).run(
          title,
          mapAzureDevOpsTypeToWorkItemType(nativeType),
          normalizedStatus,
          tags,
          normalizedStatus === "completed"
            ? closedDate || task.completed_at || new Date().toISOString()
            : null,
          userId,
          taskId,
          projectId
        );

        upsertExternalLink({
          workItemId: taskId,
          projectId,
          provider: "azure_devops",
          externalId: externalWorkItemId,
          nativeType,
          nativeStatus: refreshedNativeStatus,
          nativeAssigneeId: assignedTo?.id ?? null,
          nativeAssigneeName: assignedTo?.displayName ?? null,
          nativeAssigneeUniqueName: assignedTo?.uniqueName ?? null,
          nativeAssigneeIsCurrentUser: isAssignedToCurrentUser,
          sanitizedSnapshot: {
            id: externalWorkItemId,
            title,
            type: nativeType,
            state: refreshedNativeStatus,
            tags,
          },
        });
      }

      return NextResponse.json({
        success: true,
        message: "Status updated locally and synced with Azure DevOps",
        synced: true,
      });
    } catch (azureError) {
      const errorMessage =
        azureError instanceof Error ? azureError.message : "Unknown error";
      console.error("Azure DevOps update error:", azureError);
      markExternalLinkSyncFailed(taskId, "azure_devops", errorMessage);

      return NextResponse.json({
        success: true,
        message: `Status updated locally. Failed to sync with Azure DevOps: ${errorMessage}`,
        localOnly: true,
        azureError: errorMessage,
      });
    }
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Status update error:", error);
    return NextResponse.json(
      {
        error: "Failed to update status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
