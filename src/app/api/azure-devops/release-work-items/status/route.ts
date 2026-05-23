export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  JsonPatchDocument,
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import db from "@/lib/db";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";
import {
  createAzureDevOpsConnectionContext,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";

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

const COMPLETED_STATUSES = ["closed", "resolved", "done", "completed"];

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

    const releaseWorkItem = db
      .prepare(
        `
          SELECT id, project_id, external_id, external_source, state
          FROM release_work_items
          WHERE id = ? AND project_id = ?
        `
      )
      .get(releaseWorkItemId, projectId) as
      | {
          id: number;
          project_id: number;
          external_id: string | null;
          external_source: string | null;
          state: string | null;
        }
      | undefined;

    if (!releaseWorkItem) {
      return NextResponse.json({ error: "Release work item not found" }, { status: 404 });
    }

    if (
      releaseWorkItem.external_source !== "azure_devops" ||
      !releaseWorkItem.external_id
    ) {
      return NextResponse.json(
        { error: "Only Azure DevOps release work items can be synced" },
        { status: 400 }
      );
    }

    const externalWorkItemId = Number.parseInt(releaseWorkItem.external_id, 10);
    if (!Number.isInteger(externalWorkItemId) || externalWorkItemId <= 0) {
      return NextResponse.json(
        { error: "Invalid Azure DevOps work item id" },
        { status: 400 }
      );
    }

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json(
        { error: settingsResult.message },
        { status: 400 }
      );
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

    db.prepare(
      `
        UPDATE release_work_items
        SET state = ?
        WHERE project_id = ?
          AND external_source = 'azure_devops'
          AND external_id IS NOT NULL
          AND CAST(external_id AS INTEGER) = ?
      `
    ).run(status, projectId, externalWorkItemId);

    const isCompleted = COMPLETED_STATUSES.includes(status.toLowerCase());
    const tasks = db
      .prepare(
        `
          SELECT id, status
          FROM tasks
          WHERE project_id = ?
            AND external_source = 'azure_devops'
            AND external_id IS NOT NULL
            AND CAST(external_id AS INTEGER) = ?
        `
      )
      .all(projectId, externalWorkItemId) as Array<{
      id: number;
      status: string | null;
    }>;

    const updateTaskStatusOnly = db.prepare(
      "UPDATE tasks SET status = ? WHERE id = ? AND project_id = ?"
    );
    const updateTaskCompletedAt = db.prepare(
      "UPDATE tasks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?"
    );
    const clearTaskCompletedAt = db.prepare(
      "UPDATE tasks SET status = ?, completed_at = NULL WHERE id = ? AND project_id = ?"
    );

    for (const task of tasks) {
      const wasCompleted = task.status
        ? COMPLETED_STATUSES.includes(task.status.toLowerCase())
        : false;
      if (isCompleted && !wasCompleted) {
        updateTaskCompletedAt.run(status, task.id, projectId);
      } else if (!isCompleted && wasCompleted) {
        clearTaskCompletedAt.run(status, task.id, projectId);
      } else {
        updateTaskStatusOnly.run(status, task.id, projectId);
      }
    }

    return NextResponse.json({
      success: true,
      synced: true,
      status,
      workItemId: externalWorkItemId,
    });
  } catch (error) {
    console.error("Release work item status update error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update release work item status", details: message },
      { status: 500 }
    );
  }
}
