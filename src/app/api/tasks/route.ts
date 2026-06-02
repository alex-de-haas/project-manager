export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Blocker, TaskWithTimeEntries, TrackableWorkItemType, WorkItem } from "@/types";
import {
  applyLocalStatusChange,
  displayWorkItemStatus,
  ensureTimeTrackingItem,
  getNextTimeTrackingDisplayOrder,
  getUserProjectMembership,
  getWorkItemForUser,
  isTrackableWorkItemType,
  normalizeWorkItemType,
} from "@/lib/work-items";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

interface ChecklistSummary {
  work_item_id: number;
  total: number;
  completed: number;
}

interface TimeEntryTotal {
  work_item_id: number;
  total_hours: number;
}

type WorkItemRow = Omit<WorkItem, "type"> & {
  type: TrackableWorkItemType;
  assignedUserName?: string | null;
  assignedUserEmail?: string | null;
};

const parsePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const serializeWorkItemStatus = <T extends { status?: string | null }>(item: T): T => ({
  ...item,
  status: displayWorkItemStatus(item.status),
});

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get("month");
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    let startDate: string;
    let endDate: string;

    if (startDateParam && endDateParam) {
      startDate = startDateParam;
      endDate = endDateParam;
    } else if (month) {
      const [year, monthNum] = month.split("-");
      startDate = `${year}-${monthNum}-01`;
      endDate = `${year}-${monthNum}-31`;
    } else {
      return NextResponse.json(
        { error: "Either month or startDate/endDate parameters are required" },
        { status: 400 }
      );
    }

    const tasks = db
      .prepare(
        `
          SELECT
            wi.*,
            tti.display_order AS display_order,
            wi.assigned_user_id AS user_id,
            COALESCE(u.app_display_name, u.name) AS assignedUserName,
            u.email AS assignedUserEmail,
            link.provider AS external_source,
            link.external_id,
            link.native_assignee_id AS azure_assigned_to_id,
            link.native_assignee_name AS azure_assigned_to_name,
            link.native_assignee_unique_name AS azure_assigned_to_unique_name,
            link.native_assignee_is_current_user AS azure_assignee_is_current_user
          FROM time_tracking_items tti
          INNER JOIN work_items wi
            ON wi.id = tti.work_item_id
            AND wi.project_id = tti.project_id
          LEFT JOIN users u ON u.id = wi.assigned_user_id
          LEFT JOIN work_item_external_links link ON link.work_item_id = wi.id
          WHERE tti.project_id = ?
            AND tti.user_id = ?
            AND wi.type IN ('task', 'bug')
            AND (
              (DATE(wi.created_at) <= ? AND (wi.completed_at IS NULL OR DATE(wi.completed_at) >= ?))
              OR EXISTS (
                SELECT 1
                FROM time_entries te_scope
                WHERE te_scope.work_item_id = wi.id
                  AND te_scope.user_id = ?
                  AND te_scope.date >= ?
                  AND te_scope.date <= ?
                  AND te_scope.hours > 0
              )
            )
          ORDER BY
            COALESCE(tti.display_order, 999999),
            tti.created_at ASC
        `
      )
      .all(projectId, userId, endDate, startDate, userId, startDate, endDate) as WorkItemRow[];

    const timeEntries = db
      .prepare(
        `
          SELECT te.work_item_id, te.date, te.hours
          FROM time_entries te
          INNER JOIN work_items wi ON wi.id = te.work_item_id
          WHERE wi.project_id = ?
            AND wi.type IN ('task', 'bug')
            AND te.user_id = ?
            AND te.date >= ?
            AND te.date <= ?
        `
      )
      .all(projectId, userId, startDate, endDate) as Array<{
      work_item_id: number;
      date: string;
      hours: number;
    }>;

    const blockers = db
      .prepare(
        `
          SELECT b.*, b.work_item_id AS task_id
          FROM blockers b
          INNER JOIN work_items wi ON wi.id = b.work_item_id
          INNER JOIN time_tracking_items tti
            ON tti.work_item_id = wi.id
            AND tti.project_id = wi.project_id
            AND tti.user_id = ?
          WHERE wi.project_id = ?
            AND wi.type IN ('task', 'bug')
            AND b.is_resolved = 0
            AND (
              (DATE(wi.created_at) <= ? AND (wi.completed_at IS NULL OR DATE(wi.completed_at) >= ?))
              OR EXISTS (
                SELECT 1
                FROM time_entries te_scope
                WHERE te_scope.work_item_id = wi.id
                  AND te_scope.user_id = ?
                  AND te_scope.date >= ?
                  AND te_scope.date <= ?
                  AND te_scope.hours > 0
              )
            )
          ORDER BY b.work_item_id, b.created_at DESC
        `
      )
      .all(userId, projectId, endDate, startDate, userId, startDate, endDate) as Blocker[];

    const checklistSummaries = db
      .prepare(
        `
          SELECT
            ci.work_item_id,
            COUNT(*) as total,
            SUM(CASE WHEN ci.is_completed = 1 THEN 1 ELSE 0 END) as completed
          FROM checklist_items ci
          INNER JOIN work_items wi ON wi.id = ci.work_item_id
          WHERE ci.user_id = ?
            AND wi.project_id = ?
          GROUP BY ci.work_item_id
        `
      )
      .all(userId, projectId) as ChecklistSummary[];

    const checklistMap = new Map<number, { total: number; completed: number }>();
    checklistSummaries.forEach((summary) => {
      checklistMap.set(summary.work_item_id, {
        total: summary.total,
        completed: summary.completed,
      });
    });

    const timeEntryTotals = db
      .prepare(
        `
          SELECT te.work_item_id, SUM(te.hours) as total_hours
          FROM time_entries te
          INNER JOIN work_items wi ON wi.id = te.work_item_id
          WHERE wi.project_id = ?
            AND wi.type IN ('task', 'bug')
            AND te.user_id = ?
          GROUP BY te.work_item_id
        `
      )
      .all(projectId, userId) as TimeEntryTotal[];

    const timeEntryTotalMap = new Map<number, number>();
    timeEntryTotals.forEach((entry) => {
      timeEntryTotalMap.set(entry.work_item_id, entry.total_hours ?? 0);
    });

    const tasksWithEntries: TaskWithTimeEntries[] = tasks.map((task) => {
      const entries: Record<string, number> = {};

      timeEntries
        .filter((entry) => entry.work_item_id === task.id)
        .forEach((entry) => {
          entries[entry.date] = entry.hours;
        });

      const taskBlockers = blockers.filter((blocker) => blocker.work_item_id === task.id);
      const checklistSummary = checklistMap.get(task.id);

      return serializeWorkItemStatus({
        ...task,
        timeEntries: entries,
        totalHoursTracked: timeEntryTotalMap.get(task.id) ?? 0,
        assignedUserName: task.assignedUserName ?? null,
        assignedUserEmail: task.assignedUserEmail ?? null,
        isAssignedToCurrentUser: task.assigned_user_id === userId,
        azureAssignedToName: task.azure_assigned_to_name ?? null,
        azureAssignedToUniqueName: task.azure_assigned_to_unique_name ?? null,
        isAzureAssignedToCurrentUser:
          task.azure_assignee_is_current_user === null ||
          task.azure_assignee_is_current_user === undefined
            ? null
            : Boolean(task.azure_assignee_is_current_user),
        blockers: taskBlockers,
        checklistSummary,
      });
    });

    return NextResponse.json(tasksWithEntries);
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch work items" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description =
      typeof body?.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const type = normalizeWorkItemType(body?.type);
    const requestedUserId = parsePositiveInteger(body?.userId);
    const parentWorkItemId = parsePositiveInteger(body?.parentWorkItemId);

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!isTrackableWorkItemType(type)) {
      return NextResponse.json(
        { error: 'Type must be either "task" or "bug"' },
        { status: 400 }
      );
    }

    const targetUserId = requestedUserId ?? userId;
    if (!getUserProjectMembership(projectId, targetUserId)) {
      return NextResponse.json(
        { error: "Selected user is not assigned to this project" },
        { status: 400 }
      );
    }

    if (parentWorkItemId) {
      const parent = db
        .prepare(
          "SELECT id FROM work_items WHERE id = ? AND project_id = ? AND type = 'user_story'"
        )
        .get(parentWorkItemId, projectId) as { id: number } | undefined;
      if (!parent) {
        return NextResponse.json(
          { error: "Parent user story not found" },
          { status: 400 }
        );
      }
    }

    const newOrder = getNextTimeTrackingDisplayOrder(projectId, targetUserId);

    const createWorkItem = db.transaction(() => {
      const result = db
        .prepare(
          `
            INSERT INTO work_items (
              project_id,
              title,
              description,
              type,
              status,
              assigned_user_id,
              parent_work_item_id,
              sync_state,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES (?, ?, ?, ?, 'new', ?, ?, 'not_synced', ?, ?)
          `
        )
        .run(
          projectId,
          title,
          description,
          type,
          targetUserId,
          parentWorkItemId,
          userId,
          userId
        );

      const workItemId = Number(result.lastInsertRowid);
      ensureTimeTrackingItem({
        projectId,
        userId: targetUserId,
        workItemId,
        addedByUserId: userId,
        displayOrder: newOrder,
      });

      return result;
    });

    const result = createWorkItem();

    return NextResponse.json(
      { message: "Work item created successfully", id: result.lastInsertRowid },
      { status: 201 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to create work item" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const id = parsePositiveInteger(body?.id ?? body?.taskId);

    if (!id) {
      return NextResponse.json({ error: "Work item ID is required" }, { status: 400 });
    }

    const item = getWorkItemForUser(id, projectId, userId, {
      requireAssigned: true,
      requireTrackable: true,
      requireTimeTracking: true,
    });
    if (!item) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    if (body?.status !== undefined) {
      const result = applyLocalStatusChange({
        workItemId: id,
        projectId,
        userId,
        status: String(body.status),
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      return NextResponse.json({ message: "Work item updated successfully" });
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (body?.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) {
        return NextResponse.json({ error: "Title is required" }, { status: 400 });
      }
      updates.push("title = ?");
      values.push(title);
    }

    if (body?.description !== undefined) {
      const description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null;
      updates.push("description = ?");
      values.push(description);
    }

    if (body?.type !== undefined) {
      const type = normalizeWorkItemType(body.type, item.type);
      if (!isTrackableWorkItemType(type)) {
        return NextResponse.json(
          { error: 'Type must be either "task" or "bug"' },
          { status: 400 }
        );
      }
      updates.push("type = ?");
      values.push(type);
    }

    if (body?.userId !== undefined) {
      const targetUserId = parsePositiveInteger(body.userId);
      if (!targetUserId || !getUserProjectMembership(projectId, targetUserId)) {
        return NextResponse.json(
          { error: "Selected user is not assigned to this project" },
          { status: 400 }
        );
      }
      updates.push("assigned_user_id = ?");
      values.push(targetUserId);
    }

    if (body?.parentWorkItemId !== undefined) {
      const parentWorkItemId = parsePositiveInteger(body.parentWorkItemId);
      if (parentWorkItemId) {
        const parent = db
          .prepare(
            "SELECT id FROM work_items WHERE id = ? AND project_id = ? AND type = 'user_story'"
          )
          .get(parentWorkItemId, projectId) as { id: number } | undefined;
        if (!parent) {
          return NextResponse.json(
            { error: "Parent user story not found" },
            { status: 400 }
          );
        }
      }
      updates.push("parent_work_item_id = ?");
      values.push(parentWorkItemId);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No valid update fields provided" }, { status: 400 });
    }

    updates.push("updated_by_user_id = ?");
    values.push(userId);
    updates.push("updated_at = CURRENT_TIMESTAMP");

    const result = db
      .prepare(
        `
          UPDATE work_items
          SET ${updates.join(", ")}
          WHERE id = ?
            AND project_id = ?
            AND assigned_user_id = ?
            AND type IN ('task', 'bug')
            AND EXISTS (
              SELECT 1
              FROM time_tracking_items tti
              WHERE tti.work_item_id = work_items.id
                AND tti.project_id = work_items.project_id
                AND tti.user_id = ?
            )
        `
      )
      .run(...values, id, projectId, userId, userId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Work item updated successfully" });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update work item" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const id = parsePositiveInteger(request.nextUrl.searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "Work item ID is required" }, { status: 400 });
    }

    const result = db
      .prepare(
        `
          DELETE FROM work_items
          WHERE id = ?
            AND assigned_user_id = ?
            AND project_id = ?
            AND type IN ('task', 'bug')
            AND EXISTS (
              SELECT 1
              FROM time_tracking_items tti
              WHERE tti.work_item_id = work_items.id
                AND tti.project_id = work_items.project_id
                AND tti.user_id = ?
            )
        `
      )
      .run(id, userId, projectId, userId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Work item not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Work item deleted successfully" });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to delete work item" }, { status: 500 });
  }
}
