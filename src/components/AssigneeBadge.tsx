import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AssigneeBadgeProps {
  name?: string | null;
  email?: string | null;
  fallback?: string;
  className?: string;
}

export function AssigneeBadge({
  name,
  email,
  fallback = "Unassigned",
  className,
}: AssigneeBadgeProps) {
  const displayName = name?.trim() || email?.trim() || fallback;
  const isUnassigned = !name?.trim() && !email?.trim();

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 max-w-[11rem] flex-shrink-0 gap-1 px-2 text-[11px] font-medium",
        isUnassigned
          ? "border-dashed border-border/70 bg-background/60 text-muted-foreground"
          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
        className
      )}
      title={isUnassigned ? fallback : `Assigned to ${displayName}`}
    >
      <UserRound className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{displayName}</span>
    </Badge>
  );
}
