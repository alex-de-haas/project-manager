"use client";

import { useCallback } from "react";
import { BookOpen, Bug, ClipboardCheck } from "lucide-react";
import type { AzureDevOpsWorkItem } from "@/types";
import { Badge } from "@/components/ui/badge";
import {
  ExternalWorkItemReference,
  formatExternalWorkItemId,
} from "@/components/ExternalWorkItemReference";
import { cn } from "@/lib/utils";

interface ImportWorkItemListProps {
  items: AzureDevOpsWorkItem[];
  selectedIds: Set<number>;
  allSelected: boolean;
  someSelected: boolean;
  importing: boolean;
  showExternalReference: boolean;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  selectAllDisabled?: boolean;
  isItemDisabled?: (item: AzureDevOpsWorkItem) => boolean;
}

const normalizeType = (type: string | null | undefined) =>
  type ? type.trim().toLowerCase().replace(/\s+/g, "_") : "";

const getTypeVisual = (type: string | null | undefined) => {
  const normalizedType = normalizeType(type);

  if (normalizedType === "bug") {
    return {
      title: "Bug",
      icon: <Bug className="h-4 w-4 text-red-600 dark:text-red-500" />,
    };
  }

  if (normalizedType === "user_story" || normalizedType === "userstory") {
    return {
      title: "User Story",
      icon: <BookOpen className="h-4 w-4 text-sky-500 dark:text-sky-400" />,
    };
  }

  return {
    title: "Task",
    icon: <ClipboardCheck className="h-4 w-4 text-amber-600 dark:text-amber-500" />,
  };
};

const getStatusBadgeClass = (state: string | null | undefined) => {
  const normalizedState = state?.trim().toLowerCase();

  if (normalizedState === "active") {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400";
  }

  if (normalizedState === "resolved" || normalizedState === "closed") {
    return "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400";
  }

  return "border-border bg-muted text-muted-foreground";
};

const getDisplayReference = (
  item: AzureDevOpsWorkItem,
  showExternalReference: boolean
) => {
  if (showExternalReference && item.externalSource && item.externalId) {
    return (
      <ExternalWorkItemReference
        provider={item.externalSource}
        externalId={item.externalId}
      />
    );
  }

  const localId = formatExternalWorkItemId(item.id);
  return (
    <span
      className="inline-flex h-5 flex-shrink-0 items-center font-mono text-sm leading-none tabular-nums text-muted-foreground"
      title={`Local work item ${localId}`}
      aria-label={`Local work item ${localId}`}
    >
      #{localId}
    </span>
  );
};

export function ImportWorkItemList({
  items,
  selectedIds,
  allSelected,
  someSelected,
  importing,
  showExternalReference,
  onToggleSelect,
  onToggleSelectAll,
  selectAllDisabled,
  isItemDisabled,
}: ImportWorkItemListProps) {
  const setIndeterminate = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) {
        el.indeterminate = someSelected;
      }
    },
    [someSelected]
  );

  return (
    <div className="max-h-[400px] overflow-y-auto rounded-md border">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-muted px-3 py-2">
        <input
          type="checkbox"
          checked={allSelected}
          ref={setIndeterminate}
          onChange={onToggleSelectAll}
          aria-label={
            allSelected
              ? "Deselect all visible work items"
              : "Select all visible work items"
          }
          className="h-4 w-4"
          disabled={importing || selectAllDisabled || items.length === 0}
        />
        <span className="text-xs font-medium uppercase text-muted-foreground">
          Work items
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div role="list">
        {items.map((item) => {
          const disabled = importing || Boolean(isItemDisabled?.(item));
          const selected = selectedIds.has(item.id);
          const typeVisual = getTypeVisual(item.type);
          const tags = item.tags ?? [];
          const itemLabel = item.title || `work item ${item.id}`;
          const selectionLabel = `${selected ? "Deselect" : "Select"} ${itemLabel}`;

          return (
            <div
              key={`${item.externalSource ?? "local"}-${item.id}`}
              role="listitem"
              tabIndex={disabled ? -1 : 0}
              aria-label={selectionLabel}
              className={cn(
                "flex items-start gap-3 border-b px-3 py-3 last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                disabled
                  ? "bg-muted/40 text-muted-foreground"
                  : "cursor-pointer hover:bg-muted/50"
              )}
              onClick={() => {
                if (!disabled) {
                  onToggleSelect(item.id);
                }
              }}
              onKeyDown={(event) => {
                if (disabled || event.target !== event.currentTarget) {
                  return;
                }

                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleSelect(item.id);
                }
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item.id)}
                aria-label={selectionLabel}
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                disabled={disabled}
                onClick={(event) => event.stopPropagation()}
              />
              <span className="mt-0.5 flex-shrink-0" title={typeVisual.title}>
                {typeVisual.icon}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5">
                  {getDisplayReference(item, showExternalReference)}
                  <div className="min-w-0 flex-1 truncate" title={item.title}>
                    {item.title}
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 px-2 text-[10px] font-semibold",
                      getStatusBadgeClass(item.state)
                    )}
                  >
                    {item.state || "New"}
                  </Badge>
                  {item.isImported && (
                    <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                      Already imported
                    </Badge>
                  )}
                  {tags.map((tag) => (
                    <Badge
                      key={`${item.id}-${tag}`}
                      variant="outline"
                      className="h-5 max-w-[11rem] flex-shrink-0 border-border/70 bg-background/80 px-2 text-[10px] text-muted-foreground"
                      title={tag}
                    >
                      <span className="truncate">{tag}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
