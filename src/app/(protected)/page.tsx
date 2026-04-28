"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { KeyboardEvent } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isToday,
  addWeeks,
  addMonths,
  isSaturday,
  isSunday,
  parseISO,
} from "date-fns";
import type { TaskWithTimeEntries, DayOff, Blocker } from "@/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkItemModal } from "@/features/tasks";
import { ImportModal, ExportToDevOpsModal } from "@/features/azure-devops";
import { BlockersModal } from "@/features/blockers";
import { ChecklistModal } from "@/features/checklist";
import { Bug, ClipboardCheck, GripVertical, ListChecks, Clock3, Upload } from "lucide-react";
import { ShieldAlert, Trash2, MoreVertical, TreePalm, Pencil, Filter } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const WEEK_STARTS_ON_MONDAY = { weekStartsOn: 1 as const };
const MAX_VISIBLE_TASK_TAGS = 3;
const CHIP_GAP_PX = 6;
const COMPLETED_STATUSES = new Set(["closed", "resolved", "done", "completed"]);

const parseTaskTags = (rawTags?: string | null): string[] =>
  rawTags
    ? rawTags
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

const getStatusTone = (status?: string | null) => {
  const normalizedStatus = status?.toLowerCase();

  if (normalizedStatus === "active") {
    return {
      textClassName: "text-blue-700 dark:text-blue-400",
      badgeClassName:
        "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400",
    };
  }

  if (normalizedStatus === "resolved" || normalizedStatus === "closed") {
    return {
      textClassName: "text-green-700 dark:text-green-400",
      badgeClassName:
        "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
    };
  }

  return {
    textClassName: "text-muted-foreground",
    badgeClassName:
      "border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground",
  };
};

interface SortableRowProps {
  id: number;
  children: React.ReactNode;
  rowClassName: string;
  dragHandleBgClassName: string;
}

interface TaskMetaRowProps {
  status?: string | null;
  tags?: string | null;
  activeBlockers: Blocker[];
  checklistSummary?: TaskWithTimeEntries["checklistSummary"];
  onOpenBlockers: () => void;
  onOpenChecklist: () => void;
}

const estimateChipWidth = (label: string, hasIcon = false) => {
  const baseWidth = hasIcon ? 34 : 22;
  return baseWidth + label.length * 8;
};

function TaskMetaRow({
  status,
  tags,
  activeBlockers,
  checklistSummary,
  onOpenBlockers,
  onOpenChecklist,
}: TaskMetaRowProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const parsedTags = useMemo(() => parseTaskTags(tags), [tags]);
  const statusTone = getStatusTone(status);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      setContainerWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const visibleTags = useMemo(() => {
    if (parsedTags.length === 0) {
      return { tags: [] as string[], hiddenCount: 0 };
    }

    if (containerWidth <= 0) {
      const fallbackCount = Math.min(1, parsedTags.length);
      return {
        tags: parsedTags.slice(0, fallbackCount),
        hiddenCount: parsedTags.length - fallbackCount,
      };
    }

    const fixedChipWidths = [
      estimateChipWidth(status || "New"),
      ...(activeBlockers.length > 0
        ? [estimateChipWidth(String(activeBlockers.length), true)]
        : []),
      ...(checklistSummary && checklistSummary.total > 0
        ? [
            estimateChipWidth(
              `${checklistSummary.completed}/${checklistSummary.total}`,
              true
            ),
          ]
        : []),
    ];

    let usedWidth =
      fixedChipWidths.reduce((sum, width) => sum + width, 0) +
      CHIP_GAP_PX * Math.max(fixedChipWidths.length - 1, 0);

    const nextVisibleTags: string[] = [];

    for (let index = 0; index < parsedTags.length; index += 1) {
      const tag = parsedTags[index];
      const remainingCount = parsedTags.length - index - 1;
      const tagWidth = estimateChipWidth(tag);
      const gapBeforeTag = CHIP_GAP_PX;
      const overflowWidth =
        remainingCount > 0
          ? CHIP_GAP_PX + estimateChipWidth(`+${remainingCount}`)
          : 0;

      if (usedWidth + gapBeforeTag + tagWidth + overflowWidth > containerWidth) {
        break;
      }

      nextVisibleTags.push(tag);
      usedWidth += gapBeforeTag + tagWidth;

      if (nextVisibleTags.length >= MAX_VISIBLE_TASK_TAGS) {
        break;
      }
    }

    return {
      tags: nextVisibleTags,
      hiddenCount: Math.max(parsedTags.length - nextVisibleTags.length, 0),
    };
  }, [activeBlockers.length, checklistSummary, containerWidth, parsedTags, status]);

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 items-center gap-1.5 overflow-hidden"
    >
      <Badge
        variant="outline"
        className={`h-5 flex-shrink-0 px-2 text-[10px] font-semibold tracking-[0.02em] ${statusTone.badgeClassName}`}
        title={status || "New"}
      >
        {status || "New"}
      </Badge>
      {activeBlockers.length > 0 && (
        <HoverCard openDelay={100} closeDelay={100}>
          <HoverCardTrigger>
            <Badge
              variant="outline"
              className="h-5 flex-shrink-0 cursor-pointer gap-1 border-red-200 bg-red-50 px-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
              onClick={onOpenBlockers}
              title={`${activeBlockers.length} active blocker${activeBlockers.length > 1 ? "s" : ""} - Click to manage`}
            >
              <ShieldAlert className="h-3 w-3" />
              <span className="font-semibold">{activeBlockers.length}</span>
            </Badge>
          </HoverCardTrigger>
          <HoverCardContent className="w-80" align="start" side="top" sideOffset={5}>
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-500" />
                Active Blockers ({activeBlockers.length})
              </h4>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {activeBlockers.map((blocker) => (
                  <div
                    key={blocker.id}
                    className="rounded-md border bg-background p-2 text-xs"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={`h-4 flex-shrink-0 px-1.5 text-[10px] ${
                          blocker.severity === "critical"
                            ? "border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
                            : blocker.severity === "high"
                            ? "border-orange-300 bg-orange-100 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-400"
                            : blocker.severity === "medium"
                            ? "border-yellow-300 bg-yellow-100 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400"
                            : "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400"
                        }`}
                      >
                        {blocker.severity}
                      </Badge>
                    </div>
                    <p className="text-foreground">{blocker.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
      {checklistSummary && checklistSummary.total > 0 && (
        <Badge
          variant="outline"
          className={`h-5 flex-shrink-0 cursor-pointer gap-1 px-2 text-[11px] ${
            checklistSummary.completed === checklistSummary.total
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
              : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
          }`}
          onClick={onOpenChecklist}
          title={`Checklist: ${checklistSummary.completed}/${checklistSummary.total} completed`}
        >
          <ListChecks className="h-3 w-3" />
          <span className="font-semibold">
            {checklistSummary.completed}/{checklistSummary.total}
          </span>
        </Badge>
      )}
      {visibleTags.tags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="h-5 max-w-[11rem] flex-shrink-0 border-border/70 bg-background/80 px-2 text-[11px] text-muted-foreground"
          title={tag}
        >
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {visibleTags.hiddenCount > 0 && (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="h-5 flex-shrink-0 border-dashed border-border/70 bg-background/60 px-2 text-[11px] text-muted-foreground"
              >
                +{visibleTags.hiddenCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {parsedTags.slice(visibleTags.tags.length).join(", ")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function SortableRow({ id, children, rowClassName, dragHandleBgClassName }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr ref={setNodeRef} style={style} className={rowClassName}>
      <td className={`py-1.5 px-3 ${dragHandleBgClassName}`} style={{ width: "40px" }}>
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
      </td>
      {children}
    </tr>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState<TaskWithTimeEntries[]>([]);
  const [dayOffs, setDayOffs] = useState<DayOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [defaultDayLength, setDefaultDayLength] = useState(8);
  
  // Initialize state from localStorage
  const [currentDate, setCurrentDate] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('projectManager.currentDate');
      if (stored) {
        try {
          return new Date(stored);
        } catch {
          return new Date();
        }
      }
    }
    return new Date();
  });
  
  const [viewMode, setViewMode] = useState<"week" | "month">(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('projectManager.viewMode');
      if (stored === 'week' || stored === 'month') {
        return stored;
      }
    }
    return 'week';
  });
  
  const [showAddTask, setShowAddTask] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showBlockers, setShowBlockers] = useState<{ taskId: number; taskTitle: string } | null>(null);
  const [showChecklist, setShowChecklist] = useState<{ taskId: number; taskTitle: string } | null>(null);
  const [showTimeEntries, setShowTimeEntries] = useState<{ taskId: number; taskTitle: string } | null>(null);
  const [pendingNoTimeStatusChange, setPendingNoTimeStatusChange] = useState<{
    taskId: number;
    taskTitle: string;
    newStatus: string;
    hasExternalSource: boolean;
  } | null>(null);
  const [timeEntriesByTask, setTimeEntriesByTask] = useState<Record<number, { date: string; hours: number }[]>>({});
  const [timeEntriesLoading, setTimeEntriesLoading] = useState(false);
  const [timeEntriesError, setTimeEntriesError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<{ id: number; title: string; type: "task" | "bug" } | null>(null);
  const [exportToDevOps, setExportToDevOps] = useState<{ id: number; title: string; type: "task" | "bug" } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    taskId: number;
    date: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  
  const [visibleStatuses, setVisibleStatuses] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('projectManager.visibleStatuses');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          return new Set(Array.isArray(parsed) ? parsed : ["New", "Active", "Resolved", "Closed"]);
        } catch {
          return new Set(["New", "Active", "Resolved", "Closed"]);
        }
      }
    }
    return new Set(["New", "Active", "Resolved", "Closed"]);
  });
  const monthParam = useMemo(
    () => format(currentDate, "yyyy-MM"),
    [currentDate]
  );

  const dateRange = useMemo(() => {
    if (viewMode === "week") {
      return {
        startDate: format(
          startOfWeek(currentDate, WEEK_STARTS_ON_MONDAY),
          "yyyy-MM-dd"
        ),
        endDate: format(
          endOfWeek(currentDate, WEEK_STARTS_ON_MONDAY),
          "yyyy-MM-dd"
        ),
      };
    }

    return {
      startDate: format(startOfMonth(currentDate), "yyyy-MM-dd"),
      endDate: format(endOfMonth(currentDate), "yyyy-MM-dd"),
    };
  }, [currentDate, viewMode]);

  const fetchTasks = useCallback(
    async (showLoader = false) => {
      try {
        if (showLoader) setLoading(true);
        const response = await fetch(`/api/tasks?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`);
        if (!response.ok) throw new Error("Failed to fetch tasks");
        const data = await response.json();
        setTasks(data);
      } catch (err) {
        toast.error("Failed to load tasks", {
          description: "Please check your database connection."
        });
        console.error(err);
      } finally {
        if (showLoader) setLoading(false);
        setInitialLoading(false);
      }
    },
    [dateRange]
  );

  const fetchDayOffs = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/day-offs?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`
      );
      if (!response.ok) throw new Error("Failed to fetch day-offs");
      const data = await response.json();
      setDayOffs(data);
    } catch (err) {
      console.error("Failed to load day-offs:", err);
    }
  }, [dateRange]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setTasks((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex);

        // Update display_order in database
        const taskOrders = newItems.map((item, index) => ({
          id: item.id,
          order: index,
        }));

        fetch("/api/tasks/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskOrders }),
        }).catch((err) => {
          console.error("Failed to update task order:", err);
          // Revert on error by fetching fresh data
          fetchTasks();
        });

        return newItems;
      });
    }
  }, [fetchTasks]);

  useEffect(() => {
    fetchTasks(true);
  }, [fetchTasks]);

  useEffect(() => {
    fetchDayOffs();
  }, [fetchDayOffs]);

  // Fetch default day length setting
  useEffect(() => {
    const fetchDefaultDayLength = async () => {
      try {
        const response = await fetch("/api/settings?key=default_day_length");
        if (response.ok) {
          const data = await response.json();
          if (data.value) {
            setDefaultDayLength(parseFloat(data.value));
          }
        }
      } catch (err) {
        console.error("Failed to load default day length:", err);
      }
    };
    fetchDefaultDayLength();
  }, []);

  // Persist currentDate to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('projectManager.currentDate', currentDate.toISOString());
    }
  }, [currentDate]);

  // Persist viewMode to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('projectManager.viewMode', viewMode);
    }
  }, [viewMode]);

  // Persist visibleStatuses to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('projectManager.visibleStatuses', JSON.stringify(Array.from(visibleStatuses)));
    }
  }, [visibleStatuses]);



  const dayOffMap = useMemo(
    () => new Map(dayOffs.map((dayOff) => [dayOff.date, dayOff] as const)),
    [dayOffs]
  );

  const calendarDays = useMemo(
    () => {
      const interval =
        viewMode === "week"
          ? {
              start: startOfWeek(currentDate, WEEK_STARTS_ON_MONDAY),
              end: endOfWeek(currentDate, WEEK_STARTS_ON_MONDAY),
            }
          : {
              start: startOfMonth(currentDate),
              end: endOfMonth(currentDate),
            };

      return eachDayOfInterval(interval).map((date) => {
        const key = format(date, "yyyy-MM-dd");
        const dayOff = dayOffMap.get(key);
        const hasDayOff = Boolean(dayOff);
        const isHalfDay = Boolean(dayOff?.is_half_day);
        return {
          date,
          key,
          dayOff,
          isDayOff: hasDayOff,
          isHalfDay,
          isWeekend: isSaturday(date) || isSunday(date),
          isToday: isToday(date),
        };
      });
    },
    [currentDate, viewMode, dayOffMap]
  );

  const filteredTasks = useMemo(
    () => tasks.filter(task => {
      const status = task.status || "New";
      
      // First check if status is visible
      if (!visibleStatuses.has(status)) {
        return false;
      }
      
      // For completed tasks (Resolved/Closed), only show if they have tracked time in current period
      const completedStatuses = ["Resolved", "Closed"];
      if (completedStatuses.includes(status)) {
        const periodDates = new Set(calendarDays.map(day => day.key));
        const hasTimeInPeriod = Object.entries(task.timeEntries).some(
          ([date, hours]) => periodDates.has(date) && hours > 0
        );
        return hasTimeInPeriod;
      }
      
      return true;
    }),
    [tasks, visibleStatuses, calendarDays]
  );

  const totalHoursByTask = useMemo(
    () =>
      filteredTasks.map((task) =>
        Object.values(task.timeEntries).reduce(
          (sum, hours) => sum + hours,
          0
        )
      ),
    [filteredTasks]
  );

  // Calculate totals including hidden tasks
  const allTotalHoursByDay = useMemo(
    () =>
      calendarDays.map((day) =>
        tasks.reduce(
          (sum, task) => sum + (task.timeEntries[day.key] || 0),
          0
        )
      ),
    [calendarDays, tasks]
  );

  const allGrandTotal = useMemo(
    () =>
      tasks.reduce(
        (sum, task) =>
          sum +
          Object.values(task.timeEntries).reduce(
            (taskSum, hours) => taskSum + hours,
            0
          ),
        0
      ),
    [tasks]
  );

  const trackedTimeEntries = useMemo<{ date: string; hours: number }[]>(
    () => {
      if (!showTimeEntries) return [];
      const task = tasks.find((t) => t.id === showTimeEntries.taskId);
      if (!task) return [];

      const cachedEntries = timeEntriesByTask[showTimeEntries.taskId];
      if (cachedEntries) {
        return cachedEntries;
      }

      return Object.entries(task.timeEntries)
        .filter(([, hours]) => hours > 0)
        .map(([date, hours]) => ({ date, hours }))
        .sort((a, b) => (a.date > b.date ? -1 : 1));
    },
    [showTimeEntries, tasks, timeEntriesByTask]
  );

  const trackedTimeTotal = useMemo(
    () => trackedTimeEntries.reduce((sum, entry) => sum + entry.hours, 0),
    [trackedTimeEntries]
  );

  const groupedTimeEntries = useMemo(
    () => {
      const groups = new Map<string, { label: string; total: number; entries: { date: string; hours: number }[] }>();
      trackedTimeEntries.forEach((entry) => {
        const parsed = parseISO(entry.date);
        const key = format(parsed, "yyyy-MM");
        if (!groups.has(key)) {
          groups.set(key, {
            label: format(parsed, "LLLL yyyy"),
            total: 0,
            entries: [],
          });
        }
        const bucket = groups.get(key)!;
        bucket.entries.push(entry);
        bucket.total += entry.hours;
      });
      return Array.from(groups.values());
    },
    [trackedTimeEntries]
  );

  useEffect(() => {
    if (!showTimeEntries) return;

    let cancelled = false;
    const loadEntries = async () => {
      setTimeEntriesLoading(true);
      setTimeEntriesError(null);
      try {
        const response = await fetch(`/api/time-entries?taskId=${showTimeEntries.taskId}`);
        if (!response.ok) throw new Error("Failed to fetch tracked time");
        const data = await response.json();
        if (!cancelled) {
          setTimeEntriesByTask((prev) => ({ ...prev, [showTimeEntries.taskId]: data }));
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setTimeEntriesError("Failed to load tracked time");
        }
      } finally {
        if (!cancelled) {
          setTimeEntriesLoading(false);
        }
      }
    };

    loadEntries();

    return () => {
      cancelled = true;
    };
  }, [showTimeEntries]);

  const estimatedMonthHours = useMemo(() => {
    if (viewMode !== "month") return null;

    return calendarDays.reduce((sum, day) => {
      if (day.isWeekend) {
        return sum;
      }

      if (day.isDayOff) {
        return sum + (day.isHalfDay ? defaultDayLength / 2 : 0);
      }

      return sum + defaultDayLength;
    }, 0);
  }, [viewMode, calendarDays, defaultDayLength]);

  // Calculate cumulative overwork time for each day (incrementing from start of month)
  const cumulativeOverwork = useMemo(
    () => {
      let cumulative = 0;
      return calendarDays.map((day, index) => {
        const actualHours = allTotalHoursByDay[index];
        // Only count expected hours for workdays (half-day entries count as half)
        const expectedHours = day.isWeekend
          ? 0
          : day.isDayOff
          ? (day.isHalfDay ? defaultDayLength / 2 : 0)
          : defaultDayLength;
        const dailyDifference = actualHours - expectedHours;
        cumulative += dailyDifference;
        return cumulative;
      });
    },
    [calendarDays, allTotalHoursByDay, defaultDayLength]
  );

  const toggleStatusVisibility = (status: string) => {
    setVisibleStatuses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(status)) {
        newSet.delete(status);
      } else {
        newSet.add(status);
      }
      return newSet;
    });
  };

  const handleCellClick = useCallback(
    (taskId: number, date: string, currentHours: number) => {
      setEditingCell({ taskId, date });
      setEditValue(currentHours > 0 ? currentHours.toString() : "");
    },
    []
  );

  const handleCellSave = useCallback(async () => {
    if (!editingCell) return;

    const hours = parseFloat(editValue) || 0;

    if (hours < 0) {
      toast.error("Hours cannot be negative");
      return;
    }

    try {
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: editingCell.taskId,
          date: editingCell.date,
          hours,
        }),
      });

      if (!response.ok) throw new Error("Failed to save time entry");

      await fetchTasks();
      setEditingCell(null);
      setEditValue("");
    } catch (err) {
      toast.error("Failed to save time entry");
      console.error(err);
    }
  }, [editValue, editingCell, fetchTasks]);

  const handleKeyPress = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleCellSave();
      } else if (e.key === "Escape") {
        setEditingCell(null);
        setEditValue("");
      }
    },
    [handleCellSave]
  );

  const changeDate = useCallback(
    (offset: number) => {
      if (viewMode === "week") {
        setCurrentDate((prev) => addWeeks(prev, offset));
      } else {
        setCurrentDate((prev) => addMonths(prev, offset));
      }
    },
    [viewMode]
  );

  const weekStart = useMemo(
    () => startOfWeek(currentDate, WEEK_STARTS_ON_MONDAY),
    [currentDate]
  );
  const weekEnd = useMemo(
    () => endOfWeek(currentDate, WEEK_STARTS_ON_MONDAY),
    [currentDate]
  );

  const formatTimeDisplay = useCallback((hours: number): string => {
    if (hours === 0) return "";
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${m.toString().padStart(2, "0")}`;
  }, []);

  const handleTaskClick = async (task: TaskWithTimeEntries) => {
    if (task.external_source === "azure_devops" && task.external_id) {
      try {
        const response = await fetch(`/api/settings?key=azure_devops`);
        if (response.ok) {
          const setting = await response.json();

          if (setting && setting.value) {
            const azureSettings =
              typeof setting.value === "string"
                ? JSON.parse(setting.value)
                : setting.value;

            if (azureSettings.organization && azureSettings.project) {
              const url = `https://dev.azure.com/${azureSettings.organization}/${azureSettings.project}/_workitems/edit/${task.external_id}`;
              window.open(url, "_blank");
            } else {
              console.error(
                "Azure DevOps organization or project not configured"
              );
            }
          }
        }
      } catch (err) {
        console.error("Failed to open Azure DevOps link", err);
      }
    }
  };

  const handleDeleteTask = async (taskId: number, taskTitle: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the task "${taskTitle}"? This will also delete all associated time entries.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks?id=${taskId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete task");

      await fetchTasks();
      toast.success("Task deleted successfully");
    } catch (err) {
      toast.error("Failed to delete task");
      console.error(err);
    }
  };

  const handleStatusChange = async (
    taskId: number,
    newStatus: string,
    hasExternalSource: boolean,
    options?: { skipNoTimeConfirmation?: boolean }
  ) => {
    const task = tasks.find((item) => item.id === taskId);
    const isCompletedStatus = COMPLETED_STATUSES.has(newStatus.toLowerCase());
    const wasCompletedStatus = task?.status
      ? COMPLETED_STATUSES.has(task.status.toLowerCase())
      : false;
    const totalHoursTracked =
      task?.totalHoursTracked ??
      Object.values(task?.timeEntries ?? {}).reduce((sum, hours) => sum + hours, 0);

    if (
      !options?.skipNoTimeConfirmation &&
      task &&
      isCompletedStatus &&
      !wasCompletedStatus &&
      totalHoursTracked <= 0
    ) {
      setPendingNoTimeStatusChange({
        taskId,
        taskTitle: task.title,
        newStatus,
        hasExternalSource,
      });
      return;
    }

    try {
      // Use Azure DevOps sync endpoint if task is linked to Azure DevOps
      const endpoint = hasExternalSource 
        ? "/api/azure-devops/update-status"
        : "/api/tasks";
      
      const response = await fetch(endpoint, {
        method: hasExternalSource ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          taskId: taskId,
          id: taskId,
          status: newStatus 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to update status");
      }

      const result = await response.json();
      
      // Show feedback message
      if (result.synced) {
        toast.success("Status updated and synced with Azure DevOps");
      } else if (result.localOnly) {
        toast.info(result.message || "Status updated locally");
      } else {
        toast.success("Status updated successfully");
      }

      await fetchTasks();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update status";
      toast.error(message);
      console.error(err);
    }
  };

  const confirmNoTimeStatusChange = () => {
    if (!pendingNoTimeStatusChange) return;

    const pendingStatusChange = pendingNoTimeStatusChange;
    setPendingNoTimeStatusChange(null);
    handleStatusChange(
      pendingStatusChange.taskId,
      pendingStatusChange.newStatus,
      pendingStatusChange.hasExternalSource,
      { skipNoTimeConfirmation: true }
    );
  };

  const handleCopyExternalId = useCallback(async (externalId: string) => {
    const formattedExternalId = `#${parseInt(externalId, 10)}`;

    try {
      await navigator.clipboard.writeText(formattedExternalId);
      toast.success(`Copied work item ${formattedExternalId}`);
    } catch (err) {
      console.error("Failed to copy work item ID:", err);
      toast.error("Failed to copy work item ID");
    }
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    
    try {
      // First, refresh Azure DevOps tasks
      const refreshResponse = await fetch("/api/azure-devops/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        }),
      });

      if (refreshResponse.ok) {
        const result = await refreshResponse.json();
        console.log("Azure DevOps refresh result:", result);
        
        if (result.updated > 0) {
          toast.success(`Successfully updated ${result.updated} task(s) from Azure DevOps`);
        } else if (result.skipped > 0) {
          toast.info(`All ${result.skipped} imported task(s) are up to date`);
        }
      } else if (refreshResponse.status === 400) {
        // Settings not configured, silently skip
        console.log("Azure DevOps settings not configured, skipping refresh");
      } else {
        const errorData = await refreshResponse.json();
        toast.error(errorData.error || "Failed to refresh Azure DevOps tasks");
      }
    } catch (err) {
      console.error("Error refreshing Azure DevOps tasks:", err);
      toast.error("An error occurred while refreshing tasks");
    } finally {
      // Always fetch latest tasks from database
      await fetchTasks();
      setIsRefreshing(false);
    }
  };

  const handleExportToExcel = async () => {
    try {
      const response = await fetch(`/api/export?month=${monthParam}`);
      
      if (!response.ok) {
        throw new Error('Failed to export');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Extract filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `work-items-${monthParam}.xlsx`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success('Work items exported successfully');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export work items');
    }
  };

  if (initialLoading) {
    return (
      <div className="h-full overflow-auto p-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 shrink-0">
        <div className="flex gap-3 items-center justify-between flex-wrap">
          <div className="flex gap-3 items-center">
            <div className="flex bg-muted rounded-md p-1">
              <Button
                variant={viewMode === "week" ? "default" : "ghost"}
                size="sm"
                className={`h-8 px-4 ${
                  viewMode === "week"
                    ? "bg-orange-500 text-white hover:bg-orange-600"
                    : ""
                }`}
                onClick={() => setViewMode("week")}
              >
                Week
              </Button>
              <Button
                variant={viewMode === "month" ? "default" : "ghost"}
                size="sm"
                className="h-8 px-4"
                onClick={() => setViewMode("month")}
              >
                Month
              </Button>
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <Button
              onClick={() => changeDate(-1)}
              variant="outline"
              size="icon"
              className="h-10 w-10"
            >
              ←
            </Button>
            <h1 className="text-2xl font-semibold">
              {viewMode === "week"
                ? `This week: ${format(weekStart, "dd")} – ${format(
                    weekEnd,
                    "dd MMM yyyy"
                  )}`
                : format(currentDate, "MMMM yyyy")}
            </h1>
            <Button
              onClick={() => changeDate(1)}
              variant="outline"
              size="icon"
              className="h-10 w-10"
            >
              →
            </Button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10">
                  <Filter className="w-4 h-4 mr-2" />
                  Filter Status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Show Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {["New", "Active", "Resolved", "Closed"].map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={visibleStatuses.has(status)}
                    onCheckedChange={() => toggleStatusVisibility(status)}
                  >
                    {status}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={() => setShowAddTask(true)} variant="outline" size="sm" className="h-10">
              + Add row
            </Button>
            <Button onClick={() => setShowImport(true)} variant="outline" size="sm" className="h-10">
              Import from Azure DevOps
            </Button>
            <Button 
              onClick={handleRefresh} 
              variant="outline"
              size="sm"
              className="h-10"
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button 
              onClick={handleExportToExcel} 
              variant="outline"
              size="sm"
              className="h-10"
            >
              Export to Excel
            </Button>
            {estimatedMonthHours !== null && (
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                <span>Est. month hours:</span>
                <span className="font-semibold text-foreground">
                  {estimatedMonthHours > 0
                    ? formatTimeDisplay(estimatedMonthHours)
                    : "0:00"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border sticky top-0 z-20">
                <th className="p-3 sticky left-0 bg-muted dark:bg-muted z-[21]" style={{ width: "40px" }}>
                  {/* Drag handle column */}
                </th>
                <th className="p-3 text-left font-normal text-muted-foreground text-sm sticky left-[40px] bg-muted dark:bg-muted z-[21] overflow-hidden" style={{ minWidth: "180px", maxWidth: "28vw" }}>
                  {/* Empty for task names */}
                </th>
                {calendarDays.map((day) => {
                  const headerClass = day.isToday
                    ? "bg-orange-100 dark:bg-orange-950/50"
                    : day.isDayOff
                    ? "bg-purple-100 dark:bg-purple-950/50"
                    : day.isWeekend
                    ? "bg-slate-100 dark:bg-slate-900/70"
                    : "bg-muted";

                  const dayOffLabel = day.isHalfDay ? "Half day" : "Day off";
                  const description = day.dayOff?.description;
                  const title = day.isDayOff
                    ? `${dayOffLabel}${description ? ` • ${description}` : ""}`
                    : "";

                  const textClass = day.isToday
                    ? "text-orange-600 dark:text-orange-400"
                    : day.isDayOff
                    ? "text-purple-700 dark:text-purple-400"
                    : day.isWeekend
                    ? "text-slate-700 dark:text-slate-100"
                    : "text-foreground";

                  const subTextClass = day.isToday
                    ? "text-orange-600 dark:text-orange-400"
                    : day.isDayOff
                    ? "text-purple-600 dark:text-purple-400"
                    : day.isWeekend
                    ? "text-slate-600 dark:text-slate-300"
                    : "text-muted-foreground";

                  return (
                    <th
                      key={day.key}
                      className={`p-3 text-center font-normal text-sm ${headerClass}`}
                      style={{ minWidth: "84px", width: "84px" }}
                      title={title}
                    >
                      <div className={`font-medium ${textClass}`}>
                        {format(day.date, "EEE")}
                      </div>
                      <div className={`text-xs ${subTextClass}`}>
                        {format(day.date, "dd MMM")}
                        {day.isDayOff && (
                          <div className="text-[10px] font-medium flex items-center justify-center gap-1">
                            <TreePalm className="w-3 h-3" />
                            <span>{day.isHalfDay ? "Half Day" : "Day Off"}</span>
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th
                  className="p-3 text-center font-normal text-muted-foreground text-sm bg-muted dark:bg-muted sticky right-0 z-[21]"
                  style={{ minWidth: "84px", width: "84px" }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {filteredTasks.map((task, taskIndex) => {
                // Check for blockers and get highest severity
                const activeBlockers = task.blockers?.filter(b => !b.is_resolved) || [];
                const hasBlockers = activeBlockers.length > 0;
                const highestSeverity = hasBlockers 
                  ? activeBlockers.reduce((max, b) => {
                      const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
                      const maxOrder = severityOrder[max as keyof typeof severityOrder] || 0;
                      const bOrder = severityOrder[b.severity as keyof typeof severityOrder] || 0;
                      return bOrder > maxOrder ? b.severity : max;
                    }, 'low')
                  : null;

                // Determine row background color based on blockers and status
                const getRowClass = () => {
                  if (hasBlockers) {
                    switch (highestSeverity) {
                      case 'critical':
                        return "group border-b border-border bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900";
                      case 'high':
                        return "group border-b border-border bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900";
                      case 'medium':
                        return "group border-b border-border bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-950 dark:hover:bg-yellow-900";
                      case 'low':
                        return "group border-b border-border bg-blue-100 hover:bg-blue-200 dark:bg-blue-950 dark:hover:bg-blue-900";
                    }
                  }
                  const status = task.status?.toLowerCase();
                  if (status === 'active') {
                    return "group border-b border-border bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900";
                  } else if (status === 'resolved' || status === 'closed') {
                    return "group border-b border-border bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900";
                  }
                  return "group border-b border-border hover:bg-muted dark:hover:bg-muted";
                };

                // Get sticky column background color based on blockers and status
                const getStickyBgClass = () => {
                  if (hasBlockers) {
                    switch (highestSeverity) {
                      case 'critical':
                        return "py-1.5 px-3 sticky left-[40px] bg-red-100 group-hover:bg-red-200 dark:bg-red-950 dark:group-hover:bg-red-900 z-10";
                      case 'high':
                        return "py-1.5 px-3 sticky left-[40px] bg-orange-100 group-hover:bg-orange-200 dark:bg-orange-950 dark:group-hover:bg-orange-900 z-10";
                      case 'medium':
                        return "py-1.5 px-3 sticky left-[40px] bg-yellow-100 group-hover:bg-yellow-200 dark:bg-yellow-950 dark:group-hover:bg-yellow-900 z-10";
                      case 'low':
                        return "py-1.5 px-3 sticky left-[40px] bg-blue-100 group-hover:bg-blue-200 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                    }
                  }
                  const status = task.status?.toLowerCase();
                  if (status === 'active') {
                    return "py-1.5 px-3 sticky left-[40px] bg-blue-50 group-hover:bg-blue-100 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                  } else if (status === 'resolved' || status === 'closed') {
                    return "py-1.5 px-3 sticky left-[40px] bg-green-50 group-hover:bg-green-100 dark:bg-green-950 dark:group-hover:bg-green-900 z-10";
                  }
                  return "py-1.5 px-3 sticky left-[40px] bg-background dark:bg-card group-hover:bg-muted dark:group-hover:bg-muted z-10";
                };

                // Get drag handle background color
                const getDragHandleBgClass = () => {
                  if (hasBlockers) {
                    switch (highestSeverity) {
                      case 'critical':
                        return "sticky left-0 bg-red-100 group-hover:bg-red-200 dark:bg-red-950 dark:group-hover:bg-red-900 z-10";
                      case 'high':
                        return "sticky left-0 bg-orange-100 group-hover:bg-orange-200 dark:bg-orange-950 dark:group-hover:bg-orange-900 z-10";
                      case 'medium':
                        return "sticky left-0 bg-yellow-100 group-hover:bg-yellow-200 dark:bg-yellow-950 dark:group-hover:bg-yellow-900 z-10";
                      case 'low':
                        return "sticky left-0 bg-blue-100 group-hover:bg-blue-200 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                    }
                  }
                  const status = task.status?.toLowerCase();
                  if (status === 'active') {
                    return "sticky left-0 bg-blue-50 group-hover:bg-blue-100 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                  } else if (status === 'resolved' || status === 'closed') {
                    return "sticky left-0 bg-green-50 group-hover:bg-green-100 dark:bg-green-950 dark:group-hover:bg-green-900 z-10";
                  }
                  return "sticky left-0 bg-background dark:bg-card group-hover:bg-muted dark:group-hover:bg-muted z-10";
                };

                return (
                  <SortableRow
                    key={task.id}
                    id={task.id}
                    rowClassName={getRowClass()}
                    dragHandleBgClassName={getDragHandleBgClass()}
                  >
                    <td
                      className={getStickyBgClass()}
                      style={{ minWidth: "180px", maxWidth: "28vw" }}
                    >
                    {(() => {
                      return (
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex min-w-0 flex-1 gap-2">
                            <span
                              className="mt-0.5 flex-shrink-0"
                              title={task.type === "bug" ? "Bug" : "Task"}
                            >
                              {task.type === "bug" ? (
                                <Bug className="h-4 w-4 text-red-600 dark:text-red-500" />
                              ) : (
                                <ClipboardCheck className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                              )}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-foreground">
                                    {task.external_source === "azure_devops" && task.external_id && (
                                      <button
                                        type="button"
                                        onClick={() => handleCopyExternalId(task.external_id!)}
                                        className="flex-shrink-0 font-mono text-xs font-semibold tracking-[0.01em] text-muted-foreground transition-colors hover:text-foreground"
                                        title={`Azure DevOps Work Item ${parseInt(task.external_id, 10)}`}
                                      >
                                        #{parseInt(task.external_id, 10)}
                                      </button>
                                    )}
                                    <div className="min-w-0 truncate" title={task.title}>
                                      {task.external_source === "azure_devops" && task.external_id ? (
                                        <button
                                          onClick={() => handleTaskClick(task)}
                                          className="block w-full truncate text-left text-blue-600 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                                          title={`${task.title} - Open in Azure DevOps`}
                                        >
                                          {task.title}
                                        </button>
                                      ) : (
                                        task.title
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <TaskMetaRow
                                status={task.status}
                                tags={task.tags}
                                activeBlockers={activeBlockers}
                                checklistSummary={task.checklistSummary}
                                onOpenBlockers={() =>
                                  setShowBlockers({ taskId: task.id, taskTitle: task.title })
                                }
                                onOpenChecklist={() =>
                                  setShowChecklist({ taskId: task.id, taskTitle: task.title })
                                }
                              />
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 flex-shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100"
                                title="Actions"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <span>Change Status</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleStatusChange(
                                        task.id,
                                        "New",
                                        task.external_source === "azure_devops"
                                      )
                                    }
                                  >
                                    New
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleStatusChange(
                                        task.id,
                                        "Active",
                                        task.external_source === "azure_devops"
                                      )
                                    }
                                  >
                                    Active
                                  </DropdownMenuItem>
                                  {task.type !== "task" && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleStatusChange(
                                          task.id,
                                          "Resolved",
                                          task.external_source === "azure_devops"
                                        )
                                      }
                                    >
                                      Resolved
                                    </DropdownMenuItem>
                                  )}
                                  {task.type !== "bug" && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleStatusChange(
                                          task.id,
                                          "Closed",
                                          task.external_source === "azure_devops"
                                        )
                                      }
                                    >
                                      Closed
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              {task.external_source !== "azure_devops" && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setEditingTask({
                                      id: task.id,
                                      title: task.title,
                                      type: task.type,
                                    })
                                  }
                                >
                                  <span className="flex items-center gap-2">
                                    <Pencil className="h-4 w-4" />
                                    <span>Edit Task</span>
                                  </span>
                                </DropdownMenuItem>
                              )}
                              {task.external_source !== "azure_devops" && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setExportToDevOps({
                                      id: task.id,
                                      title: task.title,
                                      type: task.type,
                                    })
                                  }
                                >
                                  <span className="flex items-center gap-2">
                                    <Upload className="h-4 w-4" />
                                    <span>Export to DevOps</span>
                                  </span>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() =>
                                  setShowTimeEntries({ taskId: task.id, taskTitle: task.title })
                                }
                              >
                                <span className="flex items-center gap-2">
                                  <Clock3 className="h-4 w-4" />
                                  <span>View Tracked Time</span>
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setShowBlockers({ taskId: task.id, taskTitle: task.title })
                                }
                              >
                                <span className="flex items-center gap-2">
                                  <ShieldAlert className="h-4 w-4" />
                                  <span>Manage Blockers</span>
                                  {hasBlockers && (
                                    <Badge variant="outline" className="ml-auto h-5 px-1.5 text-xs">
                                      {activeBlockers.length}
                                    </Badge>
                                  )}
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setShowChecklist({ taskId: task.id, taskTitle: task.title })
                                }
                              >
                                <span className="flex items-center gap-2">
                                  <ListChecks className="h-4 w-4" />
                                  <span>Checklist</span>
                                  {task.checklistSummary && task.checklistSummary.total > 0 && (
                                    <Badge variant="outline" className="ml-auto h-5 px-1.5 text-xs">
                                      {task.checklistSummary.completed}/{task.checklistSummary.total}
                                    </Badge>
                                  )}
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteTask(task.id, task.title)}
                                className="text-red-600 focus:bg-red-50 focus:text-red-600"
                              >
                                <span className="flex items-center gap-2">
                                  <Trash2 className="h-4 w-4" />
                                  <span>Delete Task</span>
                                </span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })()}
                  </td>
                  {calendarDays.map((day) => {
                    const hours = task.timeEntries[day.key] || 0;
                    const isEditing =
                      editingCell?.taskId === task.id &&
                      editingCell?.date === day.key;

                    // Get base color based on blockers first, then task status
                    const getBaseCellColor = () => {
                      if (hasBlockers) {
                        switch (highestSeverity) {
                          case 'critical':
                            return { bg: 'bg-red-100 dark:bg-red-950', hover: 'group-hover:bg-red-200 dark:group-hover:bg-red-900' };
                          case 'high':
                            return { bg: 'bg-orange-100 dark:bg-orange-950', hover: 'group-hover:bg-orange-200 dark:group-hover:bg-orange-900' };
                          case 'medium':
                            return { bg: 'bg-yellow-100 dark:bg-yellow-950', hover: 'group-hover:bg-yellow-200 dark:group-hover:bg-yellow-900' };
                          case 'low':
                            return { bg: 'bg-blue-100 dark:bg-blue-950', hover: 'group-hover:bg-blue-200 dark:group-hover:bg-blue-900' };
                        }
                      }
                      const status = task.status?.toLowerCase();
                      if (status === 'active') {
                        return { bg: 'bg-blue-50 dark:bg-blue-950', hover: 'group-hover:bg-blue-100 dark:group-hover:bg-blue-900' };
                      } else if (status === 'resolved' || status === 'closed') {
                        return { bg: 'bg-green-50 dark:bg-green-950', hover: 'group-hover:bg-green-100 dark:group-hover:bg-green-900' };
                      }
                      return { bg: 'bg-background dark:bg-card', hover: 'group-hover:bg-muted dark:group-hover:bg-muted' };
                    };

                    const baseColor = getBaseCellColor();

                    // Special day types override the base color
                    const cellClass = day.isToday
                      ? "bg-orange-50 group-hover:bg-orange-200 dark:bg-orange-950/40 dark:group-hover:bg-orange-950/60"
                      : day.isDayOff
                      ? "bg-purple-50 group-hover:bg-purple-200 dark:bg-purple-950/40 dark:group-hover:bg-purple-950/60"
                      : day.isWeekend
                      ? "bg-slate-50 group-hover:bg-slate-100 dark:bg-slate-900/60 dark:group-hover:bg-slate-900/40"
                      : `${baseColor.bg} ${baseColor.hover}`;

                    return (
                      <td
                        key={day.key}
                        className={`py-1.5 px-3 text-center cursor-pointer ${cellClass}`}
                        onClick={() =>
                          !isEditing && handleCellClick(task.id, day.key, hours)
                        }
                        style={{ minWidth: "84px", width: "84px" }}
                      >
                        {isEditing ? (
                          <Input
                            type="number"
                            min="0"
                            step="0.25"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleKeyPress}
                            autoFocus
                            className="w-20 text-center h-9 border-2 border-blue-500 dark:border-blue-400"
                          />
                        ) : hours > 0 ? (
                          <span className="text-sm font-medium text-foreground">
                            {formatTimeDisplay(hours)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className={`py-1.5 px-3 text-center font-semibold text-sm text-foreground sticky right-0 z-10 ${
                      hasBlockers 
                        ? highestSeverity === 'critical' ? 'bg-red-100 group-hover:bg-red-200 dark:bg-red-950 dark:group-hover:bg-red-900' :
                          highestSeverity === 'high' ? 'bg-orange-100 group-hover:bg-orange-200 dark:bg-orange-950 dark:group-hover:bg-orange-900' :
                          highestSeverity === 'medium' ? 'bg-yellow-100 group-hover:bg-yellow-200 dark:bg-yellow-950 dark:group-hover:bg-yellow-900' :
                          'bg-blue-100 group-hover:bg-blue-200 dark:bg-blue-950 dark:group-hover:bg-blue-900'
                        : task.status?.toLowerCase() === 'active' ? 'bg-blue-50 group-hover:bg-blue-100 dark:bg-blue-950 dark:group-hover:bg-blue-900' :
                          task.status?.toLowerCase() === 'resolved' || task.status?.toLowerCase() === 'closed' ? 'bg-green-50 group-hover:bg-green-100 dark:bg-green-950 dark:group-hover:bg-green-900' :
                          'bg-background dark:bg-card group-hover:bg-muted dark:group-hover:bg-muted'
                    }`}
                    style={{ minWidth: "84px", width: "84px" }}
                  >
                    {formatTimeDisplay(totalHoursByTask[taskIndex])}
                  </td>
                  </SortableRow>
                );
                  })}
                </tbody>
              </SortableContext>
            </DndContext>
            <tfoot>
              <tr className="bg-muted border-t-2 border-border sticky bottom-0 z-10">
                <td className="p-3 sticky left-0 bg-muted dark:bg-muted z-[11]" style={{ width: "40px" }}>
                  {/* Empty drag handle cell */}
                </td>
                <td className="p-3 sticky left-[40px] bg-muted dark:bg-muted z-[11] overflow-hidden" style={{ minWidth: "180px", maxWidth: "28vw" }}>
                  {/* Empty cell */}
                </td>
                {calendarDays.map((day, index) => {
                  const allTotal = allTotalHoursByDay[index];
                  const overwork = cumulativeOverwork[index];
                  const isFuture = day.date > new Date();
                  const showOverwork = !day.isWeekend && (!day.isDayOff || day.isHalfDay) && !isFuture && overwork !== 0;
                  
                  const cellClass = day.isToday
                    ? "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-400"
                    : day.isDayOff
                    ? "bg-purple-100 text-purple-900 dark:bg-purple-950/50 dark:text-purple-400"
                    : day.isWeekend
                    ? "bg-slate-100 text-slate-800 dark:bg-slate-900/70 dark:text-slate-100"
                    : "bg-muted text-foreground";

                  return (
                    <td
                      key={day.key}
                      className={`p-3 text-center font-semibold text-sm ${cellClass}`}
                      style={{ minWidth: "84px", width: "84px" }}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{allTotal > 0 ? formatTimeDisplay(allTotal) : "0"}</span>
                        {showOverwork && (
                          <span className={`text-xs font-semibold ${
                            overwork > 0 
                              ? 'text-green-600 dark:text-green-400' 
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            {overwork > 0 ? '+' : ''}{formatTimeDisplay(Math.abs(overwork))}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
                <td
                  className="p-3 text-center font-bold text-sm text-foreground bg-muted dark:bg-muted sticky right-0 z-[11]"
                  style={{ minWidth: "84px", width: "84px" }}
                >
                  <div className="flex flex-col items-center">
                    <span>{formatTimeDisplay(allGrandTotal)}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <Dialog
        open={Boolean(showTimeEntries)}
        onOpenChange={(open) => {
          if (!open) setShowTimeEntries(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tracked Time</DialogTitle>
            <DialogDescription>
              {showTimeEntries
                ? `Work item: ${showTimeEntries.taskTitle}`
                : "Review tracked time entries for this work item."}
            </DialogDescription>
          </DialogHeader>

          <div className="border rounded-md overflow-hidden">
            <div className="grid grid-cols-2 text-xs uppercase tracking-wide text-muted-foreground bg-muted/60 px-3 py-2">
              <span>Date</span>
              <span className="text-right">Tracked</span>
            </div>
            <div className="max-h-80 overflow-auto divide-y">
              {timeEntriesLoading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading tracked time…</div>
              ) : timeEntriesError ? (
                <div className="px-3 py-4 text-sm text-red-600 dark:text-red-400">
                  {timeEntriesError}
                </div>
              ) : trackedTimeEntries.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  No tracked time yet.
                </div>
              ) : (
                groupedTimeEntries.map((group) => (
                  <div key={group.label} className="border-b last:border-b-0">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/50 text-xs font-semibold uppercase tracking-wide">
                      <span>{group.label}</span>
                      <span>{formatTimeDisplay(group.total)}</span>
                    </div>
                    {group.entries.map((entry) => (
                      <div
                        key={`${group.label}-${entry.date}`}
                        className="grid grid-cols-2 items-center px-3 py-2 hover:bg-muted/50"
                      >
                        <span className="text-sm">
                          {format(parseISO(entry.date), "EEE, dd MMM yyyy")}
                        </span>
                        <span className="text-sm font-medium text-right">
                          {formatTimeDisplay(entry.hours)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-muted/60 text-sm font-semibold">
              <span>Total</span>
              <span>{trackedTimeTotal > 0 ? formatTimeDisplay(trackedTimeTotal) : "0:00"}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingNoTimeStatusChange)}
        onOpenChange={(open) => {
          if (!open) setPendingNoTimeStatusChange(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>No tracked time recorded</DialogTitle>
            <DialogDescription>
              This work item has no tracked time. Confirm that you still want to
              change its status.
            </DialogDescription>
          </DialogHeader>

          {pendingNoTimeStatusChange && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium text-foreground">
                {pendingNoTimeStatusChange.taskTitle}
              </div>
              <div className="mt-1 text-muted-foreground">
                New status: {pendingNoTimeStatusChange.newStatus}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingNoTimeStatusChange(null)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={confirmNoTimeStatusChange}>
              Change status anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAddTask && (
        <WorkItemModal
          onClose={() => setShowAddTask(false)}
          onSuccess={() => {
            setShowAddTask(false);
            fetchTasks();
          }}
        />
      )}


      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            fetchTasks();
          }}
        />
      )}

      {showBlockers && (
        <BlockersModal
          taskId={showBlockers.taskId}
          taskTitle={showBlockers.taskTitle}
          onClose={() => setShowBlockers(null)}
          onSuccess={() => {
            fetchTasks();
          }}
        />
      )}

      {showChecklist && (
        <ChecklistModal
          taskId={showChecklist.taskId}
          taskTitle={showChecklist.taskTitle}
          onClose={() => setShowChecklist(null)}
          onSuccess={() => {
            fetchTasks();
          }}
        />
      )}

      {editingTask && (
        <WorkItemModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSuccess={() => {
            setEditingTask(null);
            fetchTasks();
          }}
        />
      )}

      {exportToDevOps && (
        <ExportToDevOpsModal
          task={exportToDevOps}
          onClose={() => setExportToDevOps(null)}
          onSuccess={() => {
            setExportToDevOps(null);
            fetchTasks();
          }}
        />
      )}
    </div>
  );
}
