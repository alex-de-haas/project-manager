"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  Clock3,
  Menu,
  Rocket,
  Settings,
  Star,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { getUserAvatarColor } from "@/components/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PROJECT_COOKIE_NAME = "pm_project_id";
const PROJECT_USER_COOKIE_NAME = "pm_project_user_id";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Clock3;
  adminOnly?: boolean;
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

interface TopNavigationProps {
  initialUser?: AppUser | null;
  initialProjects?: AppProject[];
  initialActiveProjectId?: string;
  initialDefaultProjectId?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Time Management",
    href: "/",
    icon: Clock3,
  },
  {
    label: "Planning",
    href: "/release-planner",
    icon: Rocket,
  },
  {
    label: "Calendar",
    href: "/day-offs",
    icon: CalendarDays,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

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

export default function TopNavigation({
  initialUser = null,
  initialProjects = [],
  initialActiveProjectId = "",
  initialDefaultProjectId = "",
}: TopNavigationProps) {
  const pathname = usePathname();
  const [activeProjectId, setActiveProjectId] = useState<string>(initialActiveProjectId);
  const [defaultProjectId, setDefaultProjectId] = useState<string>(initialDefaultProjectId);
  const currentUser = initialUser;
  const projects = initialProjects;
  const isAdmin = Boolean(currentUser?.is_admin);

  const activeProject =
    projects.find((project) => String(project.id) === activeProjectId) ?? null;

  const navItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => ({
        ...item,
        active:
          item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
      })),
    [isAdmin, pathname]
  );

  const writeProjectCookies = (projectId: string) => {
    if (!currentUser?.id || !projectId) {
      document.cookie = `${PROJECT_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
      document.cookie = `${PROJECT_USER_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
      return;
    }

    document.cookie = `${PROJECT_COOKIE_NAME}=${encodeURIComponent(projectId)}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = `${PROJECT_USER_COOKIE_NAME}=${encodeURIComponent(String(currentUser.id))}; path=/; max-age=31536000; samesite=lax`;
  };

  const handleProjectChange = (value: string) => {
    if (!value || value === activeProjectId) return;

    setActiveProjectId(value);
    writeProjectCookies(value);
    window.location.reload();
  };

  useEffect(() => {
    writeProjectCookies(activeProjectId);
    // Keep the server-side project cookie owner in sync with the rendered host user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, currentUser?.id]);

  const handleSetDefaultProject = async (projectId: string) => {
    if (!projectId) return;

    try {
      const response = await fetch("/api/projects/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: Number(projectId) }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to set default project");
      }

      setDefaultProjectId(projectId);
      toast.success("Default project updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to set default project");
    }
  };

  const renderProjectSelector = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={projects.length === 0}>
        <Button
          variant="ghost"
          className="h-9 min-w-0 max-w-full justify-between gap-2 rounded-md px-2 text-foreground shadow-none hover:bg-muted sm:max-w-[18rem]"
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
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-medium leading-tight">
                {activeProject?.name || "No project"}
              </p>
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        {projects.map((project) => {
          const projectId = String(project.id);
          const isActive = projectId === activeProjectId;
          const isDefault = projectId === defaultProjectId;

          return (
            <DropdownMenuItem
              key={project.id}
              onSelect={(event) => {
                if (isActive) return;
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
              {isDefault ? (
                <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
              ) : null}
              <Check className={cn("h-4 w-4", isActive ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          );
        })}
        {projects.length === 0 ? (
          <DropdownMenuItem disabled>No projects available</DropdownMenuItem>
        ) : null}
        {projects.length > 0 && activeProjectId !== defaultProjectId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!activeProjectId}
              onSelect={() => void handleSetDefaultProject(activeProjectId)}
              className="gap-2"
            >
              <Star className="h-4 w-4" />
              <span>Set current as default</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderNavLink = (item: NavItem & { active: boolean }, mobile = false) => {
    const Icon = item.icon;

    if (mobile) {
      return (
        <DropdownMenuItem key={item.href} asChild className="gap-2">
          <Link href={item.href}>
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
            {item.active ? <Check className="ml-auto h-4 w-4" /> : null}
          </Link>
        </DropdownMenuItem>
      );
    }

    return (
      <Link
        key={item.href}
        className={cn(
          "inline-flex h-8 items-center rounded-md px-3 text-sm text-foreground transition-colors hover:bg-muted",
          item.active && "bg-muted font-medium"
        )}
        href={item.href}
        aria-label={item.label}
        aria-current={item.active ? "page" : undefined}
      >
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <header className="shrink-0 bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="rounded-lg border bg-card p-1 shadow-sm">
          <div className="flex min-w-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-md text-foreground hover:bg-muted md:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8} className="w-56">
                <DropdownMenuLabel>Navigation</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {navItems.map((item) => renderNavLink(item, true))}
              </DropdownMenuContent>
            </DropdownMenu>

            <nav
              aria-label="Main navigation"
              className="hidden min-w-0 flex-1 items-center gap-1 md:flex"
            >
              {navItems.map((item) => renderNavLink(item))}
            </nav>

            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end border-l pl-1 md:flex-none md:shrink">
              {renderProjectSelector()}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
