"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import type { Release, ReleaseWorkItem } from "@/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import ReleaseImportModal from "@/features/release-planner/components/ReleaseImportModal";
import { BlockersModal } from "@/features/blockers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Bug, GripVertical, ListTodo, MoreVertical, ShieldAlert } from "lucide-react";

type ChildDiscipline = "backend" | "frontend" | "design";

const CHILD_TASK_OPTIONS: Array<{
  value: ChildDiscipline;
  label: string;
  prefix: string;
}> = [
  { value: "backend", label: "Backend", prefix: "BE:" },
  { value: "frontend", label: "Frontend", prefix: "FE:" },
  { value: "design", label: "Design", prefix: "Design:" },
];

const ACTIVE_RELEASE_STORAGE_KEY = "projectManager.releasePlanner.activeReleaseId";

interface AppUser {
  id: number;
  name: string;
  email?: string | null;
}

interface AppProject {
  id: number;
  member_user_ids?: number[];
}

interface ExistingChildTask {
  id: number;
  title: string;
  type: string;
  status?: string | null;
  assignedTo?: string;
}

interface ChildCounts {
  tasks: number;
  bugs: number;
  completedTasks: number;
}

type ChildItemFilter = "task" | "bug";

interface SortableRowProps {
  id: number;
  children: React.ReactNode;
  rowClassName: string;
  dragHandleBgClassName: string;
}

function SortableRow({
  id,
  children,
  rowClassName,
  dragHandleBgClassName,
}: SortableRowProps) {
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

export default function ReleaseTrackingPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [workItems, setWorkItems] = useState<ReleaseWorkItem[]>([]);
  const [workItemsLoading, setWorkItemsLoading] = useState(false);
  const [activeReleaseId, setActiveReleaseId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(ACTIVE_RELEASE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isNaN(parsed) ? null : parsed;
  });
  const [azureDevOpsOrganization, setAzureDevOpsOrganization] = useState("");
  const [azureDevOpsProject, setAzureDevOpsProject] = useState("");
  const [moveWorkItemDialogOpen, setMoveWorkItemDialogOpen] = useState(false);
  const [selectedWorkItemToMove, setSelectedWorkItemToMove] = useState<ReleaseWorkItem | null>(null);
  const [selectedTargetReleaseId, setSelectedTargetReleaseId] = useState<string>("");
  const [showNotesDialog, setShowNotesDialog] = useState<{
    workItemId: number;
    workItemTitle: string;
  } | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSavingWorkItemId, setNotesSavingWorkItemId] = useState<number | null>(null);
  const [showCreateChild, setShowCreateChild] = useState<{
    workItemId: number;
    workItemTitle: string;
    workItemExternalId?: number | null;
  } | null>(null);
  const [childDisciplines, setChildDisciplines] = useState<Set<ChildDiscipline>>(
    () => new Set()
  );
  const [projectUsers, setProjectUsers] = useState<AppUser[]>([]);
  const [childUserByDiscipline, setChildUserByDiscipline] = useState<
    Record<ChildDiscipline, string>
  >({
    backend: "",
    frontend: "",
    design: "",
  });
  const [existingChildTasks, setExistingChildTasks] = useState<ExistingChildTask[]>([]);
  const [loadingExistingChildTasks, setLoadingExistingChildTasks] = useState(false);
  const [existingChildTasksError, setExistingChildTasksError] = useState<string | null>(null);
  const [childCountsByTitle, setChildCountsByTitle] = useState<
    Record<string, ChildCounts>
  >({});
  const [loadingChildCounts, setLoadingChildCounts] = useState(false);
  const [showChildItemsDialog, setShowChildItemsDialog] = useState<{
    parentId: number;
    title: string;
    filter: ChildItemFilter;
  } | null>(null);
  const [releaseStatusUpdatingItemId, setReleaseStatusUpdatingItemId] = useState<
    number | null
  >(null);
  const [childItemsDialogItems, setChildItemsDialogItems] = useState<ExistingChildTask[]>([]);
  const [loadingChildItemsDialog, setLoadingChildItemsDialog] = useState(false);
  const [childItemsDialogError, setChildItemsDialogError] = useState<string | null>(null);
  const [childStatusUpdatingId, setChildStatusUpdatingId] = useState<number | null>(
    null
  );
  const [childSubmitting, setChildSubmitting] = useState(false);
  const [blockerTaskLoadingItemId, setBlockerTaskLoadingItemId] = useState<number | null>(null);
  const [showBlockers, setShowBlockers] = useState<{
    taskId: number;
    taskTitle: string;
  } | null>(null);

  const filteredChildItemsDialog = useMemo(() => {
    if (!showChildItemsDialog) return [];
    return childItemsDialogItems.filter((childItem) =>
      showChildItemsDialog.filter === "task"
        ? childItem.type.toLowerCase() === "task"
        : childItem.type.toLowerCase() === "bug"
    );
  }, [childItemsDialogItems, showChildItemsDialog]);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const sortedReleases = useMemo(() => {
    return [...releases].sort(
      (a, b) =>
        (a.display_order ?? Number.MAX_SAFE_INTEGER) -
          (b.display_order ?? Number.MAX_SAFE_INTEGER) ||
        a.start_date.localeCompare(b.start_date)
    );
  }, [releases]);

  const activeReleaseIndex = useMemo(() => {
    if (sortedReleases.length === 0) return -1;
    if (activeReleaseId === null) return sortedReleases.length - 1;
    const index = sortedReleases.findIndex(
      (release) => release.id === activeReleaseId
    );
    return index === -1 ? sortedReleases.length - 1 : index;
  }, [sortedReleases, activeReleaseId]);

  const activeRelease = useMemo(() => {
    if (activeReleaseIndex < 0) return null;
    return sortedReleases[activeReleaseIndex] ?? null;
  }, [sortedReleases, activeReleaseIndex]);

  const moveTargetReleases = useMemo(() => {
    return sortedReleases.filter(
      (release) => release.id !== activeReleaseId && release.status !== "completed"
    );
  }, [sortedReleases, activeReleaseId]);

  const loadReleases = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/releases");
      if (!response.ok) throw new Error("Failed to fetch releases");
      const data = (await response.json()) as Release[];
      setReleases(data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load releases");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReleases();
  }, []);

  const loadAzureDevOpsSettings = async () => {
    try {
      const response = await fetch("/api/settings?key=azure_devops");
      if (response.ok) {
        const data = await response.json();
        if (data.value) {
          const settings =
            typeof data.value === "string"
              ? JSON.parse(data.value)
              : data.value;
          setAzureDevOpsOrganization(settings.organization || "");
          setAzureDevOpsProject(settings.project || "");
        }
      }
    } catch (err) {
      console.error("Failed to load Azure DevOps settings:", err);
    }
  };

  useEffect(() => {
    loadAzureDevOpsSettings();
  }, []);

  useEffect(() => {
    const getCookieValue = (key: string) => {
      if (typeof document === "undefined") return "";
      const parts = document.cookie.split(";").map((item) => item.trim());
      const found = parts.find((part) => part.startsWith(`${key}=`));
      return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
    };

    const loadProjectUsers = async () => {
      try {
        const [sessionResponse, projectsResponse, usersResponse] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/projects"),
          fetch("/api/users"),
        ]);

        if (!projectsResponse.ok || !usersResponse.ok) {
          return;
        }

        const projects = (await projectsResponse.json()) as AppProject[];
        const users = (await usersResponse.json()) as AppUser[];

        const cookieProjectId = getCookieValue("pm_project_id");
        const activeProject =
          projects.find((project) => String(project.id) === cookieProjectId) ??
          projects[0];

        const memberIds = new Set(activeProject?.member_user_ids ?? []);
        const members = users.filter((user) => memberIds.has(user.id));
        setProjectUsers(members);

        const sessionData = sessionResponse.ok
          ? ((await sessionResponse.json()) as { user?: { id: number } })
          : null;
        const sessionUserId = sessionData?.user?.id;

        const defaultUserId =
          members.find((member) => member.id === sessionUserId)?.id ??
          members[0]?.id;

        setChildUserByDiscipline((previous) => {
          const fallback = defaultUserId ? String(defaultUserId) : "";
          const next: Record<ChildDiscipline, string> = {
            backend: previous.backend,
            frontend: previous.frontend,
            design: previous.design,
          };

          for (const discipline of ["backend", "frontend", "design"] as const) {
            if (
              !next[discipline] ||
              !members.some((member) => String(member.id) === next[discipline])
            ) {
              next[discipline] = fallback;
            }
          }

          return next;
        });
      } catch (err) {
        console.error("Failed to load project users:", err);
      }
    };

    loadProjectUsers();
  }, []);

  useEffect(() => {
    if (!activeReleaseId) {
      setWorkItems([]);
      return;
    }

    let cancelled = false;
    const loadWorkItems = async () => {
      setWorkItemsLoading(true);
      try {
        const response = await fetch(
          `/api/releases/work-items?releaseId=${activeReleaseId}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch release work items");
        }
        const data = (await response.json()) as ReleaseWorkItem[];
        if (!cancelled) {
          setWorkItems(data);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Failed to load release work items");
        }
      } finally {
        if (!cancelled) {
          setWorkItemsLoading(false);
        }
      }
    };

    loadWorkItems();

    return () => {
      cancelled = true;
    };
  }, [activeReleaseId]);

  useEffect(() => {
    if (sortedReleases.length === 0) return;
    if (activeReleaseIndex === -1) return;
    const release = sortedReleases[activeReleaseIndex];
    if (!release) return;
    if (release.id !== activeReleaseId) {
      setActiveReleaseId(release.id);
    }
  }, [sortedReleases, activeReleaseIndex, activeReleaseId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeReleaseId === null) return;
    window.localStorage.setItem(
      ACTIVE_RELEASE_STORAGE_KEY,
      String(activeReleaseId)
    );
  }, [activeReleaseId]);

  useEffect(() => {
    if (!showCreateChild?.workItemExternalId) {
      setExistingChildTasks([]);
      setExistingChildTasksError(null);
      return;
    }

    let cancelled = false;
    const loadExistingChildTasks = async () => {
      setLoadingExistingChildTasks(true);
      setExistingChildTasksError(null);
      try {
        const response = await fetch(
          `/api/azure-devops/child-work-items?parentId=${showCreateChild.workItemExternalId}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch existing child tasks");
        }
        const data = (await response.json()) as {
          items?: Array<{
            id: number;
            title: string;
            type: string;
            state: string;
            assignedTo?: string;
          }>;
        };
        if (!cancelled) {
          setExistingChildTasks(
            (data.items ?? []).map((item) => ({
              id: item.id,
              title: item.title,
              type: item.type,
              status: item.state,
              assignedTo: item.assignedTo,
            }))
          );
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setExistingChildTasksError("Failed to load child items");
          setExistingChildTasks([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingExistingChildTasks(false);
        }
      }
    };

    loadExistingChildTasks();

    return () => {
      cancelled = true;
    };
  }, [showCreateChild]);
  const loadWorkItemsForRelease = useCallback(async (releaseId: number) => {
    setWorkItemsLoading(true);
    try {
      const response = await fetch(`/api/releases/work-items?releaseId=${releaseId}`);
      if (!response.ok) throw new Error("Failed to fetch work items");
      const data = (await response.json()) as ReleaseWorkItem[];
      setWorkItems(data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load release work items");
    } finally {
      setWorkItemsLoading(false);
    }
  }, []);

  const ensureBlockerTaskForItem = useCallback(
    async (item: ReleaseWorkItem) => {
      if (item.task_id && Number(item.task_id) > 0) {
        return Number(item.task_id);
      }

      setBlockerTaskLoadingItemId(item.id);
      try {
        const response = await fetch(
          `/api/releases/work-items/${item.id}/blocker-task`,
          {
            method: "POST",
          }
        );
        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: "Failed to prepare blockers" }));
          throw new Error(errorData.error || "Failed to prepare blockers");
        }
        const data = (await response.json()) as { taskId?: number };
        if (!data.taskId || !Number.isInteger(data.taskId)) {
          throw new Error("Failed to prepare blockers");
        }

        setWorkItems((previous) =>
          previous.map((existing) =>
            existing.id === item.id
              ? {
                  ...existing,
                  task_id: data.taskId,
                }
              : existing
          )
        );
        return data.taskId;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to prepare blockers";
        toast.error(message);
        return null;
      } finally {
        setBlockerTaskLoadingItemId((current) =>
          current === item.id ? null : current
        );
      }
    },
    []
  );

  const handleOpenBlockers = useCallback(
    async (item: ReleaseWorkItem) => {
      const taskId = await ensureBlockerTaskForItem(item);
      if (!taskId) return;
      setShowBlockers({
        taskId,
        taskTitle: item.title,
      });
    },
    [ensureBlockerTaskForItem]
  );

  const loadChildCounts = useCallback(async (titles: string[]) => {
    const parentIds = Array.from(
      new Set(
        titles
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );

    if (parentIds.length === 0) {
      setChildCountsByTitle({});
      setLoadingChildCounts(false);
      return;
    }

    setLoadingChildCounts(true);
    try {
      const response = await fetch("/api/azure-devops/child-work-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentIds }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch child counts");
      }

      const data = (await response.json()) as { counts?: Record<string, ChildCounts> };
      setChildCountsByTitle(data.counts ?? {});
    } catch (err) {
      console.error("Failed to load child counts:", err);
      setChildCountsByTitle({});
    } finally {
      setLoadingChildCounts(false);
    }
  }, []);

  useEffect(() => {
    loadChildCounts(
      workItems
        .filter((item) => item.external_source === "azure_devops" && item.external_id)
        .map((item) => String(item.external_id))
    );
  }, [workItems, loadChildCounts]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setWorkItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex);

        // Update display_order in database
        const workItemOrders = newItems.map((item, index) => ({
          id: item.id,
          order: index,
        }));

        fetch("/api/releases/work-items/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workItemOrders }),
        }).catch((err) => {
          console.error("Failed to update work item order:", err);
          // Revert on error by fetching fresh data
          if (activeReleaseId) {
            loadWorkItemsForRelease(activeReleaseId);
          }
        });

        return newItems;
      });
    }
  }, [activeReleaseId, loadWorkItemsForRelease]);
  const handlePrevRelease = () => {
    if (activeReleaseIndex <= 0) return;
    const prev = sortedReleases[activeReleaseIndex - 1];
    if (prev) setActiveReleaseId(prev.id);
  };

  const handleNextRelease = () => {
    if (activeReleaseIndex < 0) return;
    if (activeReleaseIndex >= sortedReleases.length - 1) return;
    const next = sortedReleases[activeReleaseIndex + 1];
    if (next) setActiveReleaseId(next.id);
  };

  const handleMoveWorkItem = async () => {
    if (!selectedWorkItemToMove || !selectedTargetReleaseId) return;

    try {
      const response = await fetch(`/api/releases/work-items/${selectedWorkItemToMove.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release_id: Number(selectedTargetReleaseId),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to move work item");
      }

      toast.success("Work item moved successfully");
      setMoveWorkItemDialogOpen(false);
      setSelectedWorkItemToMove(null);
      setSelectedTargetReleaseId("");

      // Refresh work items for current release
      if (activeReleaseId) {
        loadWorkItemsForRelease(activeReleaseId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to move work item";
      toast.error(message);
    }
  };

  const handleOpenNotesDialog = (item: ReleaseWorkItem) => {
    setShowNotesDialog({
      workItemId: item.id,
      workItemTitle: item.title,
    });
    setNotesDraft(item.notes ?? "");
  };

  const handleSaveNotes = async () => {
    if (!showNotesDialog) return;

    const workItemId = showNotesDialog.workItemId;
    setNotesSavingWorkItemId(workItemId);

    try {
      const response = await fetch(`/api/releases/work-items/${workItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notesDraft,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to save notes");
      }

      const normalizedNotes = notesDraft.trim();
      setWorkItems((previous) =>
        previous.map((item) =>
          item.id === workItemId
            ? {
                ...item,
                notes: normalizedNotes.length > 0 ? normalizedNotes : null,
              }
            : item
        )
      );
      toast.success(normalizedNotes.length > 0 ? "Notes saved" : "Notes cleared");
      setShowNotesDialog(null);
      setNotesDraft("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save notes";
      toast.error(message);
    } finally {
      setNotesSavingWorkItemId((current) =>
        current === workItemId ? null : current
      );
    }
  };

  const handleRemoveWorkItem = async (workItemId: number) => {
    try {
      const response = await fetch(`/api/releases/work-items?id=${workItemId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to remove work item");
      }

      toast.success("Work item removed from release");

      // Refresh work items for current release
      if (activeReleaseId) {
        loadWorkItemsForRelease(activeReleaseId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove work item";
      toast.error(message);
    }
  };

  const handleWorkItemClick = (workItem: ReleaseWorkItem) => {
    if (workItem.external_source === "azure_devops" && workItem.external_id && azureDevOpsOrganization && azureDevOpsProject) {
      const url = `https://dev.azure.com/${azureDevOpsOrganization}/${azureDevOpsProject}/_workitems/edit/${Math.floor(Number(workItem.external_id))}`;
      window.open(url, "_blank");
    }
  };

  const getStatusBadgeClass = (status?: string | null) => {
    const normalized = status?.trim().toLowerCase();
    if (!normalized) {
      return "bg-muted text-muted-foreground border-border";
    }

    if (
      normalized === "done" ||
      normalized === "resolved" ||
      normalized === "result" ||
      normalized === "closed" ||
      normalized === "completed" ||
      normalized === "released"
    ) {
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800";
    }

    if (normalized === "active") {
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800";
    }

    if (normalized === "blocked") {
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800";
    }

    return "bg-muted text-muted-foreground border-border";
  };

  const getStatusRowClass = (status?: string | null) => {
    const normalized = status?.trim().toLowerCase();
    if (!normalized) {
      return "border-t border-border";
    }

    if (
      normalized === "done" ||
      normalized === "resolved" ||
      normalized === "result" ||
      normalized === "closed" ||
      normalized === "completed" ||
      normalized === "complete" ||
      normalized === "released"
    ) {
      return "border-t border-border bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900";
    }

    if (normalized === "active") {
      return "border-t border-border bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900";
    }

    if (normalized === "blocked") {
      return "border-t border-border bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900";
    }

    return "border-t border-border";
  };

  const getReleaseWorkItemStatusOptions = (): string[] => {
    return ["New", "Active", "Resolved", "Closed"];
  };

  const getChildStatusOptions = (workItemType: string): string[] => {
    const normalized = workItemType.trim().toLowerCase();
    if (normalized === "bug") {
      return ["New", "Active", "Resolved"];
    }
    return ["New", "Active", "Closed"];
  };

  const canOpenAzureDevOpsItem = Boolean(
    azureDevOpsOrganization && azureDevOpsProject
  );

  const handleOpenAzureDevOpsItemById = useCallback(
    (workItemId: number) => {
      if (!canOpenAzureDevOpsItem) return;
      const parsedId = Number(workItemId);
      if (!Number.isInteger(parsedId) || parsedId <= 0) return;
      const url = `https://dev.azure.com/${azureDevOpsOrganization}/${azureDevOpsProject}/_workitems/edit/${Math.floor(parsedId)}`;
      window.open(url, "_blank");
    },
    [azureDevOpsOrganization, azureDevOpsProject, canOpenAzureDevOpsItem]
  );

  const handleReleaseWorkItemStatusChange = useCallback(
    async (item: ReleaseWorkItem, newStatus: string) => {
      if (item.external_source !== "azure_devops" || !item.external_id) {
        toast.error("Only Azure DevOps user stories can be synced");
        return;
      }

      setReleaseStatusUpdatingItemId(item.id);
      try {
        const response = await fetch("/api/azure-devops/release-work-items/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            releaseWorkItemId: item.id,
            status: newStatus,
          }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Failed to update user story status");
        }

        const externalId = Number(item.external_id);
        setWorkItems((previous) =>
          previous.map((workItem) => {
            const workItemExternalId = Number(workItem.external_id);
            if (
              Number.isInteger(externalId) &&
              externalId > 0 &&
              Number.isInteger(workItemExternalId) &&
              workItemExternalId === externalId
            ) {
              return {
                ...workItem,
                state: newStatus,
              };
            }
            if (workItem.id === item.id) {
              return {
                ...workItem,
                state: newStatus,
              };
            }
            return workItem;
          })
        );

        if (data?.synced) {
          toast.success("Status updated and synced with Azure DevOps");
        } else {
          toast.success("Status updated");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update user story status";
        toast.error(message);
      } finally {
        setReleaseStatusUpdatingItemId((current) =>
          current === item.id ? null : current
        );
      }
    },
    []
  );

  const handleChildStatusChange = useCallback(
    async (workItemId: number, workItemType: string, newStatus: string) => {
      const normalizedType = workItemType.trim().toLowerCase();
      if (normalizedType !== "task" && normalizedType !== "bug") {
        toast.error("Unsupported child work item type");
        return;
      }

      setChildStatusUpdatingId(workItemId);
      try {
        const response = await fetch("/api/azure-devops/child-work-items/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workItemId,
            workItemType: normalizedType,
            status: newStatus,
          }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Failed to update child work item status");
        }

        setExistingChildTasks((previous) =>
          previous.map((item) =>
            item.id === workItemId
              ? {
                  ...item,
                  status: newStatus,
                }
              : item
          )
        );
        setChildItemsDialogItems((previous) =>
          previous.map((item) =>
            item.id === workItemId
              ? {
                  ...item,
                  status: newStatus,
                }
              : item
          )
        );

        await loadChildCounts(
          workItems
            .filter(
              (item) => item.external_source === "azure_devops" && item.external_id
            )
            .map((item) => String(item.external_id))
        );

        if (data?.synced) {
          toast.success("Status updated and synced with Azure DevOps");
        } else {
          toast.success("Status updated");
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to update child work item status";
        toast.error(message);
      } finally {
        setChildStatusUpdatingId((current) =>
          current === workItemId ? null : current
        );
      }
    },
    [loadChildCounts, workItems]
  );

  const handleCreateChildTask = useCallback(async () => {
    if (!showCreateChild) return;

    if (childDisciplines.size === 0) {
      toast.error("Select at least one discipline for the child task");
      return;
    }

    setChildSubmitting(true);
    try {
      const selectedOptions = CHILD_TASK_OPTIONS.filter((option) =>
        childDisciplines.has(option.value)
      );

      if (selectedOptions.length === 0) {
        throw new Error("Invalid disciplines selected");
      }

      const responses = await Promise.all(
        selectedOptions.map((option) => {
          const selectedUserId = childUserByDiscipline[option.value];
          const parsedUserId = Number(selectedUserId);

          if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
            throw new Error(`Select a user for ${option.label}`);
          }

          return fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: `${option.prefix} ${showCreateChild.workItemTitle}`,
              type: "task",
              userId: parsedUserId,
            }),
          })
        })
      );

      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        const errorData = await failedResponse.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create child task");
      }

      toast.success("Child task created");
      setShowCreateChild(null);
      setChildDisciplines(new Set());
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to create child task");
    } finally {
      setChildSubmitting(false);
    }
  }, [childDisciplines, childUserByDiscipline, showCreateChild]);

  const loadChildItemsForDialog = useCallback(
    async (parentId: number) => {
      setLoadingChildItemsDialog(true);
      setChildItemsDialogError(null);
      setChildItemsDialogItems([]);
      try {
        const response = await fetch(
          `/api/azure-devops/child-work-items?parentId=${parentId}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch child items");
        }
        const data = (await response.json()) as {
          items?: Array<{
            id: number;
            title: string;
            type: string;
            state: string;
            assignedTo?: string;
          }>;
        };
        setChildItemsDialogItems(
          (data.items ?? []).map((item) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            status: item.state,
            assignedTo: item.assignedTo,
          }))
        );
      } catch (err) {
        console.error(err);
        setChildItemsDialogError("Failed to load child items");
      } finally {
        setLoadingChildItemsDialog(false);
      }
    },
    []
  );

  const handleOpenChildItemsDialog = useCallback(
    (parentId: number, title: string, filter: ChildItemFilter) => {
      setShowChildItemsDialog({ parentId, title, filter });
      loadChildItemsForDialog(parentId);
    },
    [loadChildItemsForDialog]
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      if (!activeReleaseId) {
        toast.error("No active release selected");
        return;
      }

      const refreshResponse = await fetch("/api/azure-devops/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId: activeReleaseId }),
      });

      if (refreshResponse.ok) {
        const result = await refreshResponse.json();

        if (result.updated > 0) {
          toast.success(`Successfully updated ${result.updated} task(s) from Azure DevOps`);
        } else if (result.skipped > 0) {
          toast.info(`All ${result.skipped} imported task(s) are up to date`);
        }
      } else if (refreshResponse.status === 400) {
        console.log("Azure DevOps settings not configured, skipping refresh");
      } else {
        const errorData = await refreshResponse.json();
        toast.error(errorData.error || "Failed to refresh Azure DevOps tasks");
      }
    } catch (err) {
      console.error("Error refreshing Azure DevOps tasks:", err);
      toast.error("An error occurred while refreshing tasks");
    } finally {
      if (activeReleaseId) {
        await loadWorkItemsForRelease(activeReleaseId);
      }
      setIsRefreshing(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 shrink-0">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading releases...</div>
        ) : sortedReleases.length === 0 ? (
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Release Planner</h1>
            <p className="text-sm text-muted-foreground">
              No releases yet. Create one in Settings, Releases tab to start planning.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 items-center justify-center relative">
            <div className="flex gap-3 items-center">
              <Button
                onClick={handlePrevRelease}
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={activeReleaseIndex <= 0}
              >
                ←
              </Button>
              {activeRelease && (
                <div className="text-center min-w-[200px]">
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="text-2xl font-semibold">
                      {activeRelease.name}
                    </h1>
                    {activeRelease.status === "completed" && (
                      <Badge variant="secondary">Completed</Badge>
                    )}
                  </div>
                </div>
              )}
              <Button
                onClick={handleNextRelease}
                variant="outline"
                size="icon"
                className="h-10 w-10"
                disabled={activeReleaseIndex >= sortedReleases.length - 1}
              >
                →
              </Button>
            </div>

            <div className="flex items-center gap-3 absolute right-0">
              {activeRelease && (
                <>
                  <Button
                    onClick={() => setShowImport(true)}
                    size="sm"
                    className="h-10"
                    variant="outline"
                  >
                    Import user stories
                  </Button>
                  <Button
                    onClick={handleRefresh}
                    size="sm"
                    className="h-10"
                    variant="outline"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeRelease && (
          <div className="overflow-auto h-full">
            <div className="p-6 space-y-3">
              {workItemsLoading ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Loading work items...
                </div>
              ) : workItems.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No work items yet. Import user stories to start planning.
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={workItems.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-muted border-b border-border sticky top-0 z-10">
                          <th className="p-3 sticky left-0 bg-muted z-10" style={{ width: "40px" }}>
                            {/* Drag handle column */}
                          </th>
                          <th
                            className="p-3 text-left font-normal text-muted-foreground text-sm sticky left-[40px] bg-muted z-10 overflow-hidden"
                            style={{ width: "40%", minWidth: "240px", maxWidth: "40vw" }}
                          >
                            Work item
                          </th>
                          <th
                            className="p-3 text-left font-normal text-muted-foreground text-sm"
                            style={{ width: "30%", minWidth: "220px" }}
                          >
                            Tags
                          </th>
                          <th
                            className="p-3 text-left font-normal text-muted-foreground text-sm"
                            style={{ width: "30%", minWidth: "220px" }}
                          >
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {workItems.map((item) => {
                          const getWorkItemUrl = () => {
                            if (
                              item.external_source === "azure_devops" &&
                              item.external_id &&
                              azureDevOpsOrganization &&
                              azureDevOpsProject
                            ) {
                              return `https://dev.azure.com/${azureDevOpsOrganization}/${azureDevOpsProject}/_workitems/edit/${Math.floor(Number(item.external_id))}`;
                            }
                            return null;
                          };

                          const workItemUrl = getWorkItemUrl();
                          const itemState = item.state?.toLowerCase();
                          const activeBlockers =
                            item.blockers?.filter((blocker) => !blocker.is_resolved) ?? [];
                          const hasBlockers = activeBlockers.length > 0;
                          const highestSeverity = hasBlockers
                            ? activeBlockers.reduce((max, blocker) => {
                                const severityOrder = {
                                  low: 1,
                                  medium: 2,
                                  high: 3,
                                  critical: 4,
                                };
                                const maxOrder =
                                  severityOrder[max as keyof typeof severityOrder] ?? 0;
                                const blockerOrder =
                                  severityOrder[blocker.severity as keyof typeof severityOrder] ?? 0;
                                return blockerOrder > maxOrder ? blocker.severity : max;
                              }, "low")
                            : null;
                          const externalId = Number(item.external_id);
                          const childCounts =
                            Number.isInteger(externalId) && externalId > 0
                              ? childCountsByTitle[String(externalId)] ?? {
                                  tasks: 0,
                                  bugs: 0,
                                  completedTasks: 0,
                                }
                              : {
                                  tasks: 0,
                                  bugs: 0,
                                  completedTasks: 0,
                                };

                          const getRowClass = () => {
                            if (hasBlockers) {
                              switch (highestSeverity) {
                                case "critical":
                                  return "group border-b border-border bg-red-100 hover:bg-red-200 dark:bg-red-950 dark:hover:bg-red-900";
                                case "high":
                                  return "group border-b border-border bg-orange-100 hover:bg-orange-200 dark:bg-orange-950 dark:hover:bg-orange-900";
                                case "medium":
                                  return "group border-b border-border bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-950 dark:hover:bg-yellow-900";
                                case "low":
                                  return "group border-b border-border bg-blue-100 hover:bg-blue-200 dark:bg-blue-950 dark:hover:bg-blue-900";
                              }
                            }
                            if (itemState === "done" || itemState === "resolved" || itemState === "closed") {
                              return "group border-b border-border bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900";
                            }
                            if (itemState === "active") {
                              return "group border-b border-border bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900";
                            }
                            return "group border-b border-border hover:bg-muted dark:hover:bg-muted";
                          };

                          const getStickyBgClass = () => {
                            if (hasBlockers) {
                              switch (highestSeverity) {
                                case "critical":
                                  return "py-1.5 px-3 sticky left-[40px] bg-red-100 group-hover:bg-red-200 dark:bg-red-950 dark:group-hover:bg-red-900 z-10";
                                case "high":
                                  return "py-1.5 px-3 sticky left-[40px] bg-orange-100 group-hover:bg-orange-200 dark:bg-orange-950 dark:group-hover:bg-orange-900 z-10";
                                case "medium":
                                  return "py-1.5 px-3 sticky left-[40px] bg-yellow-100 group-hover:bg-yellow-200 dark:bg-yellow-950 dark:group-hover:bg-yellow-900 z-10";
                                case "low":
                                  return "py-1.5 px-3 sticky left-[40px] bg-blue-100 group-hover:bg-blue-200 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                              }
                            }
                            if (itemState === "done" || itemState === "resolved" || itemState === "closed") {
                              return "py-1.5 px-3 sticky left-[40px] bg-green-50 group-hover:bg-green-100 dark:bg-green-950 dark:group-hover:bg-green-900 z-10";
                            }
                            if (itemState === "active") {
                              return "py-1.5 px-3 sticky left-[40px] bg-blue-50 group-hover:bg-blue-100 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                            }
                            return "py-1.5 px-3 sticky left-[40px] bg-background dark:bg-card group-hover:bg-muted dark:group-hover:bg-muted z-10";
                          };

                          const getDragHandleBgClass = () => {
                            if (hasBlockers) {
                              switch (highestSeverity) {
                                case "critical":
                                  return "sticky left-0 bg-red-100 group-hover:bg-red-200 dark:bg-red-950 dark:group-hover:bg-red-900 z-10";
                                case "high":
                                  return "sticky left-0 bg-orange-100 group-hover:bg-orange-200 dark:bg-orange-950 dark:group-hover:bg-orange-900 z-10";
                                case "medium":
                                  return "sticky left-0 bg-yellow-100 group-hover:bg-yellow-200 dark:bg-yellow-950 dark:group-hover:bg-yellow-900 z-10";
                                case "low":
                                  return "sticky left-0 bg-blue-100 group-hover:bg-blue-200 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                              }
                            }
                            if (itemState === "done" || itemState === "resolved" || itemState === "closed") {
                              return "sticky left-0 bg-green-50 group-hover:bg-green-100 dark:bg-green-950 dark:group-hover:bg-green-900 z-10";
                            }
                            if (itemState === "active") {
                              return "sticky left-0 bg-blue-50 group-hover:bg-blue-100 dark:bg-blue-950 dark:group-hover:bg-blue-900 z-10";
                            }
                            return "sticky left-0 bg-background dark:bg-card group-hover:bg-muted dark:group-hover:bg-muted z-10";
                          };

                          return (
                            <SortableRow
                              key={item.id}
                              id={item.id}
                              rowClassName={getRowClass()}
                              dragHandleBgClassName={getDragHandleBgClass()}
                            >
                              <td
                                className={getStickyBgClass()}
                                style={{ width: "40%", minWidth: "240px", maxWidth: "40vw" }}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <div className="flex items-center justify-center flex-shrink-0 w-5 h-5">
                                      <ListTodo className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                    </div>
                                    {item.external_id && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs font-mono font-semibold"
                                      >
                                        {Math.floor(Number(item.external_id))}
                                      </Badge>
                                    )}
                                    {hasBlockers && (
                                      <HoverCard openDelay={100} closeDelay={100}>
                                        <HoverCardTrigger>
                                          <Badge
                                            variant="outline"
                                            className="h-5 px-2 text-xs bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 flex items-center gap-1 flex-shrink-0 cursor-pointer"
                                            onClick={() => void handleOpenBlockers(item)}
                                            title={`${activeBlockers.length} active blocker${activeBlockers.length > 1 ? "s" : ""} - Click to manage`}
                                          >
                                            <ShieldAlert className="w-3 h-3" />
                                            <span className="font-semibold">{activeBlockers.length}</span>
                                          </Badge>
                                        </HoverCardTrigger>
                                        <HoverCardContent className="w-80" align="start" side="top" sideOffset={5}>
                                          <div className="space-y-2">
                                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-500" />
                                              Active Blockers ({activeBlockers.length})
                                            </h4>
                                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                              {activeBlockers.map((blocker) => (
                                                <div
                                                  key={blocker.id}
                                                  className="text-xs border rounded-md p-2 bg-background"
                                                >
                                                  <div className="flex items-start justify-between gap-2 mb-1">
                                                    <Badge
                                                      variant="outline"
                                                      className={`h-4 px-1.5 text-[10px] flex-shrink-0 ${
                                                        blocker.severity === "critical"
                                                          ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-400 dark:border-red-800"
                                                          : blocker.severity === "high"
                                                          ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800"
                                                          : blocker.severity === "medium"
                                                          ? "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800"
                                                          : "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800"
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
                                    <Badge
                                      variant="outline"
                                      className={`text-xs ${
                                        itemState === "done" || itemState === "resolved" || itemState === "closed"
                                          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                                          : itemState === "active"
                                          ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800"
                                          : "bg-muted text-muted-foreground border-border"
                                      }`}
                                    >
                                      {item.state || "New"}
                                    </Badge>
                                    {item.external_source === "azure_devops" && item.external_id && (
                                      <>
                                        <Badge
                                          variant="outline"
                                          className="text-xs bg-blue-50 text-blue-700 border-blue-200 cursor-pointer hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            if (!Number.isInteger(externalId) || externalId <= 0) return;
                                            handleOpenChildItemsDialog(externalId, item.title, "task");
                                          }}
                                        >
                                          <span className="inline-flex items-center gap-1">
                                            <ListTodo className="w-3 h-3" aria-hidden="true" />
                                            {loadingChildCounts
                                              ? "?/?"
                                              : `${childCounts.completedTasks}/${childCounts.tasks}`}
                                          </span>
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className="text-xs bg-red-50 text-red-700 border-red-200 cursor-pointer hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            if (!Number.isInteger(externalId) || externalId <= 0) return;
                                            handleOpenChildItemsDialog(externalId, item.title, "bug");
                                          }}
                                        >
                                          <span className="inline-flex items-center gap-1">
                                            <Bug className="w-3 h-3" aria-hidden="true" />
                                            {loadingChildCounts ? "?" : childCounts.bugs}
                                          </span>
                                        </Badge>
                                      </>
                                    )}
                                    <div className="truncate text-sm font-medium min-w-0 flex-1" title={item.title}>
                                      {item.external_source === "azure_devops" && item.external_id ? (
                                        <button
                                          onClick={() => handleWorkItemClick(item)}
                                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer text-left truncate block w-full"
                                          title={`${item.title} - Open in Azure DevOps`}
                                        >
                                          {item.title}
                                        </button>
                                      ) : (
                                        <span className="text-foreground">{item.title}</span>
                                      )}
                                    </div>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 flex-shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
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
                                          {getReleaseWorkItemStatusOptions().map((statusOption) => (
                                            <DropdownMenuItem
                                              key={`${item.id}-${statusOption}`}
                                              disabled={
                                                releaseStatusUpdatingItemId === item.id ||
                                                (item.state || "New").toLowerCase() ===
                                                  statusOption.toLowerCase() ||
                                                item.external_source !== "azure_devops" ||
                                                !item.external_id
                                              }
                                              onClick={() =>
                                                void handleReleaseWorkItemStatusChange(
                                                  item,
                                                  statusOption
                                                )
                                              }
                                            >
                                              {statusOption}
                                            </DropdownMenuItem>
                                          ))}
                                        </DropdownMenuSubContent>
                                      </DropdownMenuSub>
                                      <DropdownMenuItem
                                        disabled={blockerTaskLoadingItemId === item.id}
                                        onClick={() => void handleOpenBlockers(item)}
                                      >
                                        <span className="flex items-center gap-2">
                                          <ShieldAlert className="h-4 w-4" />
                                          <span>
                                            {blockerTaskLoadingItemId === item.id
                                              ? "Preparing..."
                                              : "Manage Blockers"}
                                          </span>
                                          {hasBlockers && (
                                            <Badge variant="outline" className="h-5 px-1.5 text-xs ml-auto">
                                              {activeBlockers.length}
                                            </Badge>
                                          )}
                                        </span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={moveTargetReleases.length === 0}
                                        onClick={() => {
                                          setSelectedWorkItemToMove(item);
                                          setSelectedTargetReleaseId("");
                                          setMoveWorkItemDialogOpen(true);
                                        }}
                                      >
                                        Move to release
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleOpenNotesDialog(item)}>
                                        {item.notes ? "Edit note" : "Add note"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setChildDisciplines(new Set());
                                          const fallbackUserId = projectUsers[0]
                                            ? String(projectUsers[0].id)
                                            : "";
                                          setChildUserByDiscipline((previous) => ({
                                            backend: previous.backend || fallbackUserId,
                                            frontend: previous.frontend || fallbackUserId,
                                            design: previous.design || fallbackUserId,
                                          }));
                                          setShowCreateChild({
                                            workItemId: item.id,
                                            workItemTitle: item.title,
                                            workItemExternalId: item.external_id
                                              ? Number(item.external_id)
                                              : null,
                                          });
                                        }}
                                      >
                                        Create child task
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleRemoveWorkItem(item.id)}
                                        className="text-red-600 dark:text-red-400"
                                      >
                                        Remove from release
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </td>
                              <td className="py-1.5 px-3">
                                {item.tags ? (
                                  <div className="flex flex-wrap gap-1">
                                    {item.tags.split(";").map((tag, idx) => (
                                      tag.trim() && (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {tag.trim()}
                                        </Badge>
                                      )
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </td>
                              <td className="py-1.5 px-3 align-top">
                                {item.notes ? (
                                  <p
                                    className="text-sm text-foreground break-words whitespace-pre-wrap"
                                    style={{
                                      display: "-webkit-box",
                                      WebkitLineClamp: 3,
                                      WebkitBoxOrient: "vertical",
                                      overflow: "hidden",
                                    }}
                                    title={item.notes}
                                  >
                                    {item.notes}
                                  </p>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </td>
                            </SortableRow>
                          );
                        })}
                      </tbody>
                    </table>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        )}
        {!activeRelease && !loading && sortedReleases.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <p className="text-muted-foreground">
                Create your first release in Settings, Releases tab.
              </p>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={!!showCreateChild}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateChild(null);
            setChildDisciplines(new Set());
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[520px] min-w-0 max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader className="min-w-0">
            <DialogTitle>Create Child Task</DialogTitle>
            <DialogDescription className="break-words">
              Choose one or more disciplines for the child task. The title will be prefixed accordingly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 min-w-0">
            {showCreateChild?.workItemExternalId ? (
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Existing DevOps child items (Parent #{showCreateChild.workItemExternalId})
                </div>
                {loadingExistingChildTasks ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : existingChildTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No child tasks or bugs found.
                  </p>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <div className="max-h-56 overflow-auto">
                      <table className="w-full text-[11px]">
                        <thead className="bg-muted sticky top-0 z-10">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                              Work item
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {existingChildTasks.map((task) => (
                            <tr key={task.id} className={getStatusRowClass(task.status)}>
                              <td className="px-2 py-1.5 align-top min-w-0">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div
                                      className="flex items-center justify-center flex-shrink-0"
                                      title={task.type.toLowerCase() === "bug" ? "Bug" : "Task"}
                                    >
                                      {task.type.toLowerCase() === "bug" ? (
                                        <Bug className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
                                      ) : (
                                        <ListTodo className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                                      )}
                                    </div>
                                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] flex-shrink-0">
                                      #{task.id}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className={`h-4 px-1.5 text-[10px] flex-shrink-0 ${getStatusBadgeClass(task.status)}`}
                                    >
                                      {task.status || "Unknown"}
                                    </Badge>
                                    <div className="min-w-0 flex-1">
                                      {canOpenAzureDevOpsItem ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenAzureDevOpsItemById(task.id)}
                                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left truncate block w-full font-medium"
                                          title={`${task.title} - Open in Azure DevOps`}
                                        >
                                          {task.title}
                                        </button>
                                      ) : (
                                        <div className="truncate font-medium" title={task.title}>
                                          {task.title}
                                        </div>
                                      )}
                                    </div>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 flex-shrink-0 opacity-70 hover:opacity-100"
                                          disabled={childStatusUpdatingId === task.id}
                                          title="Actions"
                                        >
                                          <MoreVertical className="h-3.5 w-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-44">
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            <span>Change Status</span>
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            {getChildStatusOptions(task.type).map((statusOption) => (
                                              <DropdownMenuItem
                                                key={`${task.id}-${statusOption}`}
                                                disabled={
                                                  childStatusUpdatingId === task.id ||
                                                  (task.status || "New").toLowerCase() ===
                                                    statusOption.toLowerCase()
                                                }
                                                onClick={() =>
                                                  void handleChildStatusChange(
                                                    task.id,
                                                    task.type,
                                                    statusOption
                                                  )
                                                }
                                              >
                                                {statusOption}
                                              </DropdownMenuItem>
                                            ))}
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground pl-5">
                                    Assigned to: {task.assignedTo || "-"}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {existingChildTasksError && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {existingChildTasksError}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  This work item is not linked to Azure DevOps, so child items cannot be loaded.
                </p>
              </div>
            )}
            {CHILD_TASK_OPTIONS.map((option) => {
              const isSelected = childDisciplines.has(option.value);
              const checkboxId = `release-child-discipline-${option.value}`;
              const selectId = `release-child-user-${option.value}`;
              return (
                <div
                  key={option.value}
                  className={
                    "rounded-md border p-3 transition-colors min-w-0 overflow-x-hidden" +
                    (isSelected ? " bg-muted/60" : " hover:bg-muted/30")
                  }
                >
                  <label
                    htmlFor={checkboxId}
                    className="flex items-start gap-3 cursor-pointer min-w-0"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        setChildDisciplines((prev) => {
                          const next = new Set(prev);
                          if (checked) {
                            next.add(option.value);
                          } else {
                            next.delete(option.value);
                          }
                          return next;
                        });
                      }}
                    />
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground break-words">
                        {option.prefix} {showCreateChild?.workItemTitle}
                      </div>
                    </div>
                  </label>
                  <div className="mt-3 space-y-2">
                    <Label htmlFor={selectId} className="text-xs">
                      Assign {option.label.toLowerCase()} task to
                    </Label>
                    <Select
                      value={childUserByDiscipline[option.value]}
                      onValueChange={(value) =>
                        setChildUserByDiscipline((prev) => ({
                          ...prev,
                          [option.value]: value,
                        }))
                      }
                    >
                      <SelectTrigger id={selectId} className="w-full min-w-0 max-w-full">
                        <SelectValue placeholder="Select a user" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectUsers.map((user) => (
                          <SelectItem key={user.id} value={String(user.id)}>
                            {user.name} {user.email ? `(${user.email})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            {projectUsers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No project users available. Assign users in Settings before creating child tasks.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowCreateChild(null);
                setChildDisciplines(new Set());
              }}
              disabled={childSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateChildTask}
              disabled={childDisciplines.size === 0 || childSubmitting || projectUsers.length === 0}
            >
              {childSubmitting ? "Creating..." : "Create Child Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showNotesDialog && (
        <Dialog
          open={!!showNotesDialog}
          onOpenChange={(open) => {
            if (!open && notesSavingWorkItemId === null) {
              setShowNotesDialog(null);
              setNotesDraft("");
            }
          }}
        >
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>
                {workItems.find((item) => item.id === showNotesDialog.workItemId)?.notes
                  ? "Edit note"
                  : "Add note"}
              </DialogTitle>
              <DialogDescription>
                {showNotesDialog.workItemTitle}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="work-item-notes">Notes</Label>
              <textarea
                id="work-item-notes"
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                placeholder="Add implementation details, dependencies, risks, or any context..."
                className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowNotesDialog(null);
                  setNotesDraft("");
                }}
                disabled={notesSavingWorkItemId === showNotesDialog.workItemId}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveNotes()}
                disabled={notesSavingWorkItemId === showNotesDialog.workItemId}
              >
                {notesSavingWorkItemId === showNotesDialog.workItemId
                  ? "Saving..."
                  : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {moveWorkItemDialogOpen && (
        <Dialog open={moveWorkItemDialogOpen} onOpenChange={setMoveWorkItemDialogOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Move work item</DialogTitle>
              <DialogDescription>
                Select the release to move this work item to.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Work item</Label>
                <div className="text-sm font-medium">{selectedWorkItemToMove?.title}</div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-release">Target release</Label>
                <Select value={selectedTargetReleaseId} onValueChange={setSelectedTargetReleaseId}>
                  <SelectTrigger id="target-release">
                    <SelectValue placeholder="Select a release" />
                  </SelectTrigger>
                  <SelectContent>
                    {moveTargetReleases.map((release) => (
                        <SelectItem key={release.id} value={String(release.id)}>
                          {release.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {moveTargetReleases.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No active target releases available.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setMoveWorkItemDialogOpen(false);
                  setSelectedWorkItemToMove(null);
                  setSelectedTargetReleaseId("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleMoveWorkItem}
                disabled={!selectedTargetReleaseId}
              >
                Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showChildItemsDialog && (
        <Dialog
          open={!!showChildItemsDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowChildItemsDialog(null);
              setChildItemsDialogItems([]);
              setChildItemsDialogError(null);
            }
          }}
        >
          <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Child {showChildItemsDialog.filter === "task" ? "Tasks" : "Bugs"}
              </DialogTitle>
              <DialogDescription>
                Parent #{showChildItemsDialog.parentId}: {showChildItemsDialog.title}
              </DialogDescription>
            </DialogHeader>
            {loadingChildItemsDialog ? (
              <p className="text-sm text-muted-foreground">Loading child items...</p>
            ) : childItemsDialogError ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {childItemsDialogError}
              </p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Work item
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredChildItemsDialog.map((childItem) => (
                        <tr key={childItem.id} className={getStatusRowClass(childItem.status)}>
                          <td className="px-3 py-2 align-top min-w-0">
                            <div className="flex flex-col gap-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="flex items-center justify-center flex-shrink-0"
                                  title={childItem.type.toLowerCase() === "bug" ? "Bug" : "Task"}
                                >
                                  {childItem.type.toLowerCase() === "bug" ? (
                                    <Bug className="w-4 h-4 text-red-600 dark:text-red-500" />
                                  ) : (
                                    <ListTodo className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                                  )}
                                </div>
                                <Badge variant="outline" className="h-5 px-2 text-xs flex-shrink-0">
                                  #{childItem.id}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`h-5 px-2 text-xs flex-shrink-0 ${getStatusBadgeClass(childItem.status)}`}
                                >
                                  {childItem.status || "Unknown"}
                                </Badge>
                                <div className="min-w-0 flex-1">
                                  {canOpenAzureDevOpsItem ? (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenAzureDevOpsItemById(childItem.id)}
                                      className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left truncate block w-full"
                                      title={`${childItem.title} - Open in Azure DevOps`}
                                    >
                                      {childItem.title}
                                    </button>
                                  ) : (
                                    <div className="font-medium truncate" title={childItem.title}>
                                      {childItem.title}
                                    </div>
                                  )}
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 flex-shrink-0 opacity-70 hover:opacity-100"
                                      disabled={childStatusUpdatingId === childItem.id}
                                      title="Actions"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <span>Change Status</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        {getChildStatusOptions(childItem.type).map((statusOption) => (
                                          <DropdownMenuItem
                                            key={`${childItem.id}-${statusOption}`}
                                            disabled={
                                              childStatusUpdatingId === childItem.id ||
                                              (childItem.status || "New").toLowerCase() ===
                                                statusOption.toLowerCase()
                                            }
                                            onClick={() =>
                                              void handleChildStatusChange(
                                                childItem.id,
                                                childItem.type,
                                                statusOption
                                              )
                                            }
                                          >
                                            {statusOption}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              <div className="text-xs text-muted-foreground pl-6">
                                Assigned to: {childItem.assignedTo || "-"}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredChildItemsDialog.length === 0 && (
                  <p className="text-sm text-muted-foreground p-3 border-t border-border">
                    No {showChildItemsDialog.filter === "task" ? "tasks" : "bugs"} found.
                  </p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {showBlockers && (
        <BlockersModal
          taskId={showBlockers.taskId}
          taskTitle={showBlockers.taskTitle}
          onClose={() => setShowBlockers(null)}
          onSuccess={() => {
            if (activeReleaseId) {
              loadWorkItemsForRelease(activeReleaseId);
            }
          }}
        />
      )}

      {showImport && activeRelease && (
        <ReleaseImportModal
          releaseId={activeRelease.id}
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            if (activeReleaseId) {
              fetch(`/api/releases/work-items?releaseId=${activeReleaseId}`)
                .then((response) => response.json())
                .then((data: ReleaseWorkItem[]) => setWorkItems(data))
                .catch((err) => {
                  console.error(err);
                  toast.error("Failed to refresh work items");
                });
            }
          }}
        />
      )}
    </div>
  );
}
