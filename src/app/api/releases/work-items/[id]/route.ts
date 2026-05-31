export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const params = await context.params;
    const id = Number(params.id);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: "Work item id must be a number" },
        { status: 400 }
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }
    const hasReleaseId = Object.prototype.hasOwnProperty.call(body, "release_id");
    const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");

    if (!hasReleaseId && !hasNotes) {
      return NextResponse.json(
        { error: "No fields provided to update" },
        { status: 400 }
      );
    }

    // Check if the work item exists
    const workItem = db
      .prepare(
        `
          SELECT ri.*
          FROM release_items ri
          INNER JOIN work_items wi ON wi.id = ri.work_item_id
          WHERE ri.id = ? AND wi.project_id = ?
        `
      )
      .get(id, projectId);

    if (!workItem) {
      return NextResponse.json(
        { error: "Work item not found" },
        { status: 404 }
      );
    }

    const fieldsToUpdate: string[] = [];
    const updateValues: Array<number | string | null> = [];

    if (hasReleaseId) {
      const releaseId = Number(body.release_id);
      if (Number.isNaN(releaseId)) {
        return NextResponse.json(
          { error: "Release id must be a number" },
          { status: 400 }
        );
      }

      // Check if the target release exists
      const release = db
        .prepare("SELECT * FROM releases WHERE id = ? AND project_id = ?")
        .get(releaseId, projectId) as { id: number; status?: string } | undefined;

      if (!release) {
        return NextResponse.json(
          { error: "Target release not found" },
          { status: 404 }
        );
      }

      if (release.status === "completed") {
        return NextResponse.json(
          { error: "Cannot move work items to a completed release" },
          { status: 400 }
        );
      }

      // Get the maximum display_order for the target release
      const maxOrderResult = db
        .prepare(
          `
            SELECT MAX(ri.display_order) as max_order
            FROM release_items ri
            INNER JOIN work_items wi ON wi.id = ri.work_item_id
            WHERE ri.release_id = ? AND wi.project_id = ?
          `
        )
        .get(releaseId, projectId) as { max_order: number | null };
      const nextOrder = (maxOrderResult.max_order ?? -1) + 1;

      fieldsToUpdate.push("release_id = ?", "display_order = ?");
      updateValues.push(releaseId, nextOrder);
    }

    if (hasNotes) {
      const rawNotes = body.notes;
      if (rawNotes !== null && rawNotes !== undefined && typeof rawNotes !== "string") {
        return NextResponse.json(
          { error: "Notes must be a string or null" },
          { status: 400 }
        );
      }

      const normalizedNotes =
        typeof rawNotes === "string" && rawNotes.trim().length > 0
          ? rawNotes.trim()
          : null;
      fieldsToUpdate.push("notes = ?");
      updateValues.push(normalizedNotes);
    }

    if (fieldsToUpdate.length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided to update" },
        { status: 400 }
      );
    }

    fieldsToUpdate.push("updated_at = CURRENT_TIMESTAMP");
    const stmt = db.prepare(
      `
        UPDATE release_items
        SET ${fieldsToUpdate.join(", ")}
        WHERE id = ?
          AND work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
      `
    );
    const result = stmt.run(...updateValues, id, projectId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Failed to update work item" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to update work item" },
      { status: 500 }
    );
  }
}
