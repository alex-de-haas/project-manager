"use client";

import { forwardRef } from "react";
import { LoaderCircle, MoreVertical } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WorkItemActionsButtonProps extends ButtonProps {
  busy: boolean;
  iconClassName?: string;
  hideUntilHover?: boolean;
}

export const WorkItemActionsButton = forwardRef<HTMLButtonElement, WorkItemActionsButtonProps>(
  ({ busy, className, iconClassName = "h-4 w-4", hideUntilHover = true, disabled, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant="ghost"
      size="icon"
      disabled={busy || disabled}
      aria-label={busy ? "Updating work item" : "Work item actions"}
      aria-busy={busy}
      title={busy ? "Updating work item…" : "Actions"}
      className={cn(
        "h-8 w-8 flex-shrink-0 self-center transition-opacity",
        className,
        busy
          ? "opacity-100 disabled:opacity-100 group-hover:opacity-100 text-muted-foreground"
          : hideUntilHover
            ? "opacity-0 group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100"
            : "opacity-70 hover:opacity-100 focus-visible:opacity-100"
      )}
    >
      {busy ? (
        <span role="status">
          <span className="inline-flex animate-spin motion-reduce:animate-none">
            <LoaderCircle className={iconClassName} aria-hidden="true" />
          </span>
          <span className="sr-only">Updating work item</span>
        </span>
      ) : (
        <MoreVertical className={iconClassName} aria-hidden="true" />
      )}
    </Button>
  )
);
WorkItemActionsButton.displayName = "WorkItemActionsButton";
