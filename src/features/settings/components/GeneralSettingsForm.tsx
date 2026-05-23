"use client";

import { useEffect, useMemo, useState } from "react";
import type { Release } from "@/types";
import { CheckCircle2, ExternalLink, GripVertical, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  host_role?: string | null;
  name: string;
  email?: string | null;
  is_admin?: number;
  created_at?: string;
}

interface AppProject {
  id: number;
  name: string;
  member_user_ids?: number[];
}

interface ApiError {
  error?: string;
}

interface JsonImportResponse {
  imported?: {
    timeEntries?: number;
    dayOffs?: number;
    tasksCreated?: number;
    tasksMatched?: number;
  };
}

interface SortableReleaseRowProps {
  id: number;
  release: Release;
  onRename: (release: Release) => void;
  onMarkCompleted: (release: Release) => void;
  updatingReleaseId: number | null;
}

function SortableReleaseRow({
  id,
  release,
  onRename,
  onMarkCompleted,
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
      className="flex items-center gap-2 rounded-md border p-2 bg-background"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{release.name}</div>
      </div>
      <Badge variant={release.status === "completed" ? "secondary" : "outline"}>
        {release.status === "completed" ? "Completed" : "Active"}
      </Badge>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRename(release)}
        disabled={updatingReleaseId === release.id}
      >
        Rename
      </Button>
      {release.status !== "completed" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onMarkCompleted(release)}
          disabled={updatingReleaseId === release.id}
        >
          <CheckCircle2 className="h-4 w-4 mr-1" />
          Mark completed
        </Button>
      )}
    </div>
  );
}

export function GeneralSettingsForm({
  onCancel,
  onSaved,
  showCancel = false,
}: GeneralSettingsFormProps) {
  // General settings
  const [defaultDayLength, setDefaultDayLength] = useState("8");
  const [activeTab, setActiveTab] = useState("general");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [activeUserId, setActiveUserId] = useState("");
  const [hostDirectoryStatus, setHostDirectoryStatus] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [updatingUser, setUpdatingUser] = useState(false);
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const [updatingProject, setUpdatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectMemberUserIds, setProjectMemberUserIds] = useState<Set<number>>(new Set());
  const [savingProjectMembers, setSavingProjectMembers] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [releaseName, setReleaseName] = useState("");
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [updatingReleaseId, setUpdatingReleaseId] = useState<number | null>(null);

  // Azure DevOps settings
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [pat, setPat] = useState("");
  const [hasAzurePat, setHasAzurePat] = useState(false);

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
  const [jsonImportFile, setJsonImportFile] = useState<File | null>(null);
  const [importingJson, setImportingJson] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
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

  const azureProjectUrl = useMemo(() => {
    const trimmedOrganization = organization.trim();
    const trimmedProject = project.trim();

    if (!trimmedOrganization || !trimmedProject) {
      return "";
    }

    return `https://dev.azure.com/${encodeURIComponent(trimmedOrganization)}/${encodeURIComponent(trimmedProject)}`;
  }, [organization, project]);

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
      setHostDirectoryStatus(
        usersResponse.headers.get("x-project-manager-host-directory-status") || ""
      );
      setUsers(data);
      if (sessionResponse.ok) {
        const sessionData = (await sessionResponse.json()) as { user?: AppUser };
        setActiveUserId(sessionData.user?.id ? String(sessionData.user.id) : "");
      } else {
        setActiveUserId("");
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
    document.cookie = `pm_project_id=${encodeURIComponent(projectId)}; path=/; max-age=31536000; samesite=lax`;
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
      const selectedId = data.some((project) => String(project.id) === cookieProjectId)
        ? cookieProjectId
        : data[0]
          ? String(data[0].id)
          : "";
      setActiveProjectId(selectedId);
      const selectedProject = data.find((project) => String(project.id) === selectedId);
      setProjectMemberUserIds(new Set(selectedProject?.member_user_ids ?? []));
      if (selectedId && selectedId !== cookieProjectId) {
        setProjectCookie(selectedId);
      }
    } catch (err) {
      setMessage("Failed to load projects.");
      setMessageType("error");
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadProjects();
    loadSettings();
    loadBackups();
    loadReleases();
    // load* functions are intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const selected = projects.find((project) => String(project.id) === activeProjectId);
    if (selected) {
      setProjectMemberUserIds(new Set(selected.member_user_ids ?? []));
    }
  }, [projects, activeProjectId]);

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const response = await fetch("/api/database/backups");
      if (!response.ok) {
        throw new Error("Failed to load backups");
      }

      const data = (await response.json()) as DatabaseBackupFile[];
      setBackups(data);
      setSelectedBackup((currentSelected) => {
        if (currentSelected && data.some((backup) => backup.fileName === currentSelected)) {
          return currentSelected;
        }
        return data[0]?.fileName ?? "";
      });
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
      // Load general settings
      const generalResponse = await fetch(
        "/api/settings?key=default_day_length"
      );
      if (generalResponse.ok) {
        const data = await generalResponse.json();
        if (data.value) {
          setDefaultDayLength(data.value);
        }
      }

      // Load Azure DevOps settings
      const azureResponse = await fetch("/api/settings?key=azure_devops");
      if (azureResponse.ok) {
        const data = await azureResponse.json();
        if (data.value) {
          const settings =
            typeof data.value === "string"
              ? JSON.parse(data.value)
              : data.value;
          setOrganization(settings.organization || "");
          setProject(settings.project || "");
          setHasAzurePat(Boolean(settings.hasPat));
          setPat("");
        }
      }

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

  const handleSetUserAdmin = async (targetUser: AppUser, makeAdmin: boolean) => {
    setUpdatingUser(true);
    try {
      const targetQuery = targetUser.host_user_id
        ? `hostUserId=${encodeURIComponent(targetUser.host_user_id)}`
        : `id=${targetUser.id}`;
      const response = await fetch(`/api/users?${targetQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_admin: makeAdmin,
          hostUserId: targetUser.host_user_id,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        setMessage(data.error || "Failed to update administrator status.");
        setMessageType("error");
        return;
      }

      const updated = (await response.json()) as AppUser;
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
      setMessage(
        makeAdmin
          ? `User "${updated.name}" is now an administrator.`
          : `User "${updated.name}" is no longer an administrator.`
      );
      setMessageType("success");
    } catch {
      setMessage("Failed to update administrator status.");
      setMessageType("error");
    } finally {
      setUpdatingUser(false);
    }
  };

  const handleCreateProject = async () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) {
      setMessage("Project name is required.");
      setMessageType("error");
      return;
    }

    setCreatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError & AppProject;
      if (!response.ok) {
        throw new Error(data.error || "Failed to create project.");
      }

      setNewProjectName("");
      await loadProjects();
      setActiveProjectId(String(data.id));
      setProjectCookie(String(data.id));
      setMessage(`Project "${trimmed}" created.`);
      setMessageType("success");
      window.location.reload();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create project.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setCreatingProject(false);
    }
  };

  const handleRenameProject = async () => {
    const selected = projects.find((project) => String(project.id) === activeProjectId);
    if (!selected) return;

    const nextName = window.prompt("Rename project", selected.name);
    if (!nextName) return;

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === selected.name) return;

    setUpdatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, name: trimmed }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        throw new Error(data.error || "Failed to rename project.");
      }

      await loadProjects();
      setMessage(`Project renamed to "${trimmed}".`);
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to rename project.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setUpdatingProject(false);
    }
  };

  const handleDeleteProject = async () => {
    const selected = projects.find((project) => String(project.id) === activeProjectId);
    if (!selected) return;

    const confirmed = window.confirm(
      `Delete project "${selected.name}"? The project must be empty before deletion.`
    );
    if (!confirmed) return;

    setUpdatingProject(true);
    try {
      const response = await fetch(`/api/projects?id=${selected.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete project.");
      }

      await loadProjects();
      setMessage(`Project "${selected.name}" deleted.`);
      setMessageType("success");
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
    const selectedProject = projects.find((item) => String(item.id) === projectId);
    setProjectMemberUserIds(new Set(selectedProject?.member_user_ids ?? []));
    setProjectCookie(projectId);
    window.location.reload();
  };

  const toggleProjectMember = (userId: number, checked: boolean | "indeterminate") => {
    setProjectMemberUserIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  };

  const handleSaveProjectMembers = async () => {
    const selected = projects.find((project) => String(project.id) === activeProjectId);
    if (!selected) return;

    setSavingProjectMembers(true);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          memberUserIds: Array.from(projectMemberUserIds),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        throw new Error(data.error || "Failed to save project members.");
      }

      await loadProjects();
      setMessage("Project members saved.");
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save project members.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setSavingProjectMembers(false);
    }
  };

  const handleCreateRelease = async () => {
    const trimmed = releaseName.trim();
    if (!trimmed) {
      setMessage("Release name is required.");
      setMessageType("error");
      return;
    }

    setCreatingRelease(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const response = await fetch("/api/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          start_date: today,
          end_date: today,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(data.error || "Failed to create release.");
      }

      setReleaseName("");
      await loadReleases();
      setMessage(`Release "${trimmed}" created.`);
      setMessageType("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create release.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setCreatingRelease(false);
    }
  };

  const handleRenameRelease = async (release: Release) => {
    const nextName = window.prompt("Rename release", release.name);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === release.name) return;

    setUpdatingReleaseId(release.id);
    try {
      const response = await fetch("/api/releases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: release.id, name: trimmed }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(data.error || "Failed to rename release.");
      }

      setReleases((prev) =>
        prev.map((item) => (item.id === release.id ? { ...item, name: trimmed } : item))
      );
      setMessage(`Release renamed to "${trimmed}".`);
      setMessageType("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to rename release.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setUpdatingReleaseId(null);
    }
  };

  const handleMarkReleaseCompleted = async (release: Release) => {
    if (release.status === "completed") return;

    setUpdatingReleaseId(release.id);
    try {
      const response = await fetch("/api/releases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: release.id, status: "completed" }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(data.error || "Failed to mark release as completed.");
      }

      setReleases((prev) =>
        prev.map((item) =>
          item.id === release.id ? { ...item, status: "completed" } : item
        )
      );
      setMessage(`Release "${release.name}" marked as completed.`);
      setMessageType("success");
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to mark release as completed.";
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

  const handleTestAzureConnection = async () => {
    if (!organization || !project || (!pat && !hasAzurePat)) {
      setMessage("Please fill in Azure DevOps organization, project, and personal PAT before testing");
      setMessageType("error");
      return;
    }

    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/azure-devops/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization, project, pat }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(
          `Success: Connection successful. Found project: ${data.project.name}`
        );
        setMessageType("success");
      } else {
        setMessage(`Error: Connection failed: ${data.error || "Unknown error"}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage("Error: Connection failed: Network error");
      setMessageType("error");
    } finally {
      setTesting(false);
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

    // Validate default day length
    const dayLengthNum = parseFloat(defaultDayLength);
    if (isNaN(dayLengthNum) || dayLengthNum <= 0 || dayLengthNum > 24) {
      setMessage("Default day length must be between 0 and 24 hours");
      setMessageType("error");
      return;
    }

    const hasAnyAzureInput =
      organization.trim().length > 0 ||
      project.trim().length > 0 ||
      pat.trim().length > 0 ||
      hasAzurePat;
    if (hasAnyAzureInput && (!organization.trim() || !project.trim())) {
      setMessage("Azure DevOps organization and project are required when Azure DevOps is configured.");
      setMessageType("error");
      return;
    }

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
      // Save general settings
      const generalResponse = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "default_day_length",
          value: defaultDayLength,
        }),
      });

      if (!generalResponse.ok) {
        throw new Error("Failed to save general settings");
      }

      if (hasAnyAzureInput) {
        // Save Azure DevOps settings
        const azureResponse = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "azure_devops",
            value: { organization, project, pat },
          }),
        });

        if (!azureResponse.ok) {
          throw new Error("Failed to save Azure DevOps settings");
        }
        const azureData = await azureResponse.json().catch(() => null);
        if (azureData?.value) {
          setHasAzurePat(Boolean(azureData.value.hasPat));
          setPat("");
        }
      }

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
      setSelectedBackup(data.fileName);
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

  const handleRestoreBackup = async () => {
    if (!selectedBackup) {
      setMessage("Please select a backup file to restore.");
      setMessageType("error");
      return;
    }

    const confirmed = window.confirm(
      `Restore database from ${selectedBackup}? This will replace current data in this database.`
    );

    if (!confirmed) {
      return;
    }

    setRestoringBackup(true);
    setMessage("");

    try {
      const response = await fetch("/api/database/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: selectedBackup }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to restore backup");
      }

      setMessage(`Database restored from ${selectedBackup}. Refresh to see updated data.`);
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to restore database backup.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleDeleteBackup = async () => {
    if (!selectedBackup) {
      setMessage("Please select a backup file to delete.");
      setMessageType("error");
      return;
    }

    const confirmed = window.confirm(
      `Delete backup ${selectedBackup}? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingBackup(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/database/backups?fileName=${encodeURIComponent(selectedBackup)}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete backup");
      }

      const deletedFile = selectedBackup;
      await loadBackups();
      setMessage(`Backup deleted: ${deletedFile}`);
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete database backup.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setDeletingBackup(false);
    }
  };

  const handleImportJson = async () => {
    if (!jsonImportFile) {
      setMessage("Please select a JSON import file.");
      setMessageType("error");
      return;
    }

    setImportingJson(true);
    setMessage("");

    try {
      const parsed = JSON.parse(await jsonImportFile.text());
      const response = await fetch("/api/json-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError & JsonImportResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to import JSON data.");
      }

      const imported = data.imported ?? {};
      setMessage(
        `JSON import completed: ${imported.timeEntries ?? 0} time entries, ${
          imported.dayOffs ?? 0
        } day-offs, ${imported.tasksCreated ?? 0} tasks created, ${
          imported.tasksMatched ?? 0
        } tasks matched.`
      );
      setMessageType("success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to import JSON data.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setImportingJson(false);
    }
  };

  const handleDeleteAzurePat = async () => {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/settings?key=azure_devops&credential=pat", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to remove Azure DevOps PAT.");
      }

      setPat("");
      setHasAzurePat(false);
      setMessage("Azure DevOps personal PAT removed.");
      setMessageType("success");
    } catch {
      setMessage("Failed to remove Azure DevOps PAT.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  return loading ? (
    <div className="text-center py-8">Loading settings...</div>
  ) : (
    <form onSubmit={handleSave}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
          <TabsTrigger value="users">Module Roles</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="azure">Azure DevOps</TabsTrigger>
          <TabsTrigger value="ai">AI Provider</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar
                name={users.find((user) => String(user.id) === activeUserId)?.name}
                className="h-8 w-8 text-xs"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {users.find((user) => String(user.id) === activeUserId)?.name || "No user selected"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {users.find((user) => String(user.id) === activeUserId)?.email || "No email"}
                </p>
                {users.find((user) => String(user.id) === activeUserId)?.is_admin ? (
                  <p className="text-xs text-muted-foreground">Administrator</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled>
                Managed by Docker Host
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assigned Docker Host Users</Label>
            <p className="text-xs text-muted-foreground">
              {hostDirectoryStatus === "ok"
                ? "Users assigned to this module in Docker Host are available for module roles and project assignment."
                : "Docker Host scoped directory is not available; showing users already known to this module."}
            </p>
            <div className="space-y-2 rounded-md border p-3">
              {loadingUsers ? (
                <p className="text-sm text-muted-foreground">Loading users...</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Assigned Host users appear here after Docker Host directory sync or after they open the module.
                </p>
              ) : (
                users.map((user) => {
                  const createdAt = user.created_at
                    ? new Date(user.created_at).toLocaleString()
                    : "Unknown";
                  return (
                    <div
                      key={`user-row-${user.host_user_id ?? user.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background p-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{user.name}</p>
                          {user.is_admin ? (
                            <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                              Administrator
                            </Badge>
                          ) : null}
                          {user.host_role === "host.admin" ? (
                            <Badge variant="outline" className="h-5 px-2 text-[10px]">
                              Host admin
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.email || "No email"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <p className="text-xs text-muted-foreground">Created: {createdAt}</p>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Actions for ${user.name}`}
                              disabled={updatingUser}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => void handleSetUserAdmin(user, !Boolean(user.is_admin))}
                              disabled={updatingUser}
                            >
                              {user.is_admin ? "Remove administrator" : "Mark as administrator"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="general" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="defaultDayLength">Default Day Length (hours)</Label>
            <Input
              id="defaultDayLength"
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              value={defaultDayLength}
              onChange={(e) => setDefaultDayLength(e.target.value)}
              placeholder="8"
              required
            />
            <p className="text-xs text-muted-foreground">
              Set the default number of hours in a working day (used for
              calculations)
            </p>
          </div>
        </TabsContent>

        <TabsContent value="projects" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="activeProject">Active Project</Label>
            <Select
              value={activeProjectId}
              onValueChange={handleSwitchProject}
              disabled={loadingProjects || projects.length === 0 || updatingProject || creatingProject}
            >
              <SelectTrigger id="activeProject">
                <SelectValue placeholder={loadingProjects ? "Loading projects..." : "Select project"} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Switching project refreshes the app and scopes time tracking, release planner, and DevOps settings.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newProjectName">Create Project</Label>
            <div className="flex gap-2">
              <Input
                id="newProjectName"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="e.g., Mobile App"
              />
              <Button
                type="button"
                onClick={handleCreateProject}
                disabled={creatingProject || updatingProject}
              >
                {creatingProject ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleRenameProject}
              disabled={!activeProjectId || updatingProject || creatingProject}
            >
              Rename project
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteProject}
              disabled={!activeProjectId || projects.length <= 1 || updatingProject || creatingProject}
            >
              Delete project
            </Button>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <Label>Assigned Users</Label>
            <p className="text-xs text-muted-foreground">
              Assigned users can access this project&apos;s Release Planner and Azure DevOps settings.
            </p>
            {loadingUsers ? (
              <p className="text-sm text-muted-foreground">Loading users...</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users available.</p>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <label
                    key={`project-member-${user.id}`}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                  >
                    <Checkbox
                      checked={projectMemberUserIds.has(user.id)}
                      onCheckedChange={(checked) => toggleProjectMember(user.id, checked)}
                      disabled={!activeProjectId || updatingProject || savingProjectMembers}
                    />
                    <span className="text-sm">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.email || "No email"}</span>
                  </label>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleSaveProjectMembers}
              disabled={!activeProjectId || loadingUsers || savingProjectMembers || updatingProject}
            >
              {savingProjectMembers ? "Saving..." : "Save assignments"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="releases" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="releaseName">Create Release</Label>
            <div className="flex gap-2">
              <Input
                id="releaseName"
                value={releaseName}
                onChange={(event) => setReleaseName(event.target.value)}
                placeholder="e.g., Q2 Launch"
              />
              <Button
                type="button"
                onClick={handleCreateRelease}
                disabled={creatingRelease}
              >
                {creatingRelease ? "Creating..." : "Create release"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              New releases default to today for start/end dates. Reorder releases by dragging rows.
            </p>
          </div>

          {loadingReleases ? (
            <div className="text-sm text-muted-foreground">Loading releases...</div>
          ) : sortedReleases.length === 0 ? (
            <div className="text-sm text-muted-foreground">No releases yet.</div>
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
                      onRename={handleRenameRelease}
                      onMarkCompleted={handleMarkReleaseCompleted}
                      updatingReleaseId={updatingReleaseId}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </TabsContent>

        <TabsContent value="database" className="space-y-4 mt-4">
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="jsonImportFile">JSON Data Import</Label>
              <p className="text-xs text-muted-foreground">
                Import a Project Manager migration JSON file into the current Host user and active project.
              </p>
            </div>

            <div className="space-y-2">
              <Input
                id="jsonImportFile"
                type="file"
                accept="application/json,.json"
                onChange={(event) => setJsonImportFile(event.target.files?.[0] ?? null)}
                disabled={importingJson || saving}
              />
              <p className="text-xs text-muted-foreground">
                Time entries are matched by Azure DevOps work item ID. Missing work items are created as local Azure DevOps-linked tasks.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleImportJson}
              disabled={!jsonImportFile || importingJson || saving}
            >
              {importingJson ? "Importing..." : "Import JSON"}
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="databaseBackupSelect">Database Backups</Label>
              <p className="text-xs text-muted-foreground">
                Create separate snapshot files and restore from them when needed.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCreateBackup}
                disabled={creatingBackup || deletingBackup || saving || restoringBackup}
              >
                {creatingBackup ? "Creating Backup..." : "Create Backup"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={loadBackups}
                disabled={loadingBackups || creatingBackup || deletingBackup || restoringBackup || saving}
              >
                {loadingBackups ? "Refreshing..." : "Refresh Backups"}
              </Button>
            </div>

            <div className="space-y-2">
              <Select
                value={selectedBackup}
                onValueChange={setSelectedBackup}
                disabled={loadingBackups || backups.length === 0 || creatingBackup || deletingBackup || restoringBackup}
              >
                <SelectTrigger id="databaseBackupSelect">
                  <SelectValue placeholder={loadingBackups ? "Loading backups..." : "Select backup file"} />
                </SelectTrigger>
                <SelectContent>
                  {backups.map((backup) => (
                    <SelectItem key={backup.fileName} value={backup.fileName}>
                      {backup.fileName} ({formatBackupSize(backup.sizeBytes)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {backups.length === 0
                  ? "No backup files found."
                  : `Latest backup: ${new Date(backups[0].createdAt).toLocaleString()}`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteBackup}
                disabled={!selectedBackup || deletingBackup || restoringBackup || creatingBackup || saving}
              >
                {deletingBackup ? "Deleting..." : "Delete Selected Backup"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleRestoreBackup}
                disabled={!selectedBackup || restoringBackup || deletingBackup || creatingBackup || saving}
              >
                {restoringBackup ? "Restoring..." : "Restore Selected Backup"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="azure" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="organization">Organization</Label>
            <Input
              id="organization"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="e.g., mycompany"
            />
            <p className="text-xs text-muted-foreground">
              From: https://dev.azure.com/[organization]
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project">Project</Label>
            <Input
              id="project"
              type="text"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="e.g., MyProject"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pat">Personal Access Token (PAT)</Label>
            <Input
              id="pat"
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder={hasAzurePat ? "Personal PAT saved" : "Enter your Azure DevOps PAT"}
            />
            <p className="text-xs text-muted-foreground">
              {hasAzurePat
                ? "Leave blank to keep the saved personal PAT."
                : "Create a PAT at: User Settings -> Personal access tokens -> New Token."}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={handleTestAzureConnection}
              disabled={testing || saving}
              variant="outline"
              className="flex-1 border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {azureProjectUrl ? (
              <Button asChild variant="outline" className="flex-1">
                <a href={azureProjectUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open Project
                </a>
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled className="flex-1">
                <ExternalLink className="h-4 w-4" />
                Open Project
              </Button>
            )}
            <Button
              type="button"
              onClick={handleDeleteAzurePat}
              disabled={!hasAzurePat || saving}
              variant="outline"
              className="flex-1"
            >
              Remove PAT
            </Button>
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

      {message && (
        <Alert
          variant={messageType === "success" ? "default" : "destructive"}
          className={
            messageType === "success"
              ? "mt-4 border-green-300 bg-green-50 text-green-950 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100"
              : "mt-4"
          }
        >
          <AlertDescription>
            {message}
          </AlertDescription>
        </Alert>
      )}

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
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </form>
  );
}
