export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import * as azdev from "azure-devops-node-api";
import { WorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  JsonPatchDocument,
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import db from "@/lib/db";
import type { Settings, AzureDevOpsSettings } from "@/types";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";

interface UpdateChildStatusRequest {
  workItemId?: number;
  workItemType?: string;
  status?: string;
}

const parseSettings = (value: string): AzureDevOpsSettings | null => {
  try {
    return JSON.parse(value) as AzureDevOpsSettings;
  } catch {
    return null;
  }
};

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

const getAllowedStatuses = (workItemType: "task" | "bug"): string[] => {
  if (workItemType === "bug") {
    return ["New", "Active", "Resolved", "Closed"];
  }
  return ["New", "Active", "Closed"];
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = (await request.json()) as UpdateChildStatusRequest;

    const workItemId = Number(body.workItemId);
    const workItemType = normalizeType(body.workItemType);
    const status = normalizeStatus(body.status);

    if (!Number.isInteger(workItemId) || workItemId <= 0 || !workItemType || !status) {
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

    const settingRow = db
      .prepare(
        "SELECT id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?"
      )
      .get("azure_devops", projectId) as Settings | undefined;

    if (!settingRow) {
      return NextResponse.json(
        { error: "Azure DevOps settings not configured. Please configure in Settings." },
        { status: 400 }
      );
    }

    const settings = parseSettings(settingRow.value);
    if (!settings?.organization || !settings.project || !settings.pat) {
      return NextResponse.json(
        { error: "Azure DevOps settings incomplete. Please check organization, project, and PAT." },
        { status: 400 }
      );
    }

    const orgUrl = `https://dev.azure.com/${settings.organization}`;
    const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi: WorkItemTrackingApi = await connection.getWorkItemTrackingApi();

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
      workItemId,
      settings.project
    );

    db.prepare(
      `
        UPDATE release_work_item_children
        SET state = ?, updated_at = CURRENT_TIMESTAMP
        WHERE project_id = ? AND child_external_id = ?
      `
    ).run(status, projectId, workItemId);

    // Keep imported local tasks in sync if this child work item is imported.
    const completedStatuses = ["closed", "resolved", "done", "completed"];
    const isCompleted = completedStatuses.includes(status.toLowerCase());
    const tasks = db
      .prepare(
        `
          SELECT id, status, completed_at
          FROM tasks
          WHERE project_id = ?
            AND external_source = 'azure_devops'
            AND external_id IS NOT NULL
            AND CAST(external_id AS INTEGER) = ?
        `
      )
      .all(projectId, workItemId) as Array<{
      id: number;
      status: string | null;
      completed_at: string | null;
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
        ? completedStatuses.includes(task.status.toLowerCase())
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
      workItemId,
    });
  } catch (error) {
    console.error("Child work item status update error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update child work item status", details: message },
      { status: 500 }
    );
  }
}
