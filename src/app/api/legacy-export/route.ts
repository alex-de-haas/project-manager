export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getRequestUserId } from "@/lib/user-context";

interface TimeEntryRow {
  external_id: string | number | null;
  date: string;
  hours: number | null;
}

interface DayOffRow {
  date: string;
  description: string | null;
  is_half_day: number;
}

interface LegacyExportTimeEntry {
  workItemId: number;
  entries: Array<{
    date: string;
    hours: number;
  }>;
}

interface LegacyExportPayload {
  schemaVersion: "project-manager-legacy-export/v1";
  exportedAt: string;
  timeEntries: LegacyExportTimeEntry[];
  dayOffs: Array<{
    date: string;
    description: string | null;
    isHalfDay: boolean;
  }>;
}

const parseNumericWorkItemId = (value: string | number | null): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const buildFileName = () => {
  const date = new Date().toISOString().slice(0, 10);
  return `project-manager-legacy-export-${date}.json`;
};

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);

    const timeRows = db
      .prepare(`
        SELECT
          t.external_id,
          te.date,
          SUM(te.hours) AS hours
        FROM time_entries te
        INNER JOIN tasks t ON t.id = te.task_id
        WHERE t.user_id = ?
          AND t.external_source = 'azure_devops'
          AND t.external_id IS NOT NULL
        GROUP BY t.external_id, te.date
        ORDER BY CAST(t.external_id AS INTEGER) ASC, te.date ASC
      `)
      .all(userId) as TimeEntryRow[];

    const entriesByWorkItem = new Map<number, Map<string, number>>();

    for (const row of timeRows) {
      const workItemId = parseNumericWorkItemId(row.external_id);
      const hours = Number(row.hours ?? 0);
      if (!workItemId || !row.date || !Number.isFinite(hours) || hours === 0) {
        continue;
      }

      const entriesByDate = entriesByWorkItem.get(workItemId) ?? new Map<string, number>();
      entriesByDate.set(row.date, (entriesByDate.get(row.date) ?? 0) + hours);
      entriesByWorkItem.set(workItemId, entriesByDate);
    }

    const timeEntries = Array.from(entriesByWorkItem.entries())
      .sort(([left], [right]) => left - right)
      .map(([workItemId, entriesByDate]) => ({
        workItemId,
        entries: Array.from(entriesByDate.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, hours]) => ({
            date,
            hours,
          })),
      }));

    const dayOffRows = db
      .prepare(`
        SELECT date, description, MAX(is_half_day) AS is_half_day
        FROM day_offs
        WHERE user_id = ?
        GROUP BY date, description
        ORDER BY date ASC
      `)
      .all(userId) as DayOffRow[];

    const payload: LegacyExportPayload = {
      schemaVersion: "project-manager-legacy-export/v1",
      exportedAt: new Date().toISOString(),
      timeEntries,
      dayOffs: dayOffRows.map((row) => ({
        date: row.date,
        description: row.description,
        isHalfDay: row.is_half_day === 1,
      })),
    };

    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="${buildFileName()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Legacy export error:", error);
    return NextResponse.json(
      { error: "Failed to export legacy data" },
      { status: 500 }
    );
  }
}
