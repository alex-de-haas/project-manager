export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Task } from "@/types";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";
import {
  fetchChildWorkItemsForParentIds,
  syncChildWorkItemsSnapshot,
} from "@/lib/azure-devops/child-work-items";
import {
  createAzureDevOpsConnectionContext,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";

interface RefreshRequest {
  releaseId?: number;
  startDate?: string;
  endDate?: string;
}

interface ReleaseWorkItemSnapshot {
  title: string;
  work_item_type: string | null;
  state: string | null;
  tags: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const uniqueExternalIds = (values: Array<string | null>): number[] =>
  Array.from(
    new Set(
      values
        .map((value) => Number.parseInt(String(value ?? ""), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = (await request.json().catch(() => ({}))) as RefreshRequest;

    const hasStartDate = typeof body.startDate === "string" && body.startDate.trim().length > 0;
    const hasEndDate = typeof body.endDate === "string" && body.endDate.trim().length > 0;

    if (hasStartDate !== hasEndDate) {
      return NextResponse.json(
        { error: "startDate and endDate must be provided together" },
        { status: 400 }
      );
    }

    const hasDateRangeScope = hasStartDate && hasEndDate;
    const startDate = hasDateRangeScope ? body.startDate!.trim() : null;
    const endDate = hasDateRangeScope ? body.endDate!.trim() : null;

    if (hasDateRangeScope && (!DATE_RE.test(startDate!) || !DATE_RE.test(endDate!))) {
      return NextResponse.json(
        { error: "startDate and endDate must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    const releaseId =
      body.releaseId === undefined || body.releaseId === null
        ? null
        : parsePositiveInt(body.releaseId);

    if (body.releaseId !== undefined && body.releaseId !== null && releaseId === null) {
      return NextResponse.json(
        { error: "releaseId must be a positive integer" },
        { status: 400 }
      );
    }

    if (releaseId !== null) {
      const release = db
        .prepare("SELECT id FROM releases WHERE id = ? AND project_id = ?")
        .get(releaseId, projectId) as { id: number } | undefined;

      if (!release) {
        return NextResponse.json({ error: "Release not found" }, { status: 404 });
      }
    }

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json(
        { error: settingsResult.message },
        { status: 400 }
      );
    }

    const importedReleaseWorkItemsQueryParts = [
      `SELECT external_id, title, work_item_type, state, tags
       FROM release_work_items
       WHERE external_source = ?
         AND project_id = ?
         AND external_id IS NOT NULL`,
    ];
    const importedReleaseWorkItemsParams: Array<string | number> = [
      "azure_devops",
      projectId,
    ];

    if (releaseId !== null) {
      importedReleaseWorkItemsQueryParts.push("AND release_id = ?");
      importedReleaseWorkItemsParams.push(releaseId);
    }

    const shouldRefreshReleaseItems = releaseId !== null || !hasDateRangeScope;
    const importedReleaseWorkItems = shouldRefreshReleaseItems
      ? (db
          .prepare(importedReleaseWorkItemsQueryParts.join("\n"))
          .all(...importedReleaseWorkItemsParams) as Array<{
          external_id: string;
          title: string;
          work_item_type: string | null;
          state: string | null;
          tags: string | null;
        }>)
      : [];

    const releaseExternalIds = uniqueExternalIds(
      importedReleaseWorkItems.map((item) => item.external_id)
    );

    let importedTasks: Task[] = [];

    if (releaseId !== null) {
      if (releaseExternalIds.length > 0) {
        const placeholders = releaseExternalIds.map(() => "?").join(", ");
        const queryParts = [
          `SELECT *
           FROM tasks
           WHERE external_source = ?
             AND user_id = ?
             AND project_id = ?
             AND external_id IS NOT NULL
             AND CAST(external_id AS INTEGER) IN (${placeholders})`,
        ];

        const queryParams: Array<string | number> = [
          "azure_devops",
          userId,
          projectId,
          ...releaseExternalIds,
        ];

        if (hasDateRangeScope) {
          queryParts.push(
            "AND DATE(created_at) <= ? AND (completed_at IS NULL OR DATE(completed_at) >= ?)"
          );
          queryParams.push(endDate!, startDate!);
        }

        importedTasks = db.prepare(queryParts.join("\n")).all(...queryParams) as Task[];
      }
    } else if (hasDateRangeScope) {
      importedTasks = db
        .prepare(
          `SELECT *
           FROM tasks
           WHERE external_source = ?
             AND user_id = ?
             AND project_id = ?
             AND external_id IS NOT NULL
             AND DATE(created_at) <= ?
             AND (completed_at IS NULL OR DATE(completed_at) >= ?)`
        )
        .all("azure_devops", userId, projectId, endDate!, startDate!) as Task[];
    } else {
      importedTasks = db
        .prepare(
          `SELECT *
           FROM tasks
           WHERE external_source = ?
             AND user_id = ?
             AND project_id = ?
             AND external_id IS NOT NULL`
        )
        .all("azure_devops", userId, projectId) as Task[];
    }

    if (importedTasks.length === 0 && importedReleaseWorkItems.length === 0) {
      return NextResponse.json({
        updated: 0,
        skipped: 0,
        message: "No imported Azure DevOps items found to refresh in current scope",
      });
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);

    const workItemIdSet = new Set<number>();
    for (const task of importedTasks) {
      const id = task.external_id ? Number.parseInt(task.external_id, 10) : Number.NaN;
      if (!Number.isNaN(id)) workItemIdSet.add(id);
    }
    for (const item of importedReleaseWorkItems) {
      const id = Number.parseInt(item.external_id, 10);
      if (!Number.isNaN(id)) workItemIdSet.add(id);
    }

    const workItemIds = Array.from(workItemIdSet);

    if (workItemIds.length === 0) {
      return NextResponse.json({
        updated: 0,
        skipped: 0,
        message: "No valid work item IDs found in current scope",
      });
    }

    const MAX_BATCH_SIZE = 200;
    const workItems: any[] = [];

    for (let i = 0; i < workItemIds.length; i += MAX_BATCH_SIZE) {
      const batchIds = workItemIds.slice(i, i + MAX_BATCH_SIZE);
      const batchItems = await witApi.getWorkItems(
        batchIds,
        undefined,
        undefined,
        undefined,
        undefined
      );

      if (batchItems?.length) {
        workItems.push(...batchItems);
      }
    }

    const updated: Array<{ id: number; title: string; status: string }> = [];
    const skipped: Array<{ id: number; reason: string }> = [];

    const updateTasksStmt = db.prepare(`
      UPDATE tasks
      SET title = ?, type = ?, status = ?, tags = ?, completed_at = ?
      WHERE id = ? AND user_id = ? AND project_id = ?
    `);

    const updateReleaseWorkItemsStmt =
      releaseId !== null
        ? db.prepare(`
            UPDATE release_work_items
            SET title = ?, work_item_type = ?, state = ?, tags = ?
            WHERE external_source = 'azure_devops'
              AND CAST(external_id AS INTEGER) = ?
              AND project_id = ?
              AND release_id = ?
          `)
        : db.prepare(`
            UPDATE release_work_items
            SET title = ?, work_item_type = ?, state = ?, tags = ?
            WHERE external_source = 'azure_devops'
              AND CAST(external_id AS INTEGER) = ?
              AND project_id = ?
          `);

    const importedTasksByExternalId = new Map<number, Task>();
    for (const task of importedTasks) {
      const externalId = task.external_id ? Number.parseInt(task.external_id, 10) : Number.NaN;
      if (!Number.isNaN(externalId)) {
        importedTasksByExternalId.set(externalId, task);
      }
    }

    const importedReleaseWorkItemsByExternalId = new Map<
      number,
      ReleaseWorkItemSnapshot[]
    >();
    for (const item of importedReleaseWorkItems) {
      const externalId = Number.parseInt(item.external_id, 10);
      if (Number.isNaN(externalId)) {
        continue;
      }
      const existing = importedReleaseWorkItemsByExternalId.get(externalId) ?? [];
      existing.push({
        title: item.title,
        work_item_type: item.work_item_type,
        state: item.state,
        tags: item.tags,
      });
      importedReleaseWorkItemsByExternalId.set(externalId, existing);
    }

    for (const workItem of workItems) {
      if (!workItem.id || !workItem.fields) {
        continue;
      }

      const title =
        (workItem.fields["System.Title"] as string) || `Work Item ${workItem.id}`;
      const releaseWorkItemType =
        (workItem.fields["System.WorkItemType"] as string) || "Task";
      const workItemType = releaseWorkItemType.toLowerCase();
      const status = (workItem.fields["System.State"] as string) || null;
      const tags = (workItem.fields["System.Tags"] as string) || null;
      const closedDate =
        (workItem.fields["Microsoft.VSTS.Common.ClosedDate"] as string) ||
        (workItem.fields["Microsoft.VSTS.Common.ResolvedDate"] as string) ||
        (workItem.fields["System.ClosedDate"] as string) ||
        null;

      let taskType: "task" | "bug" = "task";
      if (workItemType === "bug") {
        taskType = "bug";
      }

      const task = importedTasksByExternalId.get(workItem.id);
      const releaseItems = importedReleaseWorkItemsByExternalId.get(workItem.id) ?? [];
      let didUpdate = false;

      if (task) {
        const taskCompletedAt = task.completed_at
          ? new Date(task.completed_at).toISOString()
          : null;
        const workItemCompletedAt = closedDate
          ? new Date(closedDate).toISOString()
          : null;

        const hasTaskChanges =
          task.title !== title ||
          task.type !== taskType ||
          task.status !== status ||
          task.tags !== tags ||
          taskCompletedAt !== workItemCompletedAt;

        if (hasTaskChanges) {
          updateTasksStmt.run(
            title,
            taskType,
            status,
            tags,
            closedDate,
            task.id,
            userId,
            projectId
          );
          didUpdate = true;
        }
      }

      const hasReleaseWorkItemChanges = releaseItems.some(
        (item) =>
          item.title !== title ||
          item.work_item_type !== releaseWorkItemType ||
          item.state !== status ||
          item.tags !== tags
      );

      if (hasReleaseWorkItemChanges) {
        if (releaseId !== null) {
          updateReleaseWorkItemsStmt.run(
            title,
            releaseWorkItemType,
            status,
            tags,
            workItem.id,
            projectId,
            releaseId
          );
        } else {
          updateReleaseWorkItemsStmt.run(
            title,
            releaseWorkItemType,
            status,
            tags,
            workItem.id,
            projectId
          );
        }
        didUpdate = true;
      }

      if (didUpdate) {
        updated.push({ id: workItem.id, title, status: status || "N/A" });
      } else {
        skipped.push({ id: workItem.id, reason: "No changes detected" });
      }
    }

    const childParentIds = uniqueExternalIds(
      importedReleaseWorkItems.map((item) => item.external_id)
    );

    let childItemsSync: { parents: number; items: number; deleted: number } = {
      parents: 0,
      items: 0,
      deleted: 0,
    };
    let childItemsSyncError: string | null = null;

    if (childParentIds.length > 0) {
      try {
        const childItems = await fetchChildWorkItemsForParentIds(
          witApi,
          settings.project,
          childParentIds
        );
        childItemsSync = syncChildWorkItemsSnapshot({
          projectId,
          parentIds: childParentIds,
          items: childItems,
        });
      } catch (error) {
        childItemsSyncError =
          error instanceof Error
            ? error.message
            : "Failed to sync child work items";
        console.error("Azure DevOps refresh child sync error:", error);
      }
    }

    return NextResponse.json({
      updated: updated.length,
      skipped: skipped.length,
      updatedTasks: updated,
      skippedDetails: skipped,
      childItemsSync,
      childItemsSyncError,
    });
  } catch (error) {
    console.error("Azure DevOps refresh error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to refresh from Azure DevOps", details: errorMessage },
      { status: 500 }
    );
  }
}
