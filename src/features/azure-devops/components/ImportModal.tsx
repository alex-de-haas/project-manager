"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AzureDevOpsWorkItem } from "@/types";
import {
  DEFAULT_IMPORT_STATUS_FILTERS,
  IMPORT_STATUS_FILTER_OPTIONS,
  type ImportStatusFilter,
} from "@/lib/import-filters";

const formatImportSummary = (imported: number, skipped: number) => {
  const importedLabel = imported === 1 ? "work item" : "work items";
  const skippedLabel = skipped === 1 ? "work item" : "work items";

  return [
    `Imported ${imported} ${importedLabel}`,
    skipped > 0 ? `skipped ${skipped} existing ${skippedLabel}` : null,
  ]
    .filter(Boolean)
    .join(", ");
};

type ImportSource = "external" | "backlog";

const sourceLabels: Record<ImportSource, string> = {
  external: "Azure DevOps",
  backlog: "Backlog",
};

const parseAzureDevOpsSettings = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  return value;
};

interface ImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportModal({ onClose, onSuccess }: ImportModalProps) {
  const [workItemsBySource, setWorkItemsBySource] = useState<
    Record<ImportSource, AzureDevOpsWorkItem[]>
  >({
    external: [],
    backlog: [],
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loadingBySource, setLoadingBySource] = useState<Record<ImportSource, boolean>>({
    external: false,
    backlog: true,
  });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [externalAvailable, setExternalAvailable] = useState(false);
  const [activeTab, setActiveTab] = useState<ImportSource>("backlog");
  const [importing, setImporting] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<
    Set<ImportStatusFilter>
  >(() => new Set(DEFAULT_IMPORT_STATUS_FILTERS));

  const selectedStatusList = useMemo(
    () => IMPORT_STATUS_FILTER_OPTIONS.filter((status) => selectedStatuses.has(status)),
    [selectedStatuses]
  );
  const statusParam = selectedStatusList.join(",");
  const isStatusFilterActive = selectedStatusList.length !== 2 ||
    !selectedStatuses.has("New") ||
    !selectedStatuses.has("Active");
  const statusFilterLabel = isStatusFilterActive
    ? "Import status filter active"
    : "Import status filter";
  const activeWorkItems = workItemsBySource[activeTab];
  const loading = loadingBySource[activeTab] || settingsLoading;

  const fetchWorkItems = useCallback(async (
    source: ImportSource,
    searchTerm: string,
    statuses: string,
    signal?: AbortSignal
  ) => {
    try {
      setLoadingBySource((current) => ({ ...current, [source]: true }));
      const params = new URLSearchParams();
      params.set("statuses", statuses);
      if (searchTerm.trim()) {
        params.set("search", searchTerm.trim());
      }
      const endpoint =
        source === "external"
          ? "/api/azure-devops/work-items"
          : "/api/tasks/backlog";
      const response = await fetch(`${endpoint}?${params.toString()}`, { signal });
      const data = await response.json();

      if (response.ok) {
        setWorkItemsBySource((current) => ({
          ...current,
          [source]: data.workItems || [],
        }));
        setSelectedIds(new Set());
      } else {
        toast.error(
          `Failed to fetch ${sourceLabels[source]} work items: ${
            data.error || "Unknown error"
          }`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      toast.error(`Failed to fetch ${sourceLabels[source]} work items: Network error`);
    } finally {
      if (!signal?.aborted) {
        setLoadingBySource((current) => ({ ...current, [source]: false }));
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchExternalSettings = async () => {
      try {
        const response = await fetch("/api/settings?key=azure_devops");
        if (!response.ok) {
          if (!cancelled) {
            setExternalAvailable(false);
            setActiveTab("backlog");
          }
          return;
        }

        const data = await response.json();
        const settings = parseAzureDevOpsSettings(data.value) as
          | { organization?: unknown; project?: unknown; hasPat?: unknown }
          | null;
        const hasExternalSource = Boolean(
          settings?.organization && settings?.project && settings?.hasPat
        );
        if (!cancelled) {
          setExternalAvailable(hasExternalSource);
          setActiveTab(hasExternalSource ? "external" : "backlog");
        }
      } catch {
        if (!cancelled) {
          setExternalAvailable(false);
          setActiveTab("backlog");
        }
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    };

    void fetchExternalSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (settingsLoading) return;
    if (activeTab === "external" && !externalAvailable) return;

    const controller = new AbortController();
    void fetchWorkItems(activeTab, appliedFilter, statusParam, controller.signal);

    return () => {
      controller.abort();
    };
  }, [
    activeTab,
    appliedFilter,
    externalAvailable,
    fetchWorkItems,
    settingsLoading,
    statusParam,
  ]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const filteredWorkItemIds = useMemo(
    () => activeWorkItems.map((item) => item.id),
    [activeWorkItems]
  );

  const handleSearch = () => {
    setAppliedFilter(filterText.trim());
  };

  const toggleStatus = (status: ImportStatusFilter) => {
    setSelectedStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const allVisibleSelected =
        filteredWorkItemIds.length > 0 &&
        filteredWorkItemIds.every((id) => current.has(id));
      const next = new Set(current);

      if (allVisibleSelected) {
        filteredWorkItemIds.forEach((id) => next.delete(id));
      } else {
        filteredWorkItemIds.forEach((id) => next.add(id));
      }

      return next;
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) {
      toast.error("Please select at least one work item to import");
      return;
    }

    setImporting(true);

    try {
      const endpoint =
        activeTab === "external" ? "/api/azure-devops/import" : "/api/tasks/backlog";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workItemIds: Array.from(selectedIds) }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(formatImportSummary(data.imported ?? 0, data.skipped ?? 0));
        onSuccess();
      } else {
        toast.error(`Import failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      toast.error("Import failed: Network error");
    } finally {
      setImporting(false);
    }
  };

  const selectedVisibleCount = filteredWorkItemIds.filter((id) =>
    selectedIds.has(id)
  ).length;
  const allSelected =
    filteredWorkItemIds.length > 0 &&
    selectedVisibleCount === filteredWorkItemIds.length;
  const someSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < filteredWorkItemIds.length;
  const emptyMessage =
    selectedStatusList.length === 0
      ? "Select at least one status"
      : activeWorkItems.length === 0 && appliedFilter
        ? `No ${sourceLabels[activeTab]} work items match your filters`
        : `No ${sourceLabels[activeTab]} work items available to import`;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Import Work Items</DialogTitle>
          <DialogDescription>
            Select tasks and bugs to add to Time Management.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleSearch();
            }}
          >
            <Label htmlFor="filter">Search by ID or Title</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="filter"
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by work item ID or title..."
                disabled={loading || importing}
                className="flex-1"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start gap-2 sm:w-[150px]"
                    disabled={loading || importing}
                    aria-label={statusFilterLabel}
                    title={statusFilterLabel}
                  >
                    <Filter className="h-4 w-4" />
                    Status
                    {isStatusFilterActive && (
                      <span
                        aria-hidden="true"
                        className="ml-auto h-2 w-2 rounded-full bg-orange-500"
                      />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {IMPORT_STATUS_FILTER_OPTIONS.map((status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={selectedStatuses.has(status)}
                      onCheckedChange={() => toggleStatus(status)}
                    >
                      {status}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button type="submit" variant="secondary" disabled={loading || importing}>
                Search
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Statuses: {selectedStatusList.length > 0 ? selectedStatusList.join(", ") : "None"}
            </div>
          </form>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ImportSource)}>
            <TabsList className={externalAvailable ? "grid w-full grid-cols-2" : "grid w-full grid-cols-1"}>
              {externalAvailable && (
                <TabsTrigger value="external">Azure DevOps</TabsTrigger>
              )}
              <TabsTrigger value="backlog">Backlog</TabsTrigger>
            </TabsList>

            {externalAvailable && (
              <TabsContent value="external" className="mt-4">
                {renderWorkItemList()}
              </TabsContent>
            )}
            <TabsContent value="backlog" className="mt-4">
              {renderWorkItemList()}
            </TabsContent>
          </Tabs>

          {selectedIds.size > 0 && (
            <div className="text-sm text-muted-foreground">
              {selectedIds.size} work item(s) selected
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              onClick={onClose}
              disabled={importing}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={importing || selectedIds.size === 0 || loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {importing ? "Importing..." : `Import ${selectedIds.size > 0 ? `(${selectedIds.size})` : ""}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );

  function renderWorkItemList() {
    if (loading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      );
    }

    if (activeWorkItems.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="border rounded-md max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="p-2 text-left w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4"
                  disabled={importing || filteredWorkItemIds.length === 0}
                />
              </th>
              <th className="p-2 text-left w-20">ID</th>
              <th className="p-2 text-left">Title</th>
              <th className="p-2 text-left w-28">Source</th>
              <th className="p-2 text-left w-24">Type</th>
              <th className="p-2 text-left w-24">State</th>
            </tr>
          </thead>
          <tbody>
            {activeWorkItems.map((item) => (
              <tr
                key={item.id}
                className="border-t hover:bg-muted/50 cursor-pointer"
                onClick={() => toggleSelect(item.id)}
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="h-4 w-4"
                    disabled={importing}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="p-2 font-mono text-sm">{item.id}</td>
                <td className="p-2">{item.title}</td>
                <td className="p-2">
                  {activeTab === "external" ? (
                    <Badge variant="outline">Azure DevOps</Badge>
                  ) : item.externalId ? (
                    <Badge variant="outline">ADO #{item.externalId}</Badge>
                  ) : (
                    <Badge variant="secondary">Local</Badge>
                  )}
                </td>
                <td className="p-2">
                  <Badge variant="outline">{item.type}</Badge>
                </td>
                <td className="p-2">
                  <Badge variant="secondary">{item.state}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
