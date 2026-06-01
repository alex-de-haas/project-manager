export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
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
  findMappedAzureDevOpsUserId,
  isAzureDevOpsIdentityAssignedToUser,
  normalizeAzureDevOpsWorkItemIdentity,
} from "@/lib/azure-devops/identity";
import {
  mapAzureDevOpsStatusToWorkItemStatus,
  mapAzureDevOpsTypeToWorkItemType,
  upsertExternalLink,
} from "@/lib/work-items";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

interface RefreshRequest {
  releaseId?: number;
  startDate?: string;
  endDate?: string;
  taskIds?: number[];
}

interface LinkedWorkItemRow {
  id: number;
  title: string;
  type: string;
  status: string;
  tags: string | null;
  assigned_user_id: number | null;
  display_order: number | null;
  completed_at?: string | null;
  external_id: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = (await request.json().catch(() => ({}))) as RefreshRequest;
    const releaseId = body.releaseId === undefined ? null : parsePositiveInt(body.releaseId);

    if (body.releaseId !== undefined && !releaseId) {
      return NextResponse.json(
        { error: "releaseId must be a positive integer" },
        { status: 400 }
      );
    }

    if ((body.startDate && !body.endDate) || (!body.startDate && body.endDate)) {
      return NextResponse.json(
        { error: "startDate and endDate must be provided together" },
        { status: 400 }
      );
    }
    if (
      body.startDate &&
      body.endDate &&
      (!DATE_RE.test(body.startDate) || !DATE_RE.test(body.endDate))
    ) {
      return NextResponse.json(
        { error: "startDate and endDate must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    const taskIds = Array.isArray(body.taskIds)
      ? Array.from(new Set(body.taskIds.map(parsePositiveInt).filter(Boolean) as number[]))
      : null;

    if (releaseId) {
      const release = db
        .prepare("SELECT id FROM releases WHERE id = ? AND project_id = ?")
        .get(releaseId, projectId) as { id: number } | undefined;
      if (!release) {
        return NextResponse.json({ error: "Release not found" }, { status: 404 });
      }
    }

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json({ error: settingsResult.message }, { status: 400 });
    }

    const queryParts = [
      `
        SELECT DISTINCT
          wi.id,
          wi.title,
          wi.type,
          wi.status,
          wi.tags,
          wi.assigned_user_id,
          wi.display_order,
          wi.completed_at,
          link.external_id
        FROM work_items wi
        INNER JOIN work_item_external_links link
          ON link.work_item_id = wi.id
          AND link.provider = 'azure_devops'
      `,
    ];
    const params: Array<string | number> = [];

    if (releaseId) {
      queryParts.push("INNER JOIN release_items ri ON ri.work_item_id = wi.id");
    }

    queryParts.push("WHERE wi.project_id = ?");
    params.push(projectId);

    if (releaseId) {
      queryParts.push("AND ri.release_id = ?");
      params.push(releaseId);
    }

    if (body.startDate && body.endDate) {
      queryParts.push(
        "AND DATE(wi.created_at) <= ? AND (wi.completed_at IS NULL OR DATE(wi.completed_at) >= ?)"
      );
      params.push(body.endDate, body.startDate);
    }

    if (taskIds !== null) {
      if (taskIds.length === 0) {
        return NextResponse.json({ updated: 0, skipped: 0 });
      }
      queryParts.push(`AND wi.id IN (${taskIds.map(() => "?").join(", ")})`);
      params.push(...taskIds);
    }

    const linkedItems = db.prepare(queryParts.join("\n")).all(...params) as LinkedWorkItemRow[];

    if (linkedItems.length === 0) {
      return NextResponse.json({
        updated: 0,
        skipped: 0,
        message: "No imported Azure DevOps items found to refresh in current scope",
      });
    }

    const { settings, connection, witApi } =
      await createAzureDevOpsConnectionContext(settingsResult);
    const authenticatedUser = await getOrResolveAzureDevOpsUserIdentity(
      userId,
      projectId,
      connection
    );
    const externalIds = Array.from(
      new Set(
        linkedItems
          .map((item) => Number.parseInt(item.external_id, 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );

    if (externalIds.length === 0) {
      return NextResponse.json({ updated: 0, skipped: linkedItems.length });
    }

    const MAX_BATCH_SIZE = 200;
    const workItems: any[] = [];
    for (let i = 0; i < externalIds.length; i += MAX_BATCH_SIZE) {
      const batchItems = await witApi.getWorkItems(
        externalIds.slice(i, i + MAX_BATCH_SIZE),
        undefined,
        undefined,
        undefined,
        undefined
      );
      if (batchItems?.length) workItems.push(...batchItems);
    }

    const linkedByExternalId = new Map<number, LinkedWorkItemRow>();
    linkedItems.forEach((item) => {
      const externalId = Number.parseInt(item.external_id, 10);
      if (Number.isInteger(externalId)) linkedByExternalId.set(externalId, item);
    });

    const updated: Array<{ id: number; title: string; status: string }> = [];
    const skipped: Array<{ id: number; reason: string }> = [];
    const maxOrderStmt = db.prepare(
      `
        SELECT MAX(display_order) AS max_order
        FROM work_items
        WHERE project_id = ?
          AND assigned_user_id = ?
          AND type IN ('task', 'bug')
      `
    );

    for (const workItem of workItems) {
      if (!workItem.id || !workItem.fields) continue;
      const localItem = linkedByExternalId.get(workItem.id);
      if (!localItem) continue;

      const title =
        (workItem.fields["System.Title"] as string) || `Work Item ${workItem.id}`;
      const nativeType =
        (workItem.fields["System.WorkItemType"] as string) || "Task";
      const type = mapAzureDevOpsTypeToWorkItemType(nativeType);
      const nativeStatus = (workItem.fields["System.State"] as string) || null;
      const status = mapAzureDevOpsStatusToWorkItemStatus(nativeStatus);
      const tags = (workItem.fields["System.Tags"] as string) || null;
      const assignedTo = normalizeAzureDevOpsWorkItemIdentity(
        workItem.fields["System.AssignedTo"]
      );
      const isAssignedToCurrentUser = isAzureDevOpsIdentityAssignedToUser(
        assignedTo,
        authenticatedUser
      );
      const mappedAssignedUserId = findMappedAzureDevOpsUserId(projectId, assignedTo);
      const assignedUserId =
        mappedAssignedUserId ?? (isAssignedToCurrentUser === true ? userId : null);
      let displayOrder = localItem.display_order ?? 0;
      if (assignedUserId && localItem.assigned_user_id !== assignedUserId) {
        const maxOrder = maxOrderStmt.get(projectId, assignedUserId) as {
          max_order: number | null;
        };
        displayOrder = (maxOrder.max_order ?? -1) + 1;
      }
      const closedDate =
        (workItem.fields["Microsoft.VSTS.Common.ClosedDate"] as string) ||
        (workItem.fields["Microsoft.VSTS.Common.ResolvedDate"] as string) ||
        (workItem.fields["System.ClosedDate"] as string) ||
        null;

      const hasChanges =
        localItem.title !== title ||
        localItem.type !== type ||
        localItem.status !== status ||
        (localItem.tags ?? null) !== tags ||
        localItem.assigned_user_id !== assignedUserId;

      if (hasChanges) {
        db.prepare(
          `
            UPDATE work_items
            SET title = ?,
                type = ?,
                status = ?,
                tags = ?,
                assigned_user_id = ?,
                display_order = ?,
                completed_at = ?,
                sync_state = 'synced',
                updated_by_user_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
          `
        ).run(
          title,
          type,
          status,
          tags,
          assignedUserId,
          displayOrder,
          status === "completed"
            ? closedDate || localItem.completed_at || new Date().toISOString()
            : null,
          userId,
          localItem.id,
          projectId
        );
        updated.push({ id: workItem.id, title, status: nativeStatus || "N/A" });
      } else {
        skipped.push({ id: workItem.id, reason: "No changes detected" });
      }

      upsertExternalLink({
        workItemId: localItem.id,
        projectId,
        provider: "azure_devops",
        externalId: workItem.id,
        nativeType,
        nativeStatus,
        nativeAssigneeId: assignedTo?.id ?? null,
        nativeAssigneeName: assignedTo?.displayName ?? null,
        nativeAssigneeUniqueName: assignedTo?.uniqueName ?? null,
        nativeAssigneeIsCurrentUser: isAssignedToCurrentUser,
        sanitizedSnapshot: {
          id: workItem.id,
          title,
          type: nativeType,
          state: nativeStatus,
          tags,
        },
      });
    }

    const childParentIds = releaseId
      ? externalIds
      : externalIds.filter((externalId) => {
          const item = linkedByExternalId.get(externalId);
          return item?.type === "user_story";
        });

    let childItemsSync = { parents: 0, items: 0, deleted: 0 };
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
          currentUserId: userId,
          authenticatedUser,
        });
      } catch (error) {
        childItemsSyncError =
          error instanceof Error ? error.message : "Failed to sync child work items";
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
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Azure DevOps refresh error:", error);
    return NextResponse.json(
      {
        error: "Failed to refresh Azure DevOps items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
