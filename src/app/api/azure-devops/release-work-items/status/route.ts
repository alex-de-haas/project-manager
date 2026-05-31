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

interface UpdateReleaseWorkItemStatusRequest {
  releaseWorkItemId?: number;
  status?: string;
}

const normalizeStatus = (value?: string): string | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "new") return "New";
  if (normalized === "active") return "Active";
  if (normalized === "resolved") return "Resolved";
  if (normalized === "closed") return "Closed";
  return null;
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = (await request.json()) as UpdateReleaseWorkItemStatusRequest;
    const releaseWorkItemId = Number(body.releaseWorkItemId);
    const status = normalizeStatus(body.status);

    if (!Number.isInteger(releaseWorkItemId) || releaseWorkItemId <= 0 || !status) {
      return NextResponse.json(
        { error: "releaseWorkItemId and status are required" },
        { status: 400 }
      );
    }

    const row = db
      .prepare(
        `
          SELECT
            wi.id AS work_item_id,
            wi.title,
            link.external_id,
            link.native_type
          FROM release_items ri
          INNER JOIN work_items wi ON wi.id = ri.work_item_id
          INNER JOIN work_item_external_links link
            ON link.work_item_id = wi.id
            AND link.provider = 'azure_devops'
          WHERE ri.id = ?
            AND wi.project_id = ?
        `
      )
      .get(releaseWorkItemId, projectId) as
      | {
          work_item_id: number;
          title: string;
          external_id: string;
          native_type: string | null;
        }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "Release work item not found" },
        { status: 404 }
      );
    }

    const externalWorkItemId = Number.parseInt(row.external_id, 10);
    if (!Number.isInteger(externalWorkItemId) || externalWorkItemId <= 0) {
      return NextResponse.json(
        { error: "Invalid Azure DevOps work item id" },
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
    ).run(normalizedStatus, normalizedStatus, userId, row.work_item_id, projectId);

    upsertExternalLink({
      workItemId: row.work_item_id,
      projectId,
      provider: "azure_devops",
      externalId: externalWorkItemId,
      nativeType: row.native_type,
      nativeStatus: status,
    });

    return NextResponse.json({
      success: true,
      synced: true,
      status,
      workItemId: externalWorkItemId,
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Release work item status update error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update release work item status", details: message },
      { status: 500 }
    );
  }
}
