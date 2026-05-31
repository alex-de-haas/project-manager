export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { ChecklistItem } from "@/types";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import { getWorkItemForUser } from "@/lib/work-items";

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const serializeChecklistItem = (item: ChecklistItem): ChecklistItem => ({
  ...item,
  task_id: item.work_item_id,
});

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const workItemId = parsePositiveInteger(
      searchParams.get("workItemId") ?? searchParams.get("taskId")
    );

    if (workItemId) {
      const item = getWorkItemForUser(workItemId, projectId, userId);
      if (!item) {
        return NextResponse.json({ error: "Work item not found" }, { status: 404 });
      }

      const items = db
        .prepare(
          `
            SELECT ci.*, ci.work_item_id AS task_id
            FROM checklist_items ci
            WHERE ci.work_item_id = ?
              AND ci.user_id = ?
            ORDER BY ci.display_order ASC, ci.created_at ASC
          `
        )
        .all(workItemId, userId) as ChecklistItem[];

      return NextResponse.json(items.map(serializeChecklistItem));
    }

    const items = db
      .prepare(
        `
          SELECT ci.*, ci.work_item_id AS task_id
          FROM checklist_items ci
          INNER JOIN work_items wi ON wi.id = ci.work_item_id
          WHERE ci.user_id = ?
            AND wi.project_id = ?
          ORDER BY ci.work_item_id, ci.display_order ASC
        `
      )
      .all(userId, projectId) as ChecklistItem[];

    return NextResponse.json(items.map(serializeChecklistItem));
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch checklist items" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const workItemId = parsePositiveInteger(body?.work_item_id ?? body?.task_id);
    const title = typeof body?.title === "string" ? body.title.trim() : "";

    if (!workItemId || !title) {
      return NextResponse.json(
        { error: "Work item ID and title are required" },
        { status: 400 }
      );
    }

    const item = getWorkItemForUser(workItemId, projectId, userId, {
      requireAssigned: true,
      requireTrackable: true,
    });
    if (!item) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    if (item.status === "completed" || item.status === "resolved") {
      return NextResponse.json(
        { error: "Checklist is locked after the work item enters a gated status" },
        { status: 400 }
      );
    }

    const maxOrder = db
      .prepare(
        "SELECT MAX(display_order) as max_order FROM checklist_items WHERE work_item_id = ? AND user_id = ?"
      )
      .get(workItemId, userId) as { max_order: number | null };
    const newOrder = (maxOrder.max_order ?? -1) + 1;

    const result = db
      .prepare(
        `
          INSERT INTO checklist_items (
            user_id,
            work_item_id,
            title,
            display_order,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(userId, workItemId, title, newOrder, userId, userId);

    return NextResponse.json(
      { message: "Checklist item created successfully", id: result.lastInsertRowid },
      { status: 201 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to create checklist item" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const id = parsePositiveInteger(body?.id);

    if (!id) {
      return NextResponse.json({ error: "Checklist item ID is required" }, { status: 400 });
    }

    const existing = db
      .prepare(
        `
          SELECT ci.*, wi.project_id, wi.assigned_user_id, wi.status AS work_item_status
          FROM checklist_items ci
          INNER JOIN work_items wi ON wi.id = ci.work_item_id
          WHERE ci.id = ?
            AND ci.user_id = ?
            AND wi.project_id = ?
        `
      )
      .get(id, userId, projectId) as
      | (ChecklistItem & {
          project_id: number;
          assigned_user_id: number | null;
          work_item_status: string;
        })
      | undefined;

    if (!existing || existing.assigned_user_id !== userId) {
      return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    }

    if (
      (existing.work_item_status === "completed" || existing.work_item_status === "resolved") &&
      (body?.title !== undefined || body?.display_order !== undefined)
    ) {
      return NextResponse.json(
        { error: "Checklist editing is locked after the work item enters a gated status" },
        { status: 400 }
      );
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body?.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) {
        return NextResponse.json({ error: "Title is required" }, { status: 400 });
      }
      updates.push("title = ?");
      values.push(title);
    }

    if (body?.is_completed !== undefined) {
      updates.push("is_completed = ?");
      values.push(body.is_completed ? 1 : 0);
      updates.push(body.is_completed ? "completed_at = CURRENT_TIMESTAMP" : "completed_at = NULL");
    }

    if (body?.display_order !== undefined) {
      updates.push("display_order = ?");
      values.push(Number(body.display_order));
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.push("updated_by_user_id = ?");
    values.push(userId);
    updates.push("updated_at = CURRENT_TIMESTAMP");

    const result = db
      .prepare(`UPDATE checklist_items SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...values, id, userId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Checklist item updated successfully" });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update checklist item" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const id = parsePositiveInteger(request.nextUrl.searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "Checklist item ID is required" }, { status: 400 });
    }

    const result = db
      .prepare(
        `
          DELETE FROM checklist_items
          WHERE id = ?
            AND user_id = ?
            AND work_item_id IN (
              SELECT id
              FROM work_items
              WHERE project_id = ?
                AND assigned_user_id = ?
                AND status NOT IN ('resolved', 'completed')
            )
        `
      )
      .run(id, userId, projectId, userId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Checklist item not found or locked" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "Checklist item deleted successfully" });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to delete checklist item" }, { status: 500 });
  }
}
