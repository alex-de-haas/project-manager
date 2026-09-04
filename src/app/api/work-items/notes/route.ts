export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import { getUserProjectMembership } from "@/lib/work-items";

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// Notes are internal context shared by Planning and Time Management. Unlike title,
// type and description they stay editable on provider-linked work items, because no
// integration ever reads or writes them.
export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);

    if (!getUserProjectMembership(projectId, userId)) {
      return NextResponse.json({ error: "Project access denied" }, { status: 403 });
    }

    const body = await request.json();
    const workItemId = parsePositiveInteger(body?.workItemId ?? body?.id);

    if (!workItemId) {
      return NextResponse.json({ error: "Work item ID is required" }, { status: 400 });
    }

    const rawNotes = body?.notes;
    if (rawNotes !== null && rawNotes !== undefined && typeof rawNotes !== "string") {
      return NextResponse.json(
        { error: "Notes must be a string or null" },
        { status: 400 }
      );
    }

    const notes = typeof rawNotes === "string" && rawNotes.trim() ? rawNotes.trim() : null;

    const result = db
      .prepare(
        `
          UPDATE work_items
          SET notes = ?,
              updated_by_user_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND project_id = ?
        `
      )
      .run(notes, userId, workItemId, projectId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    return NextResponse.json({ notes });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update notes" }, { status: 500 });
  }
}
