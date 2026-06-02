export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import {
  ensureTimeTrackingItem,
  upsertExternalLink,
} from "@/lib/work-items";

interface JsonImportEntry {
  date?: unknown;
  hours?: unknown;
}

interface JsonImportTimeEntryGroup {
  workItemId?: unknown;
  entries?: unknown;
}

interface JsonImportDayOff {
  date?: unknown;
  description?: unknown;
  isHalfDay?: unknown;
}

interface JsonImportPayload {
  schemaVersion?: unknown;
  timeEntries?: unknown;
  dayOffs?: unknown;
}

const SUPPORTED_SCHEMA_VERSION = "project-manager-legacy-export/v1";
const MAX_TIME_ENTRY_GROUPS = 10000;
const MAX_DAY_OFFS = 10000;

const isDateString = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseWorkItemId = (value: unknown): number => {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Every time entry group must have a positive numeric workItemId");
  }
  return parsed;
};

const parseHours = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Every imported time entry must have positive hours");
  }
  return parsed;
};

const normalizeDescription = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const assertObject = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
};

const getOrCreateTaskForWorkItem = (
  userId: number,
  projectId: number,
  workItemId: number
) => {
  const externalId = String(workItemId);
  const existing = db
    .prepare(
      `
      SELECT id
      FROM work_items wi
      INNER JOIN work_item_external_links link ON link.work_item_id = wi.id
      WHERE wi.assigned_user_id = ?
        AND wi.project_id = ?
        AND link.provider = 'azure_devops'
        AND link.external_id = ?
      ORDER BY id ASC
      LIMIT 1
    `
    )
    .get(userId, projectId, externalId) as { id: number } | undefined;

  if (existing) {
    return { taskId: existing.id, created: false };
  }

  const result = db
    .prepare(
      `
      INSERT INTO work_items (
        project_id,
        title,
        type,
        status,
        assigned_user_id,
        sync_state,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (?, ?, 'task', 'new', ?, 'synced', ?, ?)
    `
    )
    .run(projectId, `Azure DevOps #${workItemId}`, userId, userId, userId);

  upsertExternalLink({
    workItemId: Number(result.lastInsertRowid),
    projectId,
    provider: "azure_devops",
    externalId,
    nativeType: "Task",
    nativeStatus: "New",
  });

  return { taskId: Number(result.lastInsertRowid), created: true };
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);

    const payload = (await request.json()) as JsonImportPayload;

    if (payload.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return NextResponse.json(
        { error: `Unsupported JSON import schema. Expected ${SUPPORTED_SCHEMA_VERSION}.` },
        { status: 400 }
      );
    }

    const timeEntries = Array.isArray(payload.timeEntries)
      ? (payload.timeEntries as JsonImportTimeEntryGroup[])
      : [];
    const dayOffs = Array.isArray(payload.dayOffs)
      ? (payload.dayOffs as JsonImportDayOff[])
      : [];

    if (timeEntries.length > MAX_TIME_ENTRY_GROUPS || dayOffs.length > MAX_DAY_OFFS) {
      return NextResponse.json({ error: "JSON import file is too large." }, { status: 400 });
    }

    let tasksCreated = 0;
    let tasksMatched = 0;
    let importedTimeEntries = 0;
    let importedDayOffs = 0;

    const importData = db.transaction(() => {
      for (const group of timeEntries) {
        const normalizedGroup = assertObject(
          group,
          "Every time entry group must be an object"
        ) as JsonImportTimeEntryGroup;
        const workItemId = parseWorkItemId(normalizedGroup.workItemId);
        if (!Array.isArray(normalizedGroup.entries)) {
          throw new Error("Every time entry group must include an entries array");
        }

        const { taskId, created } = getOrCreateTaskForWorkItem(userId, projectId, workItemId);
        ensureTimeTrackingItem({
          projectId,
          userId,
          workItemId: taskId,
          addedByUserId: userId,
        });

        if (created) {
          tasksCreated += 1;
        } else {
          tasksMatched += 1;
        }

        for (const entry of normalizedGroup.entries as JsonImportEntry[]) {
          const normalizedEntry = assertObject(
            entry,
            "Every imported time entry must be an object"
          ) as JsonImportEntry;
          if (!isDateString(normalizedEntry.date)) {
            throw new Error("Every imported time entry must use YYYY-MM-DD dates");
          }
          const hours = parseHours(normalizedEntry.hours);
          db.prepare(
            `
            INSERT INTO time_entries (work_item_id, user_id, date, hours, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(work_item_id, user_id, date) DO UPDATE SET
              hours = excluded.hours,
              updated_at = CURRENT_TIMESTAMP
          `
          ).run(taskId, userId, normalizedEntry.date, hours);
          importedTimeEntries += 1;
        }
      }

      for (const dayOff of dayOffs) {
        const normalizedDayOff = assertObject(
          dayOff,
          "Every imported day off must be an object"
        ) as JsonImportDayOff;
        if (!isDateString(normalizedDayOff.date)) {
          throw new Error("Every imported day off must use YYYY-MM-DD dates");
        }

        db.prepare(
          `
          INSERT INTO day_offs (user_id, date, description, is_half_day)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, date) DO UPDATE SET
            description = excluded.description,
            is_half_day = excluded.is_half_day,
            updated_at = CURRENT_TIMESTAMP
        `
        ).run(
          userId,
          normalizedDayOff.date,
          normalizeDescription(normalizedDayOff.description),
          normalizedDayOff.isHalfDay === true ? 1 : 0
        );
        importedDayOffs += 1;
      }
    });

    importData();

    return NextResponse.json({
      imported: {
        timeEntries: importedTimeEntries,
        dayOffs: importedDayOffs,
        tasksCreated,
        tasksMatched,
      },
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("JSON import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import JSON data" },
      { status: 400 }
    );
  }
}
