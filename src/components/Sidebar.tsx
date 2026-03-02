"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, LogOut, PanelLeftClose, PanelLeftOpen, Rocket, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserAvatar, getUserAvatarColor } from "@/components/UserAvatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "projectManager.sidebarMode";

type SidebarMode = "compact" | "normal";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Clock3;
}

interface AppUser {
  id: number;
  name: string;
  email?: string | null;
}

interface AppProject {
  id: number;
  name: string;
  member_user_ids?: number[];
}

const getProjectInitials = (name?: string): string => {
  if (!name) return "?";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Time Tracking",
    href: "/",
    icon: Clock3,
  },
  {
    label: "Release Planner",
    href: "/release-planner",
    icon: Rocket,
  },
  {
    label: "Day-Offs Calendar",
    href: "/day-offs",
    icon: CalendarDays,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mode, setMode] = useState<SidebarMode>("compact");
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const isAuthRoute = pathname === "/login" || pathname === "/invite";

  const getCookieValue = (key: string) => {
    const parts = document.cookie.split(";").map((item) => item.trim());
    const found = parts.find((part) => part.startsWith(`${key}=`));
    return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === "compact" || stored === "normal") {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (isAuthRoute) return;

    const loadSessionAndProjects = async () => {
      try {
        const [sessionResponse, projectsResponse] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/projects"),
        ]);

        if (sessionResponse.ok) {
          const data = (await sessionResponse.json()) as { user?: AppUser };
          setCurrentUser(data.user ?? null);
        }

        if (projectsResponse.ok) {
          const projectData = (await projectsResponse.json()) as AppProject[];
          setProjects(projectData);
          const cookieProjectId = getCookieValue("pm_project_id");
          const defaultProjectId = projectData[0] ? String(projectData[0].id) : "";
          const selectedId = projectData.some((project) => String(project.id) === cookieProjectId)
            ? cookieProjectId
            : defaultProjectId;
          setActiveProjectId(selectedId);
        }
      } catch (error) {
        console.error("Failed to load sidebar context:", error);
      }
    };

    loadSessionAndProjects();
  }, [isAuthRoute]);

  const isCompact = mode === "compact";
  const activeProject =
    projects.find((project) => String(project.id) === activeProjectId) ?? null;

  const navItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        ...item,
        active: pathname === item.href,
      })),
    [pathname]
  );

  const toggleMode = () => {
    setMode((prev) => (prev === "compact" ? "normal" : "compact"));
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const handleProjectChange = (value: string) => {
    setActiveProjectId(value);
    document.cookie = `pm_project_id=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  if (isAuthRoute) {
    return null;
  }

  return (
    <aside
      className={cn(
        "flex h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "shrink-0 transition-[width] duration-200 ease-out",
        isCompact ? "w-16" : "w-56"
      )}
    >
      <div className={cn("space-y-3", isCompact ? "px-2 py-4" : "px-3 py-4")}>
        <div className={cn("flex items-center", isCompact ? "justify-center" : "px-1")}>
          <div
            className={cn(
              "rounded-md bg-sidebar-primary text-sidebar-primary-foreground",
              "flex items-center justify-center font-semibold",
              isCompact ? "h-8 w-8 text-sm" : "h-8 w-8"
            )}
          >
            PM
          </div>
          {!isCompact && (
            <span className="ml-3 text-sm font-semibold tracking-tight">
              Project Manager
            </span>
          )}
        </div>

        {projects.length > 0 && (
          <Select value={activeProjectId} onValueChange={handleProjectChange}>
            <SelectTrigger
              className={cn(
                "h-9 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent",
                isCompact
                  ? "w-9 justify-center p-0 mx-auto border-0 shadow-none bg-transparent hover:bg-transparent [&>svg]:hidden"
                  : "w-full justify-between px-2"
              )}
              aria-label="Select project"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: getUserAvatarColor(activeProject?.name) }}
                  title={activeProject?.name || "Project"}
                >
                  {getProjectInitials(activeProject?.name)}
                </div>
                {!isCompact && (
                  <span className="truncate text-sm">
                    {activeProject?.name || "Select project"}
                  </span>
                )}
              </div>
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  <div className="flex items-center gap-2">
                    <div
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                      style={{ backgroundColor: getUserAvatarColor(project.name) }}
                    >
                      {getProjectInitials(project.name)}
                    </div>
                    <span>{project.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.href}
              asChild
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 px-3",
                "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                item.active && "bg-sidebar-accent text-sidebar-accent-foreground",
                isCompact && "justify-center px-0"
              )}
            >
              <Link href={item.href} title={isCompact ? item.label : undefined}>
                <Icon className="h-4 w-4" />
                <span className={cn("text-sm", isCompact && "sr-only")}>{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </nav>

      <div className="p-2 space-y-2">
        <div className="space-y-2 px-1">
          {isCompact ? (
            <div className="flex justify-center">
              <UserAvatar name={currentUser?.name} className="h-8 w-8 text-[11px]" />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2">
              <UserAvatar name={currentUser?.name} className="h-7 w-7 text-[10px]" />
              <p className="text-sm font-medium truncate">
                {currentUser?.name || "No user selected"}
              </p>
            </div>
          )}
        </div>
        <Button
          asChild
          variant="ghost"
          className={cn(
            "w-full justify-start gap-3 px-3",
            "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            pathname === "/settings" && "bg-sidebar-accent text-sidebar-accent-foreground",
            isCompact && "justify-center px-0"
          )}
        >
          <Link href="/settings" title={isCompact ? "Settings" : undefined}>
            <Settings className="h-4 w-4" />
            <span className={cn("text-sm", isCompact && "sr-only")}>Settings</span>
          </Link>
        </Button>
        <ThemeToggle isCompact={isCompact} align="start" />
        <Button
          type="button"
          variant="ghost"
          onClick={handleLogout}
          className={cn(
            "w-full justify-start gap-3 px-3",
            "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isCompact && "justify-center px-0"
          )}
          title={isCompact ? "Log out" : undefined}
        >
          <LogOut className="h-4 w-4" />
          <span className={cn("text-sm", isCompact && "sr-only")}>Log out</span>
        </Button>
        <Button
          variant="ghost"
          onClick={toggleMode}
          className={cn(
            "w-full justify-start gap-3 px-3",
            "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isCompact && "justify-center px-0"
          )}
          title={isCompact ? "Expand sidebar" : "Compact sidebar"}
        >
          {isCompact ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
          <span className={cn("text-sm", isCompact && "sr-only")}>
            {isCompact ? "Expand" : "Compact"}
          </span>
        </Button>
      </div>
    </aside>
  );
}
