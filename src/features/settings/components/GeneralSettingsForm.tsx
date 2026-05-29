"use client";

import { useEffect, useMemo, useState } from "react";
import type { Release } from "@/types";
import { CheckCircle2, ExternalLink, GripVertical, MoreHorizontal } from "lucide-react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { parseAzureDevOpsProjectUrl } from "@/lib/azure-devops/project-url";
import { ProfileSettingsForm } from "@/features/settings/components/ProfileSettingsForm";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface GeneralSettingsFormProps {
  isAdmin?: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
  showCancel?: boolean;
}

interface DatabaseBackupFile {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

interface AppUser {
  id: number;
  host_user_id?: string | null;
  name: string;
  email?: string | null;
  is_admin?: number;
  created_at?: string;
}

interface AppProject {
  id: number;
  name: string;
  member_user_ids?: number[];
  is_default?: boolean;
  azure_devops?: {
    organization: string;
    project: string;
    projectUrl: string;
  } | null;
}

interface ApiError {
  error?: string;
}

interface SortableReleaseRowProps {
  id: number;
  release: Release;
  onEdit: (release: Release) => void;
  onStatusChange: (release: Release, status: Release["status"]) => void | Promise<void>;
  updatingReleaseId: number | null;
}

function SortableReleaseRow({
  id,
  release,
  onEdit,
  onStatusChange,
  updatingReleaseId,
}: SortableReleaseRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-background p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="mt-0.5 cursor-grab rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-medium">{release.name}</h3>
              <Badge
                variant={release.status === "completed" ? "secondary" : "outline"}
                className="h-5 px-2 text-[10px]"
              >
                {release.status === "completed" ? "Completed" : "Active"}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Actions for ${release.name}`}
                disabled={updatingReleaseId === release.id}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(release)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit release
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  void onStatusChange(
                    release,
                    release.status === "completed" ? "active" : "completed"
                  )
                }
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {release.status === "completed" ? "Mark active" : "Mark completed"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function GeneralSettingsForm({
  isAdmin = true,
  onCancel,
  onSaved,
  showCancel = false,
}: GeneralSettingsFormProps) {
  const [activeTab, setActiveTab] = useState("profile");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const [updatingProject, setUpdatingProject] = useState(false);
  const [settingDefaultProjectId, setSettingDefaultProjectId] = useState<number | null>(null);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [projectFormName, setProjectFormName] = useState("");
  const [projectFormAzureUrl, setProjectFormAzureUrl] = useState("");
  const [projectFormMemberUserIds, setProjectFormMemberUserIds] = useState<Set<number>>(new Set());
  const [projectPendingDelete, setProjectPendingDelete] = useState<AppProject | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [editingReleaseId, setEditingReleaseId] = useState<number | null>(null);
  const [releaseFormName, setReleaseFormName] = useState("");
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [updatingReleaseId, setUpdatingReleaseId] = useState<number | null>(null);

  // AI provider settings
  const [aiProviderBaseUrl, setAiProviderBaseUrl] = useState("");
  const [aiProviderModel, setAiProviderModel] = useState("");
  const [hasAiProviderSettings, setHasAiProviderSettings] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [backups, setBackups] = useState<DatabaseBackupFile[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [pendingBackupAction, setPendingBackupAction] = useState<{
    action: "restore" | "delete";
    fileName: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingAiProvider, setTestingAiProvider] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">(
    "success"
  );

  const releaseSensors = useSensors(
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

  const parsedProjectFormAzureProject = useMemo(
    () => parseAzureDevOpsProjectUrl(projectFormAzureUrl),
    [projectFormAzureUrl]
  );
  const formAzureOrganization = parsedProjectFormAzureProject?.organization ?? "";
  const formAzureProject = parsedProjectFormAzureProject?.project ?? "";

  const fetchModels = async (baseUrl: string) => {
    setLoadingModels(true);
    try {
      const response = await fetch("/api/ai-provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl }),
      });
      const data = await response.json();
      if (response.ok && data.models) {
        setAvailableModels(data.models);
      }
    } catch {
      // Silently fail - models will be empty
    } finally {
      setLoadingModels(false);
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const [usersResponse, sessionResponse] = await Promise.all([
        fetch("/api/users", { method: "POST" }),
        fetch("/api/auth/session"),
      ]);
      if (!usersResponse.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = (await usersResponse.json()) as AppUser[];
      setUsers(data);
      if (sessionResponse.ok) {
        const sessionData = (await sessionResponse.json()) as { user?: AppUser };
        setCurrentUserId(sessionData.user?.id ?? null);
      } else {
        setCurrentUserId(null);
      }
    } catch (err) {
      setMessage("Failed to load users.");
      setMessageType("error");
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadReleases = async () => {
    setLoadingReleases(true);
    try {
      const response = await fetch("/api/releases");
      if (!response.ok) {
        throw new Error("Failed to fetch releases");
      }
      const data = (await response.json()) as Release[];
      setReleases(data);
    } catch (err) {
      setMessage("Failed to load releases.");
      setMessageType("error");
    } finally {
      setLoadingReleases(false);
    }
  };

  const readCookie = (key: string) => {
    const parts = document.cookie.split(";").map((item) => item.trim());
    const found = parts.find((part) => part.startsWith(`${key}=`));
    return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
  };

  const setProjectCookie = (projectId: string) => {
    if (!projectId) {
      document.cookie = "pm_project_id=; path=/; max-age=0; samesite=lax";
      document.cookie = "pm_project_user_id=; path=/; max-age=0; samesite=lax";
      return;
    }
    document.cookie = `pm_project_id=${encodeURIComponent(projectId)}; path=/; max-age=31536000; samesite=lax`;
    if (currentUserId) {
      document.cookie = `pm_project_user_id=${encodeURIComponent(String(currentUserId))}; path=/; max-age=31536000; samesite=lax`;
    }
  };

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) {
        throw new Error("Failed to fetch projects");
      }

      const data = (await response.json()) as AppProject[];
      setProjects(data);
      const cookieProjectId = readCookie("pm_project_id");
      const defaultProject = data.find((project) => project.is_default);
      const selectedId = data.some((project) => String(project.id) === cookieProjectId)
        ? cookieProjectId
        : defaultProject
        ? String(defaultProject.id)
        : data[0]
        ? String(data[0].id)
        : "";
      setActiveProjectId(selectedId);
      if (selectedId && selectedId !== cookieProjectId) {
        setProjectCookie(selectedId);
      } else if (!selectedId && cookieProjectId) {
        setProjectCookie("");
      }
    } catch (err) {
      setMessage("Failed to load projects.");
      setMessageType("error");
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    if (!message) return;

    if (messageType === "success") {
      toast.success(message);
    } else {
      toast.error(message);
    }

    setMessage("");
  }, [message, messageType]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      setLoadingUsers(false);
      setLoadingProjects(false);
      setLoadingBackups(false);
      setLoadingReleases(false);
      return;
    }

    loadUsers();
    loadProjects();
    loadSettings();
    loadBackups();
    loadReleases();
    // load* functions are intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const response = await fetch("/api/database/backups");
      if (!response.ok) {
        throw new Error("Failed to load backups");
      }

      const data = (await response.json()) as DatabaseBackupFile[];
      setBackups(data);
    } catch (err) {
      setMessage("Failed to load database backups.");
      setMessageType("error");
    } finally {
      setLoadingBackups(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      // Load AI provider settings
      const aiProviderResponse = await fetch("/api/settings?key=ai_provider");
      if (aiProviderResponse.ok) {
        const data = await aiProviderResponse.json();
        if (data.value) {
          const settings =
            typeof data.value === "string"
              ? JSON.parse(data.value)
              : data.value;
          const baseUrl = settings.baseUrl || settings.endpoint || "";
          setAiProviderBaseUrl(baseUrl);
          setAiProviderModel(settings.model || "");
          setHasAiProviderSettings(Boolean(baseUrl || settings.model));
          if (baseUrl) {
            fetchModels(baseUrl);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateProjectDialog = () => {
    setEditingProjectId(null);
    setProjectFormName("");
    setProjectFormAzureUrl("");
    setProjectFormMemberUserIds(new Set());
    setProjectDialogOpen(true);
  };

  const openEditProjectDialog = (project: AppProject) => {
    setEditingProjectId(project.id);
    setProjectFormName(project.name);
    setProjectFormAzureUrl(project.azure_devops?.projectUrl ?? "");
    setProjectFormMemberUserIds(new Set(project.member_user_ids ?? []));
    setProjectDialogOpen(true);
  };

  const toggleProjectFormMember = (
    userId: number,
    checked: boolean | "indeterminate"
  ) => {
    setProjectFormMemberUserIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  };

  const handleSaveProject = async () => {
    const trimmed = projectFormName.trim();
    if (!trimmed) {
      setMessage("Project name is required.");
      setMessageType("error");
      return;
    }

    const trimmedAzureProjectUrl = projectFormAzureUrl.trim();
    if (trimmedAzureProjectUrl && !parsedProjectFormAzureProject) {
      setMessage("A valid Azure DevOps project URL is required.");
      setMessageType("error");
      return;
    }

    const editing = editingProjectId !== null;
    if (editing) {
      setUpdatingProject(true);
    } else {
      setCreatingProject(true);
    }

    try {
      const payload = {
        ...(editing ? { id: editingProjectId } : {}),
        name: trimmed,
        memberUserIds: Array.from(projectFormMemberUserIds),
        azureProjectUrl: trimmedAzureProjectUrl,
      };
      const response = await fetch("/api/projects", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError & AppProject;
      if (!response.ok) {
        throw new Error(data.error || (editing ? "Failed to update project." : "Failed to create project."));
      }

      setProjectDialogOpen(false);
      await loadProjects();
      if (!editing && data.id) {
        setActiveProjectId(String(data.id));
        setProjectCookie(String(data.id));
      }
      setMessage(editing ? `Project "${trimmed}" updated.` : `Project "${trimmed}" created.`);
      setMessageType("success");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : editingProjectId
            ? "Failed to update project."
            : "Failed to create project.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setCreatingProject(false);
      setUpdatingProject(false);
    }
  };

  const handleDeleteProject = async (project: AppProject) => {
    setUpdatingProject(true);
    try {
      const response = await fetch(`/api/projects?id=${project.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete project.");
      }

      await loadProjects();
      setProjectPendingDelete(null);
      if (String(project.id) === activeProjectId) {
        const remaining = projects.filter((item) => item.id !== project.id);
        const nextProjectId = remaining[0] ? String(remaining[0].id) : "";
        setActiveProjectId(nextProjectId);
        setProjectCookie(nextProjectId);
      }
      setMessage(`Project "${project.name}" deleted.`);
      setMessageType("success");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete project.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setUpdatingProject(false);
    }
  };

  const handleSwitchProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setProjectCookie(projectId);
    window.location.reload();
  };

  const handleSetDefaultProject = async (project: AppProject) => {
    setSettingDefaultProjectId(project.id);
    try {
      const response = await fetch("/api/projects/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        throw new Error(data.error || "Failed to set default project.");
      }

      setProjects((prev) =>
        prev.map((item) => ({ ...item, is_default: item.id === project.id }))
      );
      setMessage(`Default project set to "${project.name}".`);
      setMessageType("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to set default project.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setSettingDefaultProjectId(null);
    }
  };

  const openCreateReleaseDialog = () => {
    setEditingReleaseId(null);
    setReleaseFormName("");
    setReleaseDialogOpen(true);
  };

  const openEditReleaseDialog = (release: Release) => {
    setEditingReleaseId(release.id);
    setReleaseFormName(release.name);
    setReleaseDialogOpen(true);
  };

  const resetReleaseDialog = () => {
    setReleaseDialogOpen(false);
    setEditingReleaseId(null);
    setReleaseFormName("");
  };

  const handleSaveRelease = async () => {
    const trimmed = releaseFormName.trim();
    if (!activeProjectId) {
      setMessage("Create a project before adding releases.");
      setMessageType("error");
      return;
    }
    if (!trimmed) {
      setMessage("Release name is required.");
      setMessageType("error");
      return;
    }

    const editing = editingReleaseId !== null;
    const editingRelease = editing
      ? releases.find((release) => release.id === editingReleaseId)
      : null;
    if (editing && editingRelease?.name === trimmed) {
      resetReleaseDialog();
      return;
    }

    if (editing && editingReleaseId !== null) {
      setUpdatingReleaseId(editingReleaseId);
    } else {
      setCreatingRelease(true);
    }

    try {
      const response = await fetch("/api/releases", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? { id: editingReleaseId } : {}),
          name: trimmed,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(data.error || (editing ? "Failed to update release." : "Failed to create release."));
      }

      resetReleaseDialog();
      await loadReleases();
      setMessage(editing ? `Release "${trimmed}" updated.` : `Release "${trimmed}" created.`);
      setMessageType("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : editing
            ? "Failed to update release."
            : "Failed to create release.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setCreatingRelease(false);
      setUpdatingReleaseId(null);
    }
  };

  const handleReleaseStatusChange = async (
    release: Release,
    status: Release["status"]
  ) => {
    if (release.status === status) return;

    setUpdatingReleaseId(release.id);
    try {
      const response = await fetch("/api/releases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: release.id, status }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(data.error || "Failed to update release status.");
      }

      setReleases((prev) =>
        prev.map((item) =>
          item.id === release.id ? { ...item, status } : item
        )
      );
      setMessage(
        status === "completed"
          ? `Release "${release.name}" marked as completed.`
          : `Release "${release.name}" marked as active.`
      );
      setMessageType("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to update release status.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setUpdatingReleaseId(null);
    }
  };

  const handleReleaseDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const current = [...sortedReleases];
    const oldIndex = current.findIndex((release) => release.id === active.id);
    const newIndex = current.findIndex((release) => release.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(current, oldIndex, newIndex).map(
      (release, index) => ({
        ...release,
        display_order: index,
      })
    );
    setReleases(reordered);

    try {
      const response = await fetch("/api/releases/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseOrders: reordered.map((release, index) => ({
            id: release.id,
            order: index,
          })),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(data.error || "Failed to reorder releases.");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to reorder releases.";
      setMessage(errorMessage);
      setMessageType("error");
      await loadReleases();
    }
  };

  const handleTestAiProviderConnection = async () => {
    if (!aiProviderBaseUrl.trim()) {
      setMessage("Please enter the AI provider base URL");
      setMessageType("error");
      return;
    }

    setTestingAiProvider(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai-provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: aiProviderBaseUrl }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(`Success: ${data.message}`);
        setMessageType("success");
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
        }
      } else {
        setMessage(`Error: ${data.error || "Connection failed"}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage(
        "Error: Connection failed. Make sure the AI provider is reachable from the module container."
      );
      setMessageType("error");
    } finally {
      setTestingAiProvider(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedAiProviderBaseUrl = aiProviderBaseUrl.trim();
    const trimmedAiProviderModel = aiProviderModel.trim();
    const hasAnyAiProviderInput =
      trimmedAiProviderBaseUrl.length > 0 || trimmedAiProviderModel.length > 0;
    if (hasAnyAiProviderInput && (!trimmedAiProviderBaseUrl || !trimmedAiProviderModel)) {
      setMessage("AI provider base URL and model are required when AI is configured.");
      setMessageType("error");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      if (hasAnyAiProviderInput) {
        const aiProviderResponse = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "ai_provider",
            value: {
              baseUrl: trimmedAiProviderBaseUrl,
              model: trimmedAiProviderModel,
            },
          }),
        });

        if (!aiProviderResponse.ok) {
          throw new Error("Failed to save AI provider settings");
        }
        setHasAiProviderSettings(true);
      } else if (hasAiProviderSettings) {
        const aiProviderResponse = await fetch("/api/settings?key=ai_provider", {
          method: "DELETE",
        });

        if (!aiProviderResponse.ok) {
          throw new Error("Failed to clear AI provider settings");
        }
        setHasAiProviderSettings(false);
      }

      setMessage("Settings saved successfully.");
      setMessageType("success");

      if (onSaved) {
        window.setTimeout(() => {
          onSaved();
        }, 1500);
      }
    } catch (err) {
      setMessage("Failed to save settings.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  const formatBackupSize = (sizeBytes: number) => {
    if (sizeBytes < 1024) {
      return `${sizeBytes} B`;
    }
    if (sizeBytes < 1024 * 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`;
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    setMessage("");

    try {
      const response = await fetch("/api/database/backups", {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create backup");
      }

      await loadBackups();
      setMessage(`Database backup created: ${data.fileName}`);
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create database backup.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setCreatingBackup(false);
    }
  };

  const restoreBackup = async (fileName: string) => {
    setRestoringBackup(true);
    setPendingBackupAction(null);
    setMessage("");

    try {
      const response = await fetch("/api/database/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to restore backup");
      }

      setMessage(`Database restored from ${fileName}. Refresh to see updated data.`);
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to restore database backup.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setRestoringBackup(false);
    }
  };

  const deleteBackup = async (fileName: string) => {
    setDeletingBackup(true);
    setPendingBackupAction(null);
    setMessage("");

    try {
      const response = await fetch(
        `/api/database/backups?fileName=${encodeURIComponent(fileName)}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete backup");
      }

      await loadBackups();
      setMessage(`Backup deleted: ${fileName}`);
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete database backup.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setDeletingBackup(false);
    }
  };

  const adminUsers = users.filter((user) => user.is_admin);
  const assignableUsers = users.filter((user) => !user.is_admin);
  const editingProject = editingProjectId
    ? projects.find((project) => project.id === editingProjectId)
    : null;
  const editingRelease = editingReleaseId
    ? releases.find((release) => release.id === editingReleaseId)
    : null;

  return loading ? (
    <div className="text-center py-8">Loading settings...</div>
  ) : !isAdmin ? (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-1">
        <TabsTrigger value="profile">Profile</TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="mt-4">
        <ProfileSettingsForm />
      </TabsContent>
    </Tabs>
  ) : (
    <form onSubmit={handleSave}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="ai">AI Provider</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfileSettingsForm />
        </TabsContent>

        <TabsContent value="projects" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Label>Projects</Label>
              <p className="text-xs text-muted-foreground">
                Administrators can open every project automatically. Explicit access is used for non-admin users.
              </p>
            </div>
            <Button
              type="button"
              onClick={openCreateProjectDialog}
              disabled={creatingProject || updatingProject || loadingUsers}
            >
              <Plus className="h-4 w-4" />
              Add new project
            </Button>
          </div>

          <div className="space-y-2">
            {loadingProjects ? (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">Loading projects...</p>
            ) : projects.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No projects yet. Create a project to enable project-scoped tasks, releases, and Azure DevOps integration.
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => {
                  const memberIds = new Set(project.member_user_ids ?? []);
                  const projectMembers = users.filter((user) => memberIds.has(user.id));
                  const isActiveProject = String(project.id) === activeProjectId;

                  return (
                    <div
                      key={project.id}
                      className="rounded-md border bg-background p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-medium">{project.name}</h3>
                            {isActiveProject ? (
                              <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                                Active
                              </Badge>
                            ) : null}
                            {project.is_default ? (
                              <Badge variant="outline" className="h-5 px-2 text-[10px]">
                                Default
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {project.azure_devops
                              ? `Azure DevOps: ${project.azure_devops.organization} / ${project.azure_devops.project}`
                              : "Azure DevOps is not configured."}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {projectMembers.length === 0
                              ? "No explicit non-admin users assigned."
                              : `Assigned users: ${projectMembers.map((user) => user.name).join(", ")}`}
                          </p>
                        </div>
                        <div className="flex shrink-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Actions for ${project.name}`}
                                disabled={updatingProject || creatingProject || settingDefaultProjectId !== null}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => handleSwitchProject(String(project.id))}
                                disabled={isActiveProject}
                              >
                                Use project
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void handleSetDefaultProject(project)}
                                disabled={Boolean(project.is_default)}
                              >
                                <Star className="mr-2 h-4 w-4" />
                                {settingDefaultProjectId === project.id
                                  ? "Setting..."
                                  : project.is_default
                                    ? "Default project"
                                    : "Set default"}
                              </DropdownMenuItem>
                              {project.azure_devops?.projectUrl ? (
                                <DropdownMenuItem asChild>
                                  <a
                                    href={project.azure_devops.projectUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Open Azure DevOps
                                  </a>
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem disabled>
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Open Azure DevOps
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => openEditProjectDialog(project)}
                                disabled={loadingUsers}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit project
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setProjectPendingDelete(project)}
                                className="text-red-600 focus:bg-red-50 focus:text-red-600"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete project
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingProject ? "Edit project" : "Add new project"}</DialogTitle>
                <DialogDescription>
                  Configure the project name, optional Azure DevOps project URL, and explicit access for non-admin users.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="projectFormName">Project name</Label>
                  <Input
                    id="projectFormName"
                    value={projectFormName}
                    onChange={(event) => setProjectFormName(event.target.value)}
                    placeholder="e.g., Mobile App"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projectFormAzureUrl">Azure DevOps project URL</Label>
                  <Input
                    id="projectFormAzureUrl"
                    value={projectFormAzureUrl}
                    onChange={(event) => setProjectFormAzureUrl(event.target.value)}
                    placeholder="https://dev.azure.com/mycompany/MyProject"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to keep this project local-only. PAT credentials are configured per user in Profile.
                  </p>
                  {projectFormAzureUrl.trim() ? (
                    parsedProjectFormAzureProject ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input value={formAzureOrganization} readOnly className="bg-muted" />
                        <Input value={formAzureProject} readOnly className="bg-muted" />
                      </div>
                    ) : (
                      <p className="text-xs text-destructive">
                        Enter a URL like https://dev.azure.com/organization/project.
                      </p>
                    )
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>User access</Label>
                  {adminUsers.length > 0 ? (
                    <div className="space-y-1 rounded-md border bg-muted/40 p-2">
                      {adminUsers.map((user) => (
                        <div
                          key={`project-admin-${user.id}`}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="truncate">{user.name}</span>
                          <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                            Host admin access
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {loadingUsers ? (
                    <p className="text-sm text-muted-foreground">Loading users...</p>
                  ) : assignableUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No non-admin users are available for explicit project access.
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-auto rounded-md border p-2">
                      {assignableUsers.map((user) => (
                        <label
                          key={`project-form-member-${user.id}`}
                          className="flex items-center gap-2 rounded-md bg-background px-2 py-1.5"
                        >
                          <Checkbox
                            checked={projectFormMemberUserIds.has(user.id)}
                            onCheckedChange={(checked) => toggleProjectFormMember(user.id, checked)}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">{user.name}</span>
                          <span className="max-w-[11rem] truncate text-xs text-muted-foreground">
                            {user.email || "No email"}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setProjectDialogOpen(false)}
                  disabled={creatingProject || updatingProject}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveProject}
                  disabled={creatingProject || updatingProject}
                >
                  {creatingProject || updatingProject ? "Saving..." : "Save project"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(projectPendingDelete)}
            onOpenChange={(open) => {
              if (!open) {
                setProjectPendingDelete(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Delete project</DialogTitle>
                <DialogDescription>
                  Delete &quot;{projectPendingDelete?.name}&quot; and all of its tasks, releases, days off, and settings. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setProjectPendingDelete(null)}
                  disabled={updatingProject}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    if (projectPendingDelete) {
                      void handleDeleteProject(projectPendingDelete);
                    }
                  }}
                  disabled={updatingProject}
                >
                  {updatingProject ? "Deleting..." : "Delete project"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="releases" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Label>Releases</Label>
              <p className="text-xs text-muted-foreground">
                Plan releases for the active project and reorder them for the Planning page.
              </p>
            </div>
            <Button
              type="button"
              onClick={openCreateReleaseDialog}
              disabled={creatingRelease || updatingReleaseId !== null || !activeProjectId}
            >
              <Plus className="h-4 w-4" />
              Add new release
            </Button>
          </div>

          <div className="space-y-2">
            {loadingReleases ? (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">Loading releases...</p>
            ) : sortedReleases.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No releases yet. Create a release to start planning work items.
              </div>
            ) : (
              <DndContext
                sensors={releaseSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleReleaseDragEnd}
              >
                <SortableContext
                  items={sortedReleases.map((release) => release.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {sortedReleases.map((release) => (
                      <SortableReleaseRow
                        key={release.id}
                        id={release.id}
                        release={release}
                        onEdit={openEditReleaseDialog}
                        onStatusChange={handleReleaseStatusChange}
                        updatingReleaseId={updatingReleaseId}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          <Dialog
            open={releaseDialogOpen}
            onOpenChange={(open) => {
              if (!open) {
                resetReleaseDialog();
              } else {
                setReleaseDialogOpen(true);
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingRelease ? "Edit release" : "Add new release"}</DialogTitle>
                <DialogDescription>
                  Configure the release name used in planning.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="releaseFormName">Release name</Label>
                <Input
                  id="releaseFormName"
                  value={releaseFormName}
                  onChange={(event) => setReleaseFormName(event.target.value)}
                  placeholder="e.g., Q2 Launch"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSaveRelease();
                    }
                  }}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetReleaseDialog}
                  disabled={creatingRelease || updatingReleaseId !== null}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSaveRelease()}
                  disabled={creatingRelease || updatingReleaseId !== null}
                >
                  {creatingRelease || updatingReleaseId !== null
                    ? "Saving..."
                    : "Save release"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="backups" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Label>Backups</Label>
              <p className="text-xs text-muted-foreground">
                Create database snapshots and restore or remove existing backup files.
              </p>
            </div>
            <Button
              type="button"
              onClick={handleCreateBackup}
              disabled={creatingBackup || deletingBackup || saving || restoringBackup}
            >
              {creatingBackup ? "Creating..." : "Create Backup"}
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Backup file</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingBackups ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      Loading backups...
                    </TableCell>
                  </TableRow>
                ) : backups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No backup files found.
                    </TableCell>
                  </TableRow>
                ) : (
                  backups.map((backup) => {
                    const actionsDisabled =
                      creatingBackup || deletingBackup || restoringBackup || saving;

                    return (
                      <TableRow key={backup.fileName}>
                        <TableCell className="font-medium">
                          <span className="break-all">{backup.fileName}</span>
                        </TableCell>
                        <TableCell>
                          {new Date(backup.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>{formatBackupSize(backup.sizeBytes)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Actions for backup ${backup.fileName}`}
                                disabled={actionsDisabled}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() =>
                                  setPendingBackupAction({
                                    action: "restore",
                                    fileName: backup.fileName,
                                  })
                                }
                              >
                                Restore from backup
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() =>
                                  setPendingBackupAction({
                                    action: "delete",
                                    fileName: backup.fileName,
                                  })
                                }
                                className="text-red-600 focus:bg-red-50 focus:text-red-600"
                              >
                                Delete backup
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="ai" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="aiProviderBaseUrl">Provider Base URL</Label>
            <Input
              id="aiProviderBaseUrl"
              type="text"
              value={aiProviderBaseUrl}
              onChange={(e) => {
                setAiProviderBaseUrl(e.target.value);
                setAvailableModels([]);
              }}
              placeholder="http://host.docker.internal:1234"
            />
            <p className="text-xs text-muted-foreground">
              Use a URL reachable from inside the module container, such as
              http://host.docker.internal:1234 for a host-running local provider.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="aiProviderModel">Model</Label>
            <Input
              id="aiProviderModel"
              type="text"
              value={aiProviderModel}
              onChange={(e) => setAiProviderModel(e.target.value)}
              placeholder="model-name"
            />
            {availableModels.length > 0 && (
              <Select
                value={availableModels.includes(aiProviderModel) ? aiProviderModel : undefined}
                onValueChange={setAiProviderModel}
                disabled={loadingModels}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an available model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {availableModels.length === 0
                ? "Test connection to load available models"
                : `${availableModels.length} model(s) available`}
            </p>
          </div>

          <Button
            type="button"
            onClick={handleTestAiProviderConnection}
            disabled={testingAiProvider || saving}
            variant="outline"
            className="w-full"
          >
            {testingAiProvider ? "Testing..." : "Test Connection"}
          </Button>

          <div className="rounded-lg border p-3 bg-muted/50">
            <p className="text-xs text-muted-foreground">
              <strong>Setup:</strong> Configure an OpenAI-compatible provider URL and model.
              Checklist generation stays disabled until both values are saved.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(pendingBackupAction)}
        onOpenChange={(open) => {
          if (!open) setPendingBackupAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingBackupAction?.action === "restore"
                ? "Restore database backup"
                : "Delete database backup"}
            </DialogTitle>
            <DialogDescription>
              {pendingBackupAction?.action === "restore"
                ? "Restoring replaces the current database contents with the selected backup."
                : "Deleting removes the selected backup file permanently."}
            </DialogDescription>
          </DialogHeader>

          {pendingBackupAction ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm font-medium">
              {pendingBackupAction.fileName}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingBackupAction(null)}
              disabled={restoringBackup || deletingBackup}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!pendingBackupAction) return;
                if (pendingBackupAction.action === "restore") {
                  void restoreBackup(pendingBackupAction.fileName);
                } else {
                  void deleteBackup(pendingBackupAction.fileName);
                }
              }}
              disabled={restoringBackup || deletingBackup}
            >
              {pendingBackupAction?.action === "restore"
                ? restoringBackup
                  ? "Restoring..."
                  : "Restore backup"
                : deletingBackup
                  ? "Deleting..."
                  : "Delete backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(showCancel || activeTab === "ai") ? (
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {showCancel && (
            <Button
              type="button"
              onClick={() => onCancel?.()}
              disabled={saving}
              variant="secondary"
            >
              Cancel
            </Button>
          )}
          {activeTab === "ai" ? (
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
