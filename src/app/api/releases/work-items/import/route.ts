export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { ReleaseWorkItem } from "@/types";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import {
  fetchChildWorkItemsForParentIds,
  syncChildWorkItemsSnapshot,
} from "@/lib/azure-devops/child-work-items";
import {
  createAzureDevOpsConnectionContext,
  getOrResolveAzureDevOpsUserIdentity,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";
import {
  mapAzureDevOpsStatusToWorkItemStatus,
  mapAzureDevOpsTypeToWorkItemType,
  upsertExternalLink,
} from "@/lib/work-items";

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

    const { settings, connection, witApi } =
      await createAzureDevOpsConnectionContext(settingsResult);
    const authenticatedUser = await getOrResolveAzureDevOpsUserIdentity(
      userId,
      projectId,
      connection
    );

    const workItems = await witApi.getWorkItems(
      workItemIds,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const imported: ReleaseWorkItem[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];
    const parentIdsToSync = new Set<number>();

    for (const workItem of workItems || []) {
      if (!workItem.id || !workItem.fields) {
        continue;
      }

      const title =
        (workItem.fields["System.Title"] as string) ||
        `Work Item ${workItem.id}`;
      const workItemType =
        (workItem.fields["System.WorkItemType"] as string) || "User Story";
      const normalizedType = mapAzureDevOpsTypeToWorkItemType(workItemType);

      if (normalizedType !== "user_story") {
        skipped.push({
          id: workItem.id,
          reason: "Only Azure DevOps user stories can be imported into Planning",
        });
        continue;
      }

      parentIdsToSync.add(workItem.id);

      const existingReleaseItem = db
        .prepare(
          `
            SELECT ri.id
            FROM release_items ri
            INNER JOIN work_item_external_links link ON link.work_item_id = ri.work_item_id
            WHERE ri.release_id = ?
              AND link.project_id = ?
              AND link.provider = 'azure_devops'
              AND link.external_id = ?
          `
        )
        .get(releaseId, projectId, String(workItem.id)) as { id: number } | undefined;

      if (existingReleaseItem) {
        skipped.push({ id: workItem.id, reason: "Already added" });
        continue;
      }

      const state = (workItem.fields["System.State"] as string) || null;
      const tagsString = (workItem.fields["System.Tags"] as string) || null;
      const status = mapAzureDevOpsStatusToWorkItemStatus(state);

      const linkedWorkItem = db
        .prepare(
          `
            SELECT wi.id
            FROM work_item_external_links link
            INNER JOIN work_items wi ON wi.id = link.work_item_id
            WHERE link.project_id = ?
              AND link.provider = 'azure_devops'
              AND link.external_id = ?
            LIMIT 1
          `
        )
        .get(projectId, String(workItem.id)) as { id: number } | undefined;

      let workItemId: number;
      if (linkedWorkItem) {
        workItemId = linkedWorkItem.id;
        db.prepare(
          `
            UPDATE work_items
            SET title = ?,
                type = 'user_story',
                status = ?,
                tags = ?,
                completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
                updated_by_user_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
          `
        ).run(title, status, tagsString, status, userId, workItemId, projectId);
      } else {
        const result = db.prepare(
          `
            INSERT INTO work_items (
              project_id,
              title,
              type,
              status,
              tags,
              sync_state,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES (?, ?, 'user_story', ?, ?, 'synced', ?, ?)
          `
        ).run(projectId, title, status, tagsString, userId, userId);
        workItemId = Number(result.lastInsertRowid);
      }

      upsertExternalLink({
        workItemId,
        projectId,
        provider: "azure_devops",
        externalId: workItem.id,
        nativeType: workItemType,
        nativeStatus: state,
        sanitizedSnapshot: {
          id: workItem.id,
          title,
          type: workItemType,
          state,
          tags: tagsString,
        },
      });

      const maxOrderRow = db
        .prepare("SELECT MAX(display_order) as max_order FROM release_items WHERE release_id = ?")
        .get(releaseId) as { max_order: number | null } | undefined;
      const nextOrder = (maxOrderRow?.max_order ?? -1) + 1;

      const result = db.prepare(
        `
          INSERT INTO release_items (release_id, work_item_id, display_order)
          VALUES (?, ?, ?)
      `
      ).run(releaseId, workItemId, nextOrder);
      const newItem = db
        .prepare(
          `
            SELECT
              ri.id,
              ri.release_id,
              ri.work_item_id,
              wi.title,
              link.external_id,
              link.provider AS external_source,
              link.native_type AS work_item_type,
              link.native_status AS state,
              wi.tags,
              ri.display_order,
              ri.created_at
            FROM release_items ri
            INNER JOIN work_items wi ON wi.id = ri.work_item_id
            LEFT JOIN work_item_external_links link ON link.work_item_id = wi.id
            WHERE ri.id = ?
          `
        )
        .get(result.lastInsertRowid) as ReleaseWorkItem;
      imported.push(newItem);
    }

    const parentIds = Array.from(parentIdsToSync);

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
          currentUserId: userId,
          authenticatedUser,
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
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

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
