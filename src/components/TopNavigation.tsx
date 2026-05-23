"use client";

import { useMemo, useState } from "react";
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
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserAvatar, getUserAvatarColor } from "@/components/UserAvatar";
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
    adminOnly: true,
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
}: TopNavigationProps) {
  const pathname = usePathname();
  const [activeProjectId, setActiveProjectId] = useState<string>(initialActiveProjectId);
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

  const handleProjectChange = (value: string) => {
    if (!value || value === activeProjectId) return;

    setActiveProjectId(value);
    document.cookie = `${PROJECT_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
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
      <DropdownMenuContent align="start" sideOffset={8} className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {projects.map((project) => {
          const projectId = String(project.id);
          const isActive = projectId === activeProjectId;

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
              <Check className={cn("h-4 w-4", isActive ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          );
        })}
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

            <div className="min-w-0 flex-1 md:hidden">{renderProjectSelector()}</div>

            <div className="ml-auto hidden min-w-0 shrink items-center border-l pl-1 sm:flex">
              {renderProjectSelector()}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 gap-2 rounded-md px-2 text-foreground hover:bg-muted"
                  aria-label="Open user menu"
                >
                  <UserAvatar name={currentUser?.name} className="h-6 w-6 text-[10px]" />
                  <span className="hidden max-w-36 truncate text-sm font-medium xl:inline">
                    {currentUser?.name || "Current user"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-64">
                <DropdownMenuLabel>
                  <span className="block truncate">{currentUser?.name || "Current user"}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {currentUser?.email || "Docker Host user"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="gap-2">
                  <Link href="/profile">
                    <UserRound className="h-4 w-4" />
                    <span>Profile</span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
