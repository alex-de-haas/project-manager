"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  Clock3,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserAvatar, getUserAvatarColor } from "@/components/UserAvatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "projectManager.sidebarMode";
const PROJECT_COOKIE_NAME = "pm_project_id";

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
  is_admin?: number | null;
}

interface AppProject {
  id: number;
  name: string;
  member_user_ids?: number[];
}

interface SidebarProps {
  initialUser?: AppUser | null;
  initialProjects?: AppProject[];
  initialActiveProjectId?: string;
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

export default function Sidebar({
  initialUser = null,
  initialProjects = [],
  initialActiveProjectId = "",
}: SidebarProps) {
  const pathname = usePathname();
  const [mode, setMode] = useState<SidebarMode>("compact");
  const [activeProjectId, setActiveProjectId] = useState<string>(initialActiveProjectId);
  const currentUser = initialUser;
  const projects = initialProjects;

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === "compact" || stored === "normal") {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
  }, [mode]);

  const isCompact = mode === "compact";
  const activeProject =
    projects.find((project) => String(project.id) === activeProjectId) ?? null;

  const navItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        ...item,
        active:
          item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
      })),
    [pathname]
  );

  const toggleMode = () => {
    setMode((prev) => (prev === "compact" ? "normal" : "compact"));
  };

  const handleProjectChange = (value: string) => {
    if (!value || value === activeProjectId) return;

    setActiveProjectId(value);
    document.cookie = `${PROJECT_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <aside
      className={cn(
        "flex h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "shrink-0 transition-[width] duration-200 ease-out",
        isCompact ? "w-[4.5rem]" : "w-64"
      )}
    >
      <div className="flex h-full flex-col">
        <div className={cn(isCompact ? "flex justify-center px-2 py-3" : "px-3 py-3")}>
          {projects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "h-11 w-full rounded-lg text-sidebar-foreground",
                    isCompact
                      ? "h-9 w-9 justify-center border-0 bg-transparent px-0 shadow-none hover:bg-sidebar-accent/60"
                      : "justify-between border border-sidebar-border/70 bg-sidebar-accent/30 px-2 hover:bg-sidebar-accent"
                  )}
                  aria-label="Select project"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                      style={{ backgroundColor: getUserAvatarColor(activeProject?.name) }}
                      title={activeProject?.name || "Project"}
                    >
                      {getProjectInitials(activeProject?.name)}
                    </div>
                    {!isCompact && (
                      <div className="min-w-0 text-left">
                        <p className="text-[10px] uppercase tracking-wide text-sidebar-foreground/60">Project</p>
                        <p className="truncate text-sm font-medium leading-tight">
                          {activeProject?.name || "Select project"}
                        </p>
                      </div>
                    )}
                  </div>
                  {!isCompact && <ChevronsUpDown className="h-4 w-4 text-sidebar-foreground/70" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side={isCompact ? "right" : "bottom"}
                sideOffset={8}
                className="w-64"
              >
                <DropdownMenuLabel>Projects</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {projects.map((project) => {
                  const projectId = String(project.id);
                  const isActive = projectId === activeProjectId;

                  return (
                    <DropdownMenuItem
                      key={project.id}
                      onSelect={(event) => {
                        event.preventDefault();
                        handleProjectChange(projectId);
                      }}
                      className="gap-2"
                    >
                      <div
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold text-white"
                        style={{ backgroundColor: getUserAvatarColor(project.name) }}
                      >
                        {getProjectInitials(project.name)}
                      </div>
                      <span className="flex-1 truncate">{project.name}</span>
                      <Check className={cn("h-4 w-4", isActive ? "opacity-100" : "opacity-0")} />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {!isCompact && (
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/55">
              Platform
            </p>
          )}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.href}
                  asChild
                  variant="ghost"
                  className={cn(
                    "h-9 w-full rounded-md justify-start gap-3 px-3",
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
        </div>

        <footer className={cn("border-t border-sidebar-border/70", isCompact ? "px-2 py-3" : "px-3 py-3")}>
          {!isCompact && (
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/55">
              Workspace
            </p>
          )}

          <div className="space-y-1">
            {isCompact ? (
              <div className="flex justify-center pb-1">
                <UserAvatar name={currentUser?.name} className="h-8 w-8 text-[11px]" />
              </div>
            ) : (
              <div className="mx-1 mb-1 flex items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-accent/20 px-2 py-2">
                <UserAvatar name={currentUser?.name} className="h-7 w-7 text-[10px]" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{currentUser?.name || "No user selected"}</p>
                  <p className="truncate text-xs text-sidebar-foreground/65">
                    {currentUser?.email || "Current workspace"}
                  </p>
                </div>
              </div>
            )}

            {currentUser?.is_admin ? (
              <Button
                asChild
                variant="ghost"
                className={cn(
                  "h-9 w-full justify-start gap-3 rounded-md px-3",
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
            ) : null}

            <Button
              asChild
              variant="ghost"
              className={cn(
                "h-9 w-full justify-start gap-3 rounded-md px-3",
                "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                pathname === "/profile" && "bg-sidebar-accent text-sidebar-accent-foreground",
                isCompact && "justify-center px-0"
              )}
            >
              <Link href="/profile" title={isCompact ? "Profile" : undefined}>
                <UserRound className="h-4 w-4" />
                <span className={cn("text-sm", isCompact && "sr-only")}>Profile</span>
              </Link>
            </Button>

            <ThemeToggle
              isCompact={isCompact}
              align="start"
              className="h-9 rounded-md"
            />

            <Button
              variant="ghost"
              onClick={toggleMode}
              className={cn(
                "h-9 w-full justify-start gap-3 rounded-md px-3",
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
        </footer>
      </div>
    </aside>
  );
}
