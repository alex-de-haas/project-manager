export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

export async function POST(
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

    const row = db
      .prepare(
        `
          SELECT ri.work_item_id
          FROM release_items ri
          INNER JOIN work_items wi ON wi.id = ri.work_item_id
          WHERE ri.id = ? AND wi.project_id = ?
        `
      )
      .get(id, projectId) as { work_item_id: number } | undefined;

    if (!row) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    return NextResponse.json({ taskId: row.work_item_id });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to prepare blockers" },
      { status: 500 }
    );
  }
}
