export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

type ChildCounts = { tasks: number; bugs: number };

const buildChildTitles = (workItemTitle: string): [string, string, string] => {
  return [
    `BE: ${workItemTitle}`,
    `FE: ${workItemTitle}`,
    `Design: ${workItemTitle}`,
  ];
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const rawTitles = Array.isArray(body?.workItemTitles) ? body.workItemTitles : [];

    const validTitles = rawTitles
      .filter((value: unknown): value is string => typeof value === "string")
      .map((title: string) => title.trim())
      .filter((title: string) => title.length > 0);
    const titles: string[] = Array.from(new Set<string>(validTitles));

    if (titles.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const countStmt = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'task' THEN 1 ELSE 0 END) as task_count,
        SUM(CASE WHEN type = 'bug' THEN 1 ELSE 0 END) as bug_count
      FROM work_items
      WHERE project_id = ?
        AND title IN (?, ?, ?)
    `);

    const counts: Record<string, ChildCounts> = {};
    for (const title of titles) {
      const [backendTitle, frontendTitle, designTitle] = buildChildTitles(title);
      const row = countStmt.get(
        projectId,
        backendTitle,
        frontendTitle,
        designTitle
      ) as { task_count: number | null; bug_count: number | null } | undefined;

      counts[title] = {
        tasks: row?.task_count ?? 0,
        bugs: row?.bug_count ?? 0,
      };
    }

    return NextResponse.json({ counts });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch child task counts" },
      { status: 500 }
    );
  }
}
