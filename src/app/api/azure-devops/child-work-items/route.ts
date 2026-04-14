export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";

interface ChildWorkItemRow {
  id: number;
  parent_external_id: number;
  child_external_id: number;
  title: string;
  work_item_type: string;
  state: string | null;
  assigned_to: string | null;
}

const parseParentId = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const isTaskResolvedOrClosed = (state?: string | null): boolean => {
  const normalized = state?.trim().toLowerCase();
  return normalized === "resolved" || normalized === "closed";
};

const normalizeItemType = (type?: string | null): string =>
  type?.trim().toLowerCase() ?? "";

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const parentId = parseParentId(request.nextUrl.searchParams.get("parentId"));

    if (!parentId) {
      return NextResponse.json({ error: "Valid parentId is required" }, { status: 400 });
    }

    const rows = db
      .prepare(
        `
          SELECT
            id,
            parent_external_id,
            child_external_id,
            title,
            work_item_type,
            state,
            assigned_to
          FROM release_work_item_children
          WHERE project_id = ?
            AND parent_external_id = ?
          ORDER BY
            CASE LOWER(TRIM(work_item_type))
              WHEN 'task' THEN 0
              WHEN 'bug' THEN 1
              ELSE 2
            END,
            updated_at DESC,
            child_external_id DESC
        `
      )
      .all(projectId, parentId) as ChildWorkItemRow[];

    const items = rows.map((row) => ({
      id: row.child_external_id,
      parentId: row.parent_external_id,
      title: row.title,
      type: row.work_item_type,
      state: row.state ?? "Unknown",
      assignedTo: row.assigned_to ?? undefined,
    }));

    const counts = items.reduce(
      (acc, item) => {
        const itemType = normalizeItemType(item.type);
        if (itemType === "task") acc.tasks += 1;
        if (itemType === "bug") acc.bugs += 1;
        if (itemType === "task" && isTaskResolvedOrClosed(item.state)) {
          acc.completedTasks += 1;
        }
        return acc;
      },
      { tasks: 0, bugs: 0, completedTasks: 0 }
    );

    return NextResponse.json({ parentId, counts, items });
  } catch (error) {
    console.error("Child work item query error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch child work items from database",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const rawParentIds = Array.isArray(body?.parentIds) ? body.parentIds : [];
    const parentIds = Array.from(
      new Set(
        rawParentIds
          .map((value: unknown) => parseParentId(value))
          .filter((value: number | null): value is number => value !== null)
      )
    );

    if (parentIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const placeholders = parentIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
          SELECT
            parent_external_id,
            SUM(CASE WHEN LOWER(TRIM(work_item_type)) = 'task' THEN 1 ELSE 0 END) as tasks_total,
            SUM(CASE WHEN LOWER(TRIM(work_item_type)) = 'bug' THEN 1 ELSE 0 END) as bugs_total,
            SUM(
              CASE
                WHEN LOWER(TRIM(work_item_type)) = 'task'
                  AND LOWER(TRIM(COALESCE(state, ''))) IN ('resolved', 'closed')
                THEN 1
                ELSE 0
              END
            ) as tasks_completed
          FROM release_work_item_children
          WHERE project_id = ?
            AND parent_external_id IN (${placeholders})
          GROUP BY parent_external_id
        `
      )
      .all(projectId, ...parentIds) as Array<{
      parent_external_id: number;
      tasks_total: number;
      bugs_total: number;
      tasks_completed: number;
    }>;

    const counts: Record<string, { tasks: number; bugs: number; completedTasks: number }> = {};
    for (const parentId of parentIds) {
      counts[String(parentId)] = { tasks: 0, bugs: 0, completedTasks: 0 };
    }

    for (const row of rows) {
      const key = String(row.parent_external_id);
      if (!counts[key]) continue;
      counts[key].tasks = row.tasks_total ?? 0;
      counts[key].bugs = row.bugs_total ?? 0;
      counts[key].completedTasks = row.tasks_completed ?? 0;
    }

    return NextResponse.json({ counts });
  } catch (error) {
    console.error("Child work item count query error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch child work item counts from database",
      },
      { status: 500 }
    );
  }
}
