export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { TimeBalance } from "@/types";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import {
  computeExpectedHours,
  countBusinessDays,
  isIsoDate,
  resolveBalanceRange,
  resolveCutoff,
} from "@/lib/time-balance";
import {
  DEFAULT_DAY_LENGTH_SETTING_KEY,
  getModuleDefaultDayLength,
  parseDefaultDayLength,
} from "@/lib/work-schedule";

// Hours are REAL, so summing thousands of quarter-hour entries drifts into 167.99999999999997.
// Four decimals keep the wire value clean without distorting a 20-minute (1/3 h) entry.
const roundHours = (hours: number) => Math.round(hours * 10000) / 10000;

const resolveDayLength = (userId: number, projectId: number) => {
  const setting = db
    .prepare("SELECT value FROM settings WHERE key = ? AND user_id = ? AND project_id = ?")
    .get(DEFAULT_DAY_LENGTH_SETTING_KEY, userId, projectId) as { value: string } | undefined;

  return parseDefaultDayLength(setting?.value) ?? getModuleDefaultDayLength();
};

/**
 * Overtime carried into the period that starts on `asOf`.
 *
 * The whole point of this route is that the answer is a scalar: the balance spans the user's
 * entire history in the active project, but only aggregates cross the wire, and neither side
 * ever walks the range day by day.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const asOf = request.nextUrl.searchParams.get("asOf");

    if (!isIsoDate(asOf)) {
      return NextResponse.json(
        { error: "An asOf date in YYYY-MM-DD format is required" },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const cutoff = resolveCutoff(asOf, today);

    // The baseline is the first tracked day, so "everything before the cutoff" already *is*
    // the balance range — the sum and the baseline come from a single index range scan.
    // The predicates mirror the time-entry query in /api/tasks so the balance and the grid
    // can never disagree about which entries count.
    const tracked = db
      .prepare(
        `
          SELECT
            COALESCE(SUM(te.hours), 0) AS tracked_hours,
            MIN(te.date) AS baseline_date
          FROM time_entries te
          INNER JOIN work_items wi ON wi.id = te.work_item_id
          WHERE te.user_id = ?
            AND wi.project_id = ?
            AND wi.type IN ('task', 'bug')
            AND te.date < ?
        `
      )
      .get(userId, projectId, cutoff) as {
      tracked_hours: number;
      baseline_date: string | null;
    };

    const range = resolveBalanceRange(asOf, today, tracked.baseline_date);
    const dayLength = resolveDayLength(userId, projectId);

    if (!range) {
      const empty: TimeBalance = {
        asOf,
        baselineDate: null,
        openingBalance: 0,
        trackedHours: 0,
        expectedHours: 0,
        dayLength,
      };
      return NextResponse.json(empty);
    }

    // Day-offs that fall on a weekend are excluded here rather than in JS: the expectation for
    // those days is already zero, so subtracting them would invent a surplus.
    const dayOffs = db
      .prepare(
        `
          SELECT
            COALESCE(SUM(CASE WHEN is_half_day = 1 THEN 0 ELSE 1 END), 0) AS full_days,
            COALESCE(SUM(CASE WHEN is_half_day = 1 THEN 1 ELSE 0 END), 0) AS half_days
          FROM day_offs
          WHERE user_id = ?
            AND date >= ?
            AND date < ?
            AND CAST(strftime('%w', date) AS INTEGER) NOT IN (0, 6)
        `
      )
      .get(userId, range.startInclusive, range.endExclusive) as {
      full_days: number;
      half_days: number;
    };

    const expectedHours = computeExpectedHours({
      businessDays: countBusinessDays(range.startInclusive, range.endExclusive),
      fullDayOffs: dayOffs.full_days,
      halfDayOffs: dayOffs.half_days,
      dayLength,
    });

    const balance: TimeBalance = {
      asOf,
      baselineDate: range.startInclusive,
      openingBalance: roundHours(tracked.tracked_hours - expectedHours),
      trackedHours: roundHours(tracked.tracked_hours),
      expectedHours: roundHours(expectedHours),
      dayLength,
    };

    return NextResponse.json(balance);
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Error computing time balance:", error);
    return NextResponse.json({ error: "Failed to compute time balance" }, { status: 500 });
  }
}
