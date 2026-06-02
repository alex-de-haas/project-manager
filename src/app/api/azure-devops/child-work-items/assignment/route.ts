export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  JsonPatchDocument,
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import db from "@/lib/db";
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
import { getUserProjectMembership, upsertExternalLink } from "@/lib/work-items";

interface AssignChildWorkItemRequest {
  workItemId?: number;
  userId?: number;
}

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

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

export async function POST(request: NextRequest) {
  try {
    const currentUserId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, currentUserId);
    const body = (await request.json()) as AssignChildWorkItemRequest;
    const externalWorkItemId = parsePositiveInteger(body.workItemId);
    const assignedUserId = parsePositiveInteger(body.userId);

    if (!externalWorkItemId || !assignedUserId) {
      return NextResponse.json(
        { error: "workItemId and userId are required" },
        { status: 400 }
      );
    }

    const assignedUser = getUserProjectMembership(projectId, assignedUserId);
    if (!assignedUser) {
      return NextResponse.json(
        { error: "Selected user is not assigned to this project" },
        { status: 400 }
      );
    }

    const targetAzureDevOpsAssignee = getAzureDevOpsAssignmentValue(assignedUserId, projectId);
    if (!targetAzureDevOpsAssignee) {
      return NextResponse.json(
        {
          error:
            "Selected user has no Azure DevOps account link for this project. Ask the user to link Azure DevOps in Profile first.",
        },
        { status: 400 }
      );
    }

    const linked = db
      .prepare(
        `
          SELECT
            wi.id,
            link.native_type,
            link.native_status
          FROM work_item_external_links link
          INNER JOIN work_items wi ON wi.id = link.work_item_id
          WHERE link.project_id = ?
            AND link.provider = 'azure_devops'
            AND link.external_id = ?
            AND wi.type IN ('task', 'bug')
          LIMIT 1
        `
      )
      .get(projectId, String(externalWorkItemId)) as
      | {
          id: number;
          native_type: string | null;
          native_status: string | null;
        }
      | undefined;

    if (!linked) {
      return NextResponse.json({ error: "Child work item not found" }, { status: 404 });
    }

    const settingsResult = getAzureDevOpsSettingsForUser(currentUserId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json({ error: settingsResult.message }, { status: 400 });
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);
    const patchDocument: JsonPatchDocument = [
      {
        op: Operation.Add,
        path: "/fields/System.AssignedTo",
        value: targetAzureDevOpsAssignee,
      } as JsonPatchOperation,
    ];

    await witApi.updateWorkItem(
      undefined,
      patchDocument,
      externalWorkItemId,
      settings.project
    );

    db.prepare(
      `
        UPDATE work_items
        SET assigned_user_id = ?,
            updated_by_user_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND project_id = ?
      `
    ).run(assignedUserId, currentUserId, linked.id, projectId);

    const assignedUserIdentity = getStoredAzureDevOpsUserIdentity(assignedUserId, projectId);
    upsertExternalLink({
      workItemId: linked.id,
      projectId,
      provider: "azure_devops",
      externalId: externalWorkItemId,
      nativeType: linked.native_type,
      nativeStatus: linked.native_status,
      nativeAssigneeId: assignedUserIdentity?.id ?? assignedUserIdentity?.descriptor ?? null,
      nativeAssigneeName: assignedUserIdentity?.displayName ?? assignedUser.name ?? null,
      nativeAssigneeUniqueName: assignedUserIdentity?.uniqueName ?? assignedUser.email ?? null,
      nativeAssigneeIsCurrentUser: assignedUserId === currentUserId,
    });

    return NextResponse.json({
      success: true,
      synced: true,
      workItemId: externalWorkItemId,
      assignedUserId,
      assignedTo:
        assignedUserIdentity?.displayName ||
        assignedUserIdentity?.uniqueName ||
        assignedUser.name ||
        assignedUser.email ||
        `User ${assignedUserId}`,
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Child work item assignment update error:", error);
    return NextResponse.json(
      {
        error: "Failed to assign child work item",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
