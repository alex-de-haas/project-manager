export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Blocker } from "@/types";
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

const serializeBlocker = (blocker: Blocker): Blocker => ({
  ...blocker,
  task_id: blocker.work_item_id,
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

      const blockers = db
        .prepare(
          `
            SELECT b.*, b.work_item_id AS task_id
            FROM blockers b
            WHERE b.work_item_id = ?
            ORDER BY b.created_at DESC
          `
        )
        .all(workItemId) as Blocker[];

      return NextResponse.json(blockers.map(serializeBlocker));
    }

    const blockers = db
      .prepare(
        `
          SELECT b.*, b.work_item_id AS task_id
          FROM blockers b
          INNER JOIN work_items wi ON wi.id = b.work_item_id
          WHERE wi.project_id = ?
            AND (
              wi.assigned_user_id = ?
              OR b.created_by_user_id = ?
            )
          ORDER BY b.created_at DESC
        `
      )
      .all(projectId, userId, userId) as Blocker[];

    return NextResponse.json(blockers.map(serializeBlocker));
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch blockers" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const workItemId = parsePositiveInteger(body?.work_item_id ?? body?.task_id);
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
    const severity = body?.severity ?? "medium";

    if (!workItemId || !comment) {
      return NextResponse.json(
        { error: "Work item ID and comment are required" },
        { status: 400 }
      );
    }

    if (!["low", "medium", "high", "critical"].includes(severity)) {
      return NextResponse.json({ error: "Invalid severity level" }, { status: 400 });
    }

    const item = getWorkItemForUser(workItemId, projectId, userId);
    if (!item) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    const result = db
      .prepare(
        `
          INSERT INTO blockers (
            work_item_id,
            comment,
            severity,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(workItemId, comment, severity, userId, userId);

    return NextResponse.json(
      { message: "Blocker created successfully", id: result.lastInsertRowid },
      { status: 201 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to create blocker" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const id = parsePositiveInteger(body?.id);

    if (!id) {
      return NextResponse.json({ error: "Blocker ID is required" }, { status: 400 });
    }

    const blocker = db
      .prepare(
        `
          SELECT b.id
          FROM blockers b
          INNER JOIN work_items wi ON wi.id = b.work_item_id
          WHERE b.id = ?
            AND wi.project_id = ?
            AND (wi.assigned_user_id = ? OR b.created_by_user_id = ?)
        `
      )
      .get(id, projectId, userId, userId) as { id: number } | undefined;
    if (!blocker) {
      return NextResponse.json({ error: "Blocker not found" }, { status: 404 });
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (body?.comment !== undefined) {
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      if (!comment) {
        return NextResponse.json({ error: "Comment is required" }, { status: 400 });
      }

      updates.push("comment = ?");
      values.push(comment);
    }

    if (body?.severity !== undefined) {
      if (!["low", "medium", "high", "critical"].includes(body.severity)) {
        return NextResponse.json({ error: "Invalid severity level" }, { status: 400 });
      }
      updates.push("severity = ?");
      values.push(body.severity);
    }

    if (
      body?.resolution_comment !== undefined &&
      body.resolution_comment !== null &&
      typeof body.resolution_comment !== "string"
    ) {
      return NextResponse.json(
        { error: "Resolution comment must be a string or null" },
        { status: 400 }
      );
    }

    if (body?.is_resolved !== undefined) {
      updates.push("is_resolved = ?");
      values.push(body.is_resolved ? 1 : 0);

      if (body.is_resolved) {
        updates.push("resolved_at = CURRENT_TIMESTAMP");
        updates.push("resolved_by_user_id = ?");
        values.push(userId);
        updates.push("resolution_comment = ?");
        values.push(
          typeof body.resolution_comment === "string" && body.resolution_comment.trim()
            ? body.resolution_comment.trim()
            : null
        );
      } else {
        updates.push("resolved_at = NULL");
        updates.push("resolved_by_user_id = NULL");
        updates.push("resolution_comment = NULL");
      }
    } else if (body?.resolution_comment !== undefined) {
      updates.push("resolution_comment = ?");
      values.push(
        typeof body.resolution_comment === "string" && body.resolution_comment.trim()
          ? body.resolution_comment.trim()
          : null
      );
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.push("updated_by_user_id = ?");
    values.push(userId);
    updates.push("updated_at = CURRENT_TIMESTAMP");

    const result = db
      .prepare(`UPDATE blockers SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, id);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Blocker not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Blocker updated successfully" });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update blocker" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const blockerId = parsePositiveInteger(request.nextUrl.searchParams.get("id"));

    if (!blockerId) {
      return NextResponse.json({ error: "Blocker ID is required" }, { status: 400 });
    }

    const result = db
      .prepare(
        `
          DELETE FROM blockers
          WHERE id = ?
            AND EXISTS (
              SELECT 1
              FROM work_items wi
              WHERE wi.project_id = ?
                AND wi.id = blockers.work_item_id
                AND (wi.assigned_user_id = ? OR blockers.created_by_user_id = ?)
            )
        `
      )
      .run(blockerId, projectId, userId, userId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Blocker not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Blocker deleted successfully" });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to delete blocker" }, { status: 500 });
  }
}
