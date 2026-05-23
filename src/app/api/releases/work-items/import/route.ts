export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { ReleaseWorkItem } from "@/types";
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

interface ImportRequest {
  releaseId?: number;
  workItemIds?: number[];
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = (await request.json()) as ImportRequest;
    const releaseId = body.releaseId;
    const workItemIds = body.workItemIds ?? [];

    if (!releaseId) {
      return NextResponse.json(
        { error: "Release id is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(workItemIds) || workItemIds.length === 0) {
      return NextResponse.json(
        { error: "Work item ids are required" },
        { status: 400 }
      );
    }

    const release = db
      .prepare("SELECT id FROM releases WHERE id = ? AND project_id = ?")
      .get(releaseId, projectId) as { id: number } | undefined;

    if (!release) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json(
        { error: settingsResult.message },
        { status: 400 }
      );
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);

    const workItems = await witApi.getWorkItems(
      workItemIds,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const imported: ReleaseWorkItem[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const workItem of workItems || []) {
      if (!workItem.id || !workItem.fields) {
        continue;
      }

      const existing = db
        .prepare(
          "SELECT id FROM release_work_items WHERE release_id = ? AND external_id = ? AND external_source = 'azure_devops' AND project_id = ?"
        )
        .get(releaseId, workItem.id, projectId) as { id: number } | undefined;

      if (existing) {
        skipped.push({ id: workItem.id, reason: "Already added" });
        continue;
      }

      const title =
        (workItem.fields["System.Title"] as string) ||
        `Work Item ${workItem.id}`;
      const workItemType =
        (workItem.fields["System.WorkItemType"] as string) || "User Story";
      const state = (workItem.fields["System.State"] as string) || null;
      const tagsString = (workItem.fields["System.Tags"] as string) || null;

      // Get the max display_order for this release
      const maxOrderRow = db
        .prepare("SELECT MAX(display_order) as max_order FROM release_work_items WHERE release_id = ? AND project_id = ?")
        .get(releaseId, projectId) as { max_order: number | null } | undefined;
      const nextOrder = (maxOrderRow?.max_order ?? -1) + 1;

      const stmt = db.prepare(
        `
        INSERT INTO release_work_items
          (user_id, project_id, release_id, title, external_id, external_source, work_item_type, state, tags, display_order)
        VALUES
          (?, ?, ?, ?, ?, 'azure_devops', ?, ?, ?, ?)
      `
      );

      const result = stmt.run(userId, projectId, releaseId, title, workItem.id, workItemType, state, tagsString, nextOrder);
      const newItem = db
        .prepare("SELECT * FROM release_work_items WHERE id = ? AND project_id = ?")
        .get(result.lastInsertRowid, projectId) as ReleaseWorkItem;
      imported.push(newItem);
    }

    const parentIds = Array.from(
      new Set(
        workItemIds.filter(
          (id): id is number => Number.isInteger(id) && id > 0
        )
      )
    );

    let childItemsSync: { parents: number; items: number; deleted: number } = {
      parents: 0,
      items: 0,
      deleted: 0,
    };
    let childItemsSyncError: string | null = null;

    if (parentIds.length > 0) {
      try {
        const childItems = await fetchChildWorkItemsForParentIds(
          witApi,
          settings.project,
          parentIds
        );
        childItemsSync = syncChildWorkItemsSnapshot({
          projectId,
          parentIds,
          items: childItems,
        });
      } catch (error) {
        childItemsSyncError =
          error instanceof Error
            ? error.message
            : "Failed to sync child work items";
        console.error("Release work item child sync error:", error);
      }
    }

    return NextResponse.json({
      imported: imported.length,
      skipped: skipped.length,
      items: imported,
      skippedDetails: skipped,
      childItemsSync,
      childItemsSyncError,
    });
  } catch (error) {
    console.error("Release work item import error:", error);
    return NextResponse.json(
      {
        error: "Failed to import user stories",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
