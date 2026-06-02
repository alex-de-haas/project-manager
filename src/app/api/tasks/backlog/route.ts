export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { AzureDevOpsWorkItem, IntegrationProvider, WorkItemStatus } from "@/types";
import {
  LOCAL_STATUS_BY_IMPORT_FILTER,
  parseImportStatusFilters,
} from "@/lib/import-filters";
import {
  displayWorkItemStatus,
  displayWorkItemType,
  ensureTimeTrackingItem,
} from "@/lib/work-items";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

const MAX_BACKLOG_IMPORT_ITEMS = 100;

type BacklogRow = {
  id: number;
  title: string;
  type: "task" | "bug";
  status: WorkItemStatus;
  tags: string | null;
  external_id: string | null;
  external_source: IntegrationProvider | null;
};

const parseWorkItemIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
};

const parseTags = (tags: string | null): string[] | undefined => {
  const parsed = tags
    ? tags
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  return parsed.length > 0 ? parsed : undefined;
};

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const searchParam = (searchParams.get("search") || "").trim();
    const searchText = searchParam.length > 0 ? searchParam : null;
    const selectedStatuses = parseImportStatusFilters(searchParams.get("statuses"));
    const localStatuses = selectedStatuses.map(
      (status) => LOCAL_STATUS_BY_IMPORT_FILTER[status]
    );

    if (localStatuses.length === 0) {
      return NextResponse.json({ workItems: [] });
    }

    const conditions = [
      "wi.project_id = ?",
      "wi.type IN ('task', 'bug')",
      `wi.status IN (${localStatuses.map(() => "?").join(", ")})`,
      `NOT EXISTS (
        SELECT 1
        FROM time_tracking_items tti
        WHERE tti.project_id = wi.project_id
          AND tti.user_id = ?
          AND tti.work_item_id = wi.id
      )`,
    ];
    const params: Array<number | string> = [projectId, ...localStatuses, userId];

    if (searchText) {
      conditions.push(
        `(CAST(wi.id AS TEXT) LIKE ? OR wi.title LIKE ? OR COALESCE(link.external_id, '') LIKE ?)`
      );
      const searchPattern = `%${searchText}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    const rows = db
      .prepare(
        `
          SELECT
            wi.id,
            wi.title,
            wi.type,
            wi.status,
            wi.tags,
            link.provider AS external_source,
            link.external_id
          FROM work_items wi
          LEFT JOIN work_item_external_links link ON link.work_item_id = wi.id
          WHERE ${conditions.join(" AND ")}
          ORDER BY wi.updated_at DESC, wi.id DESC
          LIMIT 200
        `
      )
      .all(...params) as BacklogRow[];

    const workItems: AzureDevOpsWorkItem[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: displayWorkItemType(row.type),
      state: displayWorkItemStatus(row.status),
      tags: parseTags(row.tags),
      externalId: row.external_id,
      externalSource: row.external_source,
    }));

    return NextResponse.json({ workItems });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Backlog work item fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch backlog work items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const workItemIds = parseWorkItemIds(body?.workItemIds);

    if (workItemIds.length === 0) {
      return NextResponse.json(
        { error: "Work item ids are required" },
        { status: 400 }
      );
    }

    if (workItemIds.length > MAX_BACKLOG_IMPORT_ITEMS) {
      return NextResponse.json(
        { error: `Cannot import more than ${MAX_BACKLOG_IMPORT_ITEMS} work items at once` },
        { status: 400 }
      );
    }

    const placeholders = workItemIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
          SELECT id
          FROM work_items
          WHERE project_id = ?
            AND type IN ('task', 'bug')
            AND id IN (${placeholders})
        `
      )
      .all(projectId, ...workItemIds) as Array<{ id: number }>;
    const availableIds = new Set(rows.map((row) => row.id));

    let imported = 0;
    let skipped = 0;
    const skippedDetails: Array<{ id: number; reason: string }> = [];

    for (const workItemId of workItemIds) {
      if (!availableIds.has(workItemId)) {
        skipped += 1;
        skippedDetails.push({
          id: workItemId,
          reason: "Work item is not available for Time Management",
        });
        continue;
      }

      const result = ensureTimeTrackingItem({
        projectId,
        userId,
        workItemId,
        addedByUserId: userId,
      });

      if (result.created) {
        imported += 1;
      } else {
        skipped += 1;
        skippedDetails.push({
          id: workItemId,
          reason: "Already added to Time Management",
        });
      }
    }

    return NextResponse.json({
      imported,
      skipped,
      skippedDetails,
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Backlog work item import error:", error);
    return NextResponse.json(
      { error: "Failed to import backlog work items" },
      { status: 500 }
    );
  }
}
