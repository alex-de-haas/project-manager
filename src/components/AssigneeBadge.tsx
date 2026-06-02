import { UserRound, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AssigneeBadgeProps {
  name?: string | null;
  email?: string | null;
  fallback?: string;
  source?: "local" | "external";
  className?: string;
}

export function AssigneeBadge({
  name,
  email,
  fallback = "Unassigned",
  source = "local",
  className,
}: AssigneeBadgeProps) {
  const displayName = name?.trim() || email?.trim() || fallback;
  const isUnassigned = !name?.trim() && !email?.trim();
  const isExternal = source === "external";
  const Icon = isExternal ? UserX : UserRound;

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 max-w-[11rem] flex-shrink-0 gap-1 px-2 text-[11px] font-medium",
        isExternal
          ? "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          : isUnassigned
            ? "border-dashed border-border/70 bg-background/60 text-muted-foreground"
            : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
        className
      )}
      title={
        isExternal
          ? `Assigned in external system to ${displayName}`
          : isUnassigned
            ? fallback
            : `Assigned to ${displayName}`
      }
    >
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{displayName}</span>
    </Badge>
  );
}
