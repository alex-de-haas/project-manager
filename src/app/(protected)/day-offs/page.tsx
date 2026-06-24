"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isSaturday,
  isSunday,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayOff } from "@/types";

const DayOffsModal = dynamic(
  () =>
    import("@/features/day-offs/components/DayOffsModal").then(
      (mod) => mod.DayOffsModal
    ),
  { ssr: false }
);

type DayOffWithUser = DayOff & {
  user_name?: string;
};

type ProjectMember = {
  id: number;
  name: string;
};

const WEEK_STARTS_ON_MONDAY = { weekStartsOn: 1 as const };
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Distinct, theme-friendly hues assigned per user. Solid hex is used for the
// dot/border; the same hex with an alpha suffix tints the chip background so it
// stays readable in both light and dark mode.
const USER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#db2777",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#65a30d",
  "#c026d3",
  "#0d9488",
  "#ea580c",
  "#4f46e5",
] as const;

const colorForIndex = (index: number) =>
  USER_COLORS[((index % USER_COLORS.length) + USER_COLORS.length) % USER_COLORS.length];

export default function DayOffsCalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dayOffs, setDayOffs] = useState<DayOffWithUser[]>([]);
  const [currentUserDayOffs, setCurrentUserDayOffs] = useState<DayOff[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDayOffsModal, setShowDayOffsModal] = useState(false);

  // Stable color per user, assigned by the member's position in the project
  // member list so a user keeps the same color across months. Day offs from
  // users no longer in the project fall back to a deterministic id-based color.
  const colorForUser = useCallback(
    (userId?: number | null) => {
      if (userId == null) return USER_COLORS[0];
      const memberIndex = members.findIndex((member) => member.id === userId);
      return colorForIndex(memberIndex >= 0 ? memberIndex : userId);
    },
    [members]
  );

  const monthRange = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    return {
      startDate: format(monthStart, "yyyy-MM-dd"),
      endDate: format(monthEnd, "yyyy-MM-dd"),
      monthStart,
      monthEnd,
    };
  }, [currentMonth]);

  const calendarDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(monthRange.monthStart, WEEK_STARTS_ON_MONDAY),
        end: endOfWeek(monthRange.monthEnd, WEEK_STARTS_ON_MONDAY),
      }),
    [monthRange.monthEnd, monthRange.monthStart]
  );

  const dayOffsByDate = useMemo(() => {
    const grouped = new Map<string, DayOffWithUser[]>();
    for (const dayOff of dayOffs) {
      const current = grouped.get(dayOff.date) ?? [];
      current.push(dayOff);
      grouped.set(dayOff.date, current);
    }

    for (const entries of Array.from(grouped.values())) {
      entries.sort((a, b) => (a.user_name ?? "").localeCompare(b.user_name ?? ""));
    }

    return grouped;
  }, [dayOffs]);

  const fetchDayOffs = useCallback(async () => {
    setLoading(true);
    try {
      const teamDayOffsUrl = `/api/day-offs?allUsers=true&startDate=${monthRange.startDate}&endDate=${monthRange.endDate}`;
      const currentUserDayOffsUrl = `/api/day-offs?startDate=${monthRange.startDate}&endDate=${monthRange.endDate}`;

      const [teamResponse, currentUserResponse] = await Promise.all([
        fetch(teamDayOffsUrl),
        fetch(currentUserDayOffsUrl),
      ]);

      if (!teamResponse.ok || !currentUserResponse.ok) {
        throw new Error("Failed to load days off");
      }

      const [teamDayOffs, userDayOffs] = await Promise.all([
        teamResponse.json() as Promise<DayOffWithUser[]>,
        currentUserResponse.json() as Promise<DayOff[]>,
      ]);

      setDayOffs(teamDayOffs);
      setCurrentUserDayOffs(userDayOffs);
    } catch (error) {
      console.error(error);
      setDayOffs([]);
      setCurrentUserDayOffs([]);
    } finally {
      setLoading(false);
    }
  }, [monthRange.endDate, monthRange.startDate]);

  useEffect(() => {
    fetchDayOffs();
  }, [fetchDayOffs]);

  useEffect(() => {
    let cancelled = false;

    const fetchMembers = async () => {
      try {
        const response = await fetch("/api/project-members");
        if (!response.ok) {
          throw new Error("Failed to load project members");
        }
        const data = (await response.json()) as ProjectMember[];
        if (!cancelled) {
          setMembers(data);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setMembers([]);
        }
      }
    };

    fetchMembers();

    return () => {
      cancelled = true;
    };
  }, []);

  const usersInMonth = useMemo(() => {
    const byUser = new Map<number, string>();
    for (const dayOff of dayOffs) {
      if (dayOff.user_id == null) continue;
      if (!byUser.has(dayOff.user_id)) {
        byUser.set(
          dayOff.user_id,
          dayOff.user_name ?? `User #${dayOff.user_id}`
        );
      }
    }
    return Array.from(byUser.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dayOffs]);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Team Days Off Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Overview of days off for all users.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowDayOffsModal(true)}>
              + Add Day Off
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setCurrentMonth(new Date())}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{format(currentMonth, "MMMM yyyy")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto pb-2">
              <div className="min-w-[720px] space-y-3">
                <div className="grid grid-cols-7 gap-2">
                  {WEEKDAY_LABELS.map((day, index) => {
                    const isWeekendLabel = index >= 5;

                    return (
                      <div
                        key={day}
                        className={[
                          "rounded-md border py-2 text-center text-xs font-medium uppercase tracking-wide",
                          isWeekendLabel
                            ? "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
                            : "bg-muted/30 text-muted-foreground",
                        ].join(" ")}
                      >
                        {day}
                      </div>
                    );
                  })}
                </div>

                {!loading && (
                  <div className="grid grid-cols-7 gap-2">
                    {calendarDays.map((day) => {
                      const dateKey = format(day, "yyyy-MM-dd");
                      const entries = dayOffsByDate.get(dateKey) ?? [];
                      const inCurrentMonth = isSameMonth(day, currentMonth);
                      const isCurrentDay = isToday(day);
                      const isWeekend = isSaturday(day) || isSunday(day);

                      return (
                        <div
                          key={dateKey}
                          className={[
                            "min-h-28 rounded-md border p-2",
                            inCurrentMonth ? "text-foreground" : "text-muted-foreground",
                            isCurrentDay
                              ? "bg-orange-100 dark:bg-orange-950/50 border-orange-300 dark:border-orange-800"
                              : isWeekend && inCurrentMonth
                              ? "bg-slate-100 border-slate-300 dark:bg-slate-900/70 dark:border-slate-700"
                              : isWeekend
                              ? "bg-slate-50/70 border-slate-200 dark:bg-slate-900/40 dark:border-slate-800"
                              : inCurrentMonth
                              ? "bg-background border-border"
                              : "bg-muted/25 border-border",
                          ].join(" ")}
                        >
                          <div className="mb-2 flex items-center justify-between text-xs font-medium">
                            <span
                              className={
                                isCurrentDay
                                  ? "text-orange-600 dark:text-orange-400"
                                  : isWeekend
                                  ? "text-slate-700 dark:text-slate-200"
                                  : undefined
                              }
                            >
                              {format(day, "d")}
                            </span>
                            {isCurrentDay && (
                              <Badge
                                variant="outline"
                                className="h-5 border-orange-300 bg-orange-50 px-1.5 text-[10px] text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
                              >
                                Today
                              </Badge>
                            )}
                            {!isCurrentDay && isWeekend && (
                              <Badge
                                variant="outline"
                                className="h-5 border-slate-300 bg-slate-50 px-1.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              >
                                Weekend
                              </Badge>
                            )}
                          </div>
                          <div className="space-y-1">
                            {entries.map((entry) => {
                              const color = colorForUser(entry.user_id);

                              return (
                                <div
                                  key={entry.id}
                                  className="rounded px-2 py-1 text-[11px] leading-tight"
                                  style={{
                                    backgroundColor: `${color}1f`,
                                    borderLeft: `3px solid ${color}`,
                                  }}
                                >
                                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                                    <span
                                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: color }}
                                    />
                                    <span className="truncate">
                                      {entry.user_name ?? `User #${entry.user_id ?? "?"}`}
                                    </span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    {entry.is_half_day ? "Half day" : "Full day"}
                                    {entry.description ? ` • ${entry.description}` : ""}
                                  </div>
                                </div>
                              );
                            })}
                            {entries.length === 0 && inCurrentMonth && (
                              <div className="text-[11px] text-muted-foreground">
                                {isWeekend ? "Weekend" : "No day off"}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {!loading && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Legend:</span>
              <Badge
                variant="outline"
                className="border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
              >
                Today
              </Badge>
              <Badge
                variant="outline"
                className="border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Weekend
              </Badge>
              <span className="ml-2">
                Showing {dayOffs.length} {dayOffs.length === 1 ? "entry" : "entries"} in{" "}
                {format(currentMonth, "MMMM yyyy")}
              </span>
            </div>
            {usersInMonth.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <span>Users:</span>
                {usersInMonth.map((user) => {
                  const color = colorForUser(user.id);

                  return (
                    <span key={user.id} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-foreground">{user.name}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showDayOffsModal && (
        <DayOffsModal
          onClose={() => setShowDayOffsModal(false)}
          onSuccess={() => {
            setShowDayOffsModal(false);
            fetchDayOffs();
          }}
          currentDayOffs={currentUserDayOffs}
        />
      )}
    </div>
  );
}
