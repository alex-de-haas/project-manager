export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

type ChildDiscipline = "backend" | "frontend" | "design";

const DISCIPLINE_PREFIX: Record<ChildDiscipline, string> = {
  backend: "BE:",
  frontend: "FE:",
  design: "Design:",
};

interface ChildTaskRow {
  id: number;
  title: string;
  status?: string | null;
  user_id: number;
  user_name?: string | null;
  user_email?: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const workItemTitle = (request.nextUrl.searchParams.get("workItemTitle") ?? "").trim();

    if (!workItemTitle) {
      return NextResponse.json(
        { error: "workItemTitle is required" },
        { status: 400 }
      );
    }

    const expectedTitles = [
      `${DISCIPLINE_PREFIX.backend} ${workItemTitle}`,
      `${DISCIPLINE_PREFIX.frontend} ${workItemTitle}`,
      `${DISCIPLINE_PREFIX.design} ${workItemTitle}`,
    ];

    const rows = db
      .prepare(
        `
        SELECT
          t.id,
          t.title,
          t.status,
          t.assigned_user_id as user_id,
          COALESCE(u.app_display_name, u.name) as user_name,
          u.email as user_email
        FROM work_items t
        LEFT JOIN users u ON u.id = t.assigned_user_id
        WHERE t.project_id = ?
          AND t.type = 'task'
          AND t.title IN (?, ?, ?)
        ORDER BY t.created_at DESC
      `
      )
      .all(projectId, ...expectedTitles) as ChildTaskRow[];

    const byDiscipline: Record<ChildDiscipline, ChildTaskRow[]> = {
      backend: [],
      frontend: [],
      design: [],
    };

    for (const row of rows) {
      if (row.title.startsWith(`${DISCIPLINE_PREFIX.backend} `)) {
        byDiscipline.backend.push(row);
      } else if (row.title.startsWith(`${DISCIPLINE_PREFIX.frontend} `)) {
        byDiscipline.frontend.push(row);
      } else if (row.title.startsWith(`${DISCIPLINE_PREFIX.design} `)) {
        byDiscipline.design.push(row);
      }
    }

    return NextResponse.json({ byDiscipline });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch existing child tasks" },
      { status: 500 }
    );
  }
}
