"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type DayOffWithUser = {
  id: number;
  user_id?: number;
  user_name?: string;
  date: string;
  description?: string | null;
  is_half_day: number;
};

const WEEK_STARTS_ON_MONDAY = { weekStartsOn: 1 as const };
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function DayOffsCalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dayOffs, setDayOffs] = useState<DayOffWithUser[]>([]);
  const [loading, setLoading] = useState(true);

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
      const response = await fetch(
        `/api/day-offs?allUsers=true&startDate=${monthRange.startDate}&endDate=${monthRange.endDate}`
      );
      if (!response.ok) {
        throw new Error("Failed to load day-offs");
      }
      const data = (await response.json()) as DayOffWithUser[];
      setDayOffs(data);
    } catch (error) {
      console.error(error);
      setDayOffs([]);
    } finally {
      setLoading(false);
    }
  }, [monthRange.endDate, monthRange.startDate]);

  useEffect(() => {
    fetchDayOffs();
  }, [fetchDayOffs]);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Team Day-Off Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Overview of day-offs for all users.
            </p>
          </div>
          <div className="flex items-center gap-2">
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
          <CardContent className="space-y-3">
            <div className="grid grid-cols-7 gap-2">
              {WEEKDAY_LABELS.map((day) => (
                <div
                  key={day}
                  className="rounded-md border bg-muted/30 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {day}
                </div>
              ))}
            </div>

            {loading ? (
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: calendarDays.length }).map((_, index) => (
                  <Skeleton key={index} className="h-28 rounded-md" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {calendarDays.map((day) => {
                  const dateKey = format(day, "yyyy-MM-dd");
                  const entries = dayOffsByDate.get(dateKey) ?? [];
                  const inCurrentMonth = isSameMonth(day, currentMonth);
                  const isCurrentDay = isToday(day);
                  const hasDayOffs = entries.length > 0;

                  return (
                    <div
                      key={dateKey}
                      className={[
                        "min-h-28 rounded-md border p-2",
                        inCurrentMonth ? "text-foreground" : "text-muted-foreground",
                        isCurrentDay
                          ? "bg-orange-100 dark:bg-orange-950/50 border-orange-300 dark:border-orange-800"
                          : hasDayOffs
                          ? "bg-purple-100 dark:bg-purple-950/50 border-purple-300 dark:border-purple-800"
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
                              : hasDayOffs
                              ? "text-purple-700 dark:text-purple-400"
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
                      </div>
                      <div className="space-y-1">
                        {entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded bg-purple-50 px-2 py-1 text-[11px] leading-tight dark:bg-purple-950/40"
                          >
                            <div className="font-medium text-purple-700 dark:text-purple-300">
                              {entry.user_name ?? `User #${entry.user_id ?? "?"}`}
                            </div>
                            <div className="text-purple-600 dark:text-purple-400">
                              {entry.is_half_day ? "Half day" : "Full day"}
                              {entry.description ? ` • ${entry.description}` : ""}
                            </div>
                          </div>
                        ))}
                        {entries.length === 0 && inCurrentMonth && (
                          <div className="text-[11px] text-muted-foreground">No day-off</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

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
            className="border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
          >
            Day-off
          </Badge>
          <span className="ml-2">
            Showing {dayOffs.length} {dayOffs.length === 1 ? "entry" : "entries"} in{" "}
            {format(currentMonth, "MMMM yyyy")}
          </span>
        </div>
      </div>
    </div>
  );
}
