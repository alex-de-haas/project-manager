export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { requireAdminUser } from "@/lib/authorization";
import { getRequestProjectId } from "@/lib/user-context";

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
      FROM tasks
      WHERE user_id = ?
        AND project_id = ?
        AND external_source = 'azure_devops'
        AND external_id = ?
      ORDER BY id ASC
      LIMIT 1
    `
    )
    .get(userId, projectId, externalId) as { id: number } | undefined;

  if (existing) {
    return { taskId: existing.id, created: false };
  }

  const maxOrder = db
    .prepare("SELECT MAX(display_order) AS max_order FROM tasks WHERE user_id = ? AND project_id = ?")
    .get(userId, projectId) as { max_order: number | null };
  const displayOrder = (maxOrder.max_order ?? -1) + 1;

  const result = db
    .prepare(
      `
      INSERT INTO tasks (
        user_id,
        project_id,
        title,
        type,
        external_id,
        external_source,
        display_order
      )
      VALUES (?, ?, ?, 'task', ?, 'azure_devops', ?)
    `
    )
    .run(userId, projectId, `Azure DevOps #${workItemId}`, externalId, displayOrder);

  return { taskId: Number(result.lastInsertRowid), created: true };
};

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const userId = admin.userId;
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
            INSERT INTO time_entries (task_id, date, hours)
            VALUES (?, ?, ?)
            ON CONFLICT(task_id, date) DO UPDATE SET hours = excluded.hours
          `
          ).run(taskId, normalizedEntry.date, hours);
          importedTimeEntries += 1;
        }
      }

      for (const dayOff of dayOffs) {
        const normalizedDayOff = assertObject(
          dayOff,
          "Every imported day-off must be an object"
        ) as JsonImportDayOff;
        if (!isDateString(normalizedDayOff.date)) {
          throw new Error("Every imported day-off must use YYYY-MM-DD dates");
        }

        db.prepare(
          `
          INSERT INTO day_offs (user_id, project_id, date, description, is_half_day)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, project_id, date) DO UPDATE SET
            description = excluded.description,
            is_half_day = excluded.is_half_day
        `
        ).run(
          userId,
          projectId,
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
    console.error("JSON import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import JSON data" },
      { status: 400 }
    );
  }
}
