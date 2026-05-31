export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Blocker, ReleaseWorkItem } from "@/types";
import {
  displayWorkItemStatus,
  displayWorkItemType,
} from "@/lib/work-items";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const releaseId = parsePositiveInteger(request.nextUrl.searchParams.get("releaseId"));

    if (!releaseId) {
      return NextResponse.json({ error: "Release id is required" }, { status: 400 });
    }

    const release = db
      .prepare("SELECT id FROM releases WHERE id = ? AND project_id = ?")
      .get(releaseId, projectId) as { id: number } | undefined;
    if (!release) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    const items = db
      .prepare(
        `
          SELECT
            ri.id,
            ri.release_id,
            ri.work_item_id,
            ri.notes,
            ri.display_order,
            ri.created_at,
            wi.title,
            wi.description,
            wi.type,
            wi.status,
            wi.tags,
            wi.parent_work_item_id,
            wi.assigned_user_id,
            COALESCE(assigned_user.app_display_name, assigned_user.name) AS assigned_user_name,
            assigned_user.email AS assigned_user_email,
            link.provider AS external_source,
            link.external_id,
            link.native_type AS work_item_type,
            link.native_status AS state
          FROM release_items ri
          INNER JOIN work_items wi ON wi.id = ri.work_item_id
          LEFT JOIN users assigned_user ON assigned_user.id = wi.assigned_user_id
          LEFT JOIN work_item_external_links link ON link.work_item_id = wi.id
          WHERE ri.release_id = ?
            AND wi.project_id = ?
          ORDER BY ri.display_order ASC, ri.created_at DESC
        `
      )
      .all(releaseId, projectId) as Array<
      ReleaseWorkItem & {
        type: string;
        status: string;
        work_item_id: number;
        assigned_user_id?: number | null;
        assigned_user_name?: string | null;
        assigned_user_email?: string | null;
      }
    >;

    if (items.length === 0) {
      return NextResponse.json([]);
    }

    const workItemIds = items.map((item) => item.work_item_id);
    const placeholders = workItemIds.map(() => "?").join(", ");
    const blockers = db
      .prepare(
        `
          SELECT b.*, b.work_item_id AS task_id
          FROM blockers b
          WHERE b.is_resolved = 0
            AND b.work_item_id IN (${placeholders})
          ORDER BY b.work_item_id, b.created_at DESC
        `
      )
      .all(...workItemIds) as Blocker[];

    const blockersByWorkItemId = blockers.reduce((acc, blocker) => {
      const existing = acc.get(blocker.work_item_id) ?? [];
      existing.push(blocker);
      acc.set(blocker.work_item_id, existing);
      return acc;
    }, new Map<number, Blocker[]>());

    const enrichedItems = items.map((item) => ({
      ...item,
      task_id: item.work_item_id,
      assignedUserId: item.assigned_user_id ?? null,
      assignedUserName: item.assigned_user_name ?? null,
      assignedUserEmail: item.assigned_user_email ?? null,
      work_item_type: item.work_item_type ?? displayWorkItemType(item.type),
      state: item.state ?? displayWorkItemStatus(item.status),
      blockers: blockersByWorkItemId.get(item.work_item_id) ?? [],
    }));

    return NextResponse.json(enrichedItems);
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch release work items" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const id = parsePositiveInteger(request.nextUrl.searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "Work item id is required" }, { status: 400 });
    }

    const result = db
      .prepare(
        `
          DELETE FROM release_items
          WHERE id = ?
            AND work_item_id IN (
              SELECT id FROM work_items WHERE project_id = ?
            )
        `
      )
      .run(id, projectId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to delete release work item" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const releaseId = parsePositiveInteger(body?.releaseId);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description =
      typeof body?.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;

    if (!releaseId || !title) {
      return NextResponse.json(
        { error: "Release id and title are required" },
        { status: 400 }
      );
    }

    const release = db
      .prepare("SELECT id FROM releases WHERE id = ? AND project_id = ?")
      .get(releaseId, projectId) as { id: number } | undefined;
    if (!release) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    const maxOrder = db
      .prepare("SELECT MAX(display_order) as max_order FROM release_items WHERE release_id = ?")
      .get(releaseId) as { max_order: number | null };
    const nextOrder = (maxOrder.max_order ?? -1) + 1;

    const transaction = db.transaction(() => {
      const workItemResult = db
        .prepare(
          `
            INSERT INTO work_items (
              project_id,
              title,
              description,
              type,
              status,
              sync_state,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES (?, ?, ?, 'user_story', 'new', 'not_synced', ?, ?)
          `
        )
        .run(projectId, title, description, userId, userId);
      const workItemId = Number(workItemResult.lastInsertRowid);

      const releaseItemResult = db
        .prepare(
          "INSERT INTO release_items (release_id, work_item_id, display_order) VALUES (?, ?, ?)"
        )
        .run(releaseId, workItemId, nextOrder);

      return { releaseItemId: Number(releaseItemResult.lastInsertRowid), workItemId };
    });

    const created = transaction();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to create release work item" },
      { status: 500 }
    );
  }
}
