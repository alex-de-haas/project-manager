"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AzureDevOpsWorkItem } from "@/types";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ImportWorkItemList } from "@/components/ImportWorkItemList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const formatImportSummary = (imported: number, skipped: number) => {
  const importedLabel = imported === 1 ? "user story" : "user stories";
  const skippedLabel = skipped === 1 ? "user story" : "user stories";

  return [
    `Imported ${imported} ${importedLabel}`,
    skipped > 0 ? `skipped ${skipped} existing ${skippedLabel}` : null,
  ]
    .filter(Boolean)
    .join(", ");
};

const formatChildImportSummary = (childItems: number) => {
  if (childItems === 0) return null;
  const childLabel = childItems === 1 ? "child item" : "child items";
  return `synced ${childItems} ${childLabel}`;
};

interface ReleaseImportModalProps {
  releaseId: number;
  onClose: () => void;
  onSuccess: () => void;
}

type PageSizeOption = "10" | "20" | "50";

export default function ReleaseImportModal({
  releaseId,
  onClose,
  onSuccess,
}: ReleaseImportModalProps) {
  const [workItems, setWorkItems] = useState<AzureDevOpsWorkItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [pageSize, setPageSize] = useState<PageSizeOption>("20");

  const fetchWorkItems = useCallback(async (searchTerm: string, limit: number) => {
    const trimmedSearch = searchTerm.trim();
    try {
      setLoading(true);
      let url = `/api/azure-devops/user-stories?releaseId=${releaseId}&limit=${limit}`;
      if (trimmedSearch) {
        url += `&search=${encodeURIComponent(trimmedSearch)}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (response.ok) {
        setWorkItems(data.workItems || []);
        setSelectedIds(new Set());
        setAppliedFilter(trimmedSearch);
      } else {
        toast.error(
          `Failed to fetch user stories: ${data.error || "Unknown error"}`
        );
      }
    } catch (err) {
      toast.error("Failed to fetch user stories: Network error");
    } finally {
      setLoading(false);
    }
  }, [releaseId]);

  useEffect(() => {
    fetchWorkItems("", 20);
  }, [fetchWorkItems]);

  const handleSearch = () => {
    fetchWorkItems(filterText, Number(pageSize));
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSearch();
  };

  const handlePageSizeChange = (value: PageSizeOption) => {
    setPageSize(value);
    fetchWorkItems(appliedFilter, Number(value));
  };

  const selectableWorkItems = workItems.filter((item) => !item.isImported);
  const displayWorkItems = useMemo(
    () =>
      workItems.map((item) => ({
        ...item,
        externalId: item.externalId ?? String(item.id),
        externalSource: item.externalSource ?? "azure_devops",
      })),
    [workItems]
  );

  const toggleSelectAll = () => {
    if (selectedIds.size === selectableWorkItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableWorkItems.map((item) => item.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) {
      toast.error("Please select at least one user story to import");
      return;
    }

    setImporting(true);

    try {
      const response = await fetch("/api/releases/work-items/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId,
          workItemIds: Array.from(selectedIds),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const summary = [
          formatImportSummary(data.imported ?? 0, data.skipped ?? 0),
          formatChildImportSummary(data.childItemsSync?.items ?? 0),
        ]
          .filter(Boolean)
          .join(", ");
        toast.success(summary);
        if (data.childItemsSyncError) {
          toast.error(`Child work item sync failed: ${data.childItemsSyncError}`);
        }
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

  const allSelected =
    selectableWorkItems.length > 0 &&
    selectedIds.size === selectableWorkItems.length;
  const someSelected =
    selectedIds.size > 0 && selectedIds.size < selectableWorkItems.length;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] min-w-0 overflow-hidden sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Import User Stories</DialogTitle>
          <DialogDescription>
            Select Azure DevOps user stories to add to this release. Child tasks
            and bugs are synced automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <form className="min-w-0 space-y-2" onSubmit={handleSearchSubmit}>
            <Label htmlFor="filter">Search by ID or Title</Label>
            <div className="flex min-w-0 gap-2">
              <Input
                id="filter"
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Enter ID or title and press Search"
                disabled={loading || importing}
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                className="flex-shrink-0"
                disabled={loading || importing}
              >
                Search
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="page-size">Items to show</Label>
              <Select
                value={pageSize}
                onValueChange={(value) => handlePageSizeChange(value as PageSizeOption)}
                disabled={loading || importing}
              >
                <SelectTrigger id="page-size" className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Showing up to {pageSize} user stories, sorted by last modified date.
            </p>
          </form>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : workItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {appliedFilter
                ? "No user stories match your search"
                : "No user stories available to import"}
            </div>
          ) : (
            <ImportWorkItemList
              items={displayWorkItems}
              selectedIds={selectedIds}
              allSelected={allSelected}
              someSelected={someSelected}
              importing={importing}
              showExternalReference={true}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              selectAllDisabled={selectableWorkItems.length === 0}
              isItemDisabled={(item) => Boolean(item.isImported)}
            />
          )}

          {selectedIds.size > 0 && (
            <div className="text-sm text-muted-foreground">
              {selectedIds.size} user story(s) selected
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
            <Button type="button" onClick={handleImport} disabled={importing}>
              {importing ? "Importing..." : "Import selected"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
