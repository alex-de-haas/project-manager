export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  displayWorkItemStatus,
  displayWorkItemType,
} from "@/lib/work-items";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

interface ChildWorkItemRow {
  parent_external_id: string;
  child_external_id: string;
  title: string;
  work_item_type: string | null;
  state: string | null;
  status: string;
  assigned_to: string | null;
  assigned_user_name?: string | null;
  assigned_user_email?: string | null;
}

const parseParentId = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const isTaskResolvedOrClosed = (state?: string | null): boolean => {
  const normalized = state?.trim().toLowerCase();
  return (
    normalized === "resolved" ||
    normalized === "closed" ||
    normalized === "done" ||
    normalized === "completed"
  );
};

const normalizeItemType = (type?: string | null): string =>
  type?.trim().toLowerCase() ?? "";

const childQuery = `
  SELECT
    parent_link.external_id AS parent_external_id,
    child_link.external_id AS child_external_id,
    child.title,
    COALESCE(child_link.native_type, child.type) AS work_item_type,
    COALESCE(child_link.native_status, child.status) AS state,
    child.status,
    child_link.native_assignee_name AS assigned_to,
    assigned_user.name AS assigned_user_name,
    assigned_user.email AS assigned_user_email
  FROM work_items parent
  INNER JOIN work_item_external_links parent_link
    ON parent_link.work_item_id = parent.id
    AND parent_link.provider = 'azure_devops'
  INNER JOIN work_items child
    ON child.parent_work_item_id = parent.id
  LEFT JOIN work_item_external_links child_link
    ON child_link.work_item_id = child.id
    AND child_link.provider = 'azure_devops'
  LEFT JOIN users assigned_user ON assigned_user.id = child.assigned_user_id
  WHERE parent.project_id = ?
    AND parent_link.external_id = ?
    AND child.type IN ('task', 'bug')
`;

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
          ${childQuery}
          ORDER BY
            CASE child.type
              WHEN 'task' THEN 0
              WHEN 'bug' THEN 1
              ELSE 2
            END,
            child.updated_at DESC,
            CAST(COALESCE(child_link.external_id, child.id) AS INTEGER) DESC
        `
      )
      .all(projectId, String(parentId)) as ChildWorkItemRow[];

    const items = rows.map((row) => {
      const state = row.state ? displayWorkItemStatus(row.status) : displayWorkItemStatus(row.status);
      return {
        id: Number(row.child_external_id),
        parentId,
        title: row.title,
        type: displayWorkItemType(row.work_item_type),
        state: row.state ?? state,
        assignedTo:
          row.assigned_user_name ||
          row.assigned_user_email ||
          row.assigned_to ||
          undefined,
      };
    });

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
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Child work item query error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch child work items" },
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
            parent_link.external_id AS parent_external_id,
            SUM(CASE WHEN child.type = 'task' THEN 1 ELSE 0 END) as tasks_total,
            SUM(CASE WHEN child.type = 'bug' THEN 1 ELSE 0 END) as bugs_total,
            SUM(
              CASE
                WHEN child.type = 'task'
                  AND child.status IN ('resolved', 'completed')
                THEN 1
                ELSE 0
              END
            ) as tasks_completed
          FROM work_items parent
          INNER JOIN work_item_external_links parent_link
            ON parent_link.work_item_id = parent.id
            AND parent_link.provider = 'azure_devops'
          INNER JOIN work_items child
            ON child.parent_work_item_id = parent.id
          WHERE parent.project_id = ?
            AND parent_link.external_id IN (${placeholders})
            AND child.type IN ('task', 'bug')
          GROUP BY parent_link.external_id
        `
      )
      .all(projectId, ...parentIds.map(String)) as Array<{
      parent_external_id: string;
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
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Child work item count query error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch child work item counts" },
      { status: 500 }
    );
  }
}
