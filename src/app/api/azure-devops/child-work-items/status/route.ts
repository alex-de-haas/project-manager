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
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";
import {
  mapAzureDevOpsStatusToWorkItemStatus,
  upsertExternalLink,
} from "@/lib/work-items";

interface UpdateChildStatusRequest {
  workItemId?: number;
  workItemType?: string;
  status?: string;
}

const normalizeType = (value?: string): "task" | "bug" | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "task") return "task";
  if (normalized === "bug") return "bug";
  return null;
};

const normalizeStatus = (value?: string): string | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "new") return "New";
  if (normalized === "active") return "Active";
  if (normalized === "resolved") return "Resolved";
  if (normalized === "closed") return "Closed";
  return null;
};

const getAllowedStatuses = (workItemType: "task" | "bug"): string[] =>
  workItemType === "bug" ? ["New", "Active", "Resolved", "Closed"] : ["New", "Active", "Closed"];

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = (await request.json()) as UpdateChildStatusRequest;
    const externalWorkItemId = Number(body.workItemId);
    const workItemType = normalizeType(body.workItemType);
    const status = normalizeStatus(body.status);

    if (!Number.isInteger(externalWorkItemId) || externalWorkItemId <= 0 || !workItemType || !status) {
      return NextResponse.json(
        { error: "workItemId, workItemType and status are required" },
        { status: 400 }
      );
    }

    const allowedStatuses = getAllowedStatuses(workItemType);
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Status "${status}" is not allowed for ${workItemType}` },
        { status: 400 }
      );
    }

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json({ error: settingsResult.message }, { status: 400 });
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);
    const patchDocument: JsonPatchDocument = [
      {
        op: Operation.Add,
        path: "/fields/System.State",
        value: status,
      } as JsonPatchOperation,
    ];

    await witApi.updateWorkItem(
      undefined,
      patchDocument,
      externalWorkItemId,
      settings.project
    );

    const linked = db
      .prepare(
        `
          SELECT wi.id, link.native_type
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
      | { id: number; native_type: string | null }
      | undefined;

    if (linked) {
      const normalizedStatus = mapAzureDevOpsStatusToWorkItemStatus(status);
      db.prepare(
        `
          UPDATE work_items
          SET status = ?,
              completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
              sync_state = 'synced',
              updated_by_user_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND project_id = ?
        `
      ).run(normalizedStatus, normalizedStatus, userId, linked.id, projectId);

      upsertExternalLink({
        workItemId: linked.id,
        projectId,
        provider: "azure_devops",
        externalId: externalWorkItemId,
        nativeType: linked.native_type ?? (workItemType === "bug" ? "Bug" : "Task"),
        nativeStatus: status,
      });
    }

    return NextResponse.json({
      success: true,
      synced: true,
      status,
      workItemId: externalWorkItemId,
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Child work item status update error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update child work item status", details: message },
      { status: 500 }
    );
  }
}
