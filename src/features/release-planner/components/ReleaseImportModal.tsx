"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Import User Stories</DialogTitle>
          <DialogDescription>
            Select Azure DevOps user stories to add to this release. Child tasks
            and bugs are synced automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <form className="space-y-2" onSubmit={handleSearchSubmit}>
            <Label htmlFor="filter">Search by ID or Title</Label>
            <div className="flex gap-2">
              <Input
                id="filter"
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Enter ID or title and press Search"
                disabled={loading || importing}
              />
              <Button type="submit" variant="secondary" disabled={loading || importing}>
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
                        disabled={importing || selectableWorkItems.length === 0}
                      />
                    </th>
                    <th className="p-2 text-left w-20">ID</th>
                    <th className="p-2 text-left">Title</th>
                    <th className="p-2 text-left w-24">Type</th>
                    <th className="p-2 text-left w-24">State</th>
                    <th className="p-2 text-left w-32">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {workItems.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t ${
                        item.isImported
                          ? "bg-muted/40 text-muted-foreground"
                          : "hover:bg-muted/50 cursor-pointer"
                      }`}
                      onClick={() => {
                        if (!item.isImported) {
                          toggleSelect(item.id);
                        }
                      }}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="h-4 w-4"
                          disabled={importing || item.isImported}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="p-2 font-mono text-sm">{Math.floor(item.id)}</td>
                      <td className="p-2">{item.title}</td>
                      <td className="p-2">
                        <Badge variant="outline">{item.type}</Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant="secondary">{item.state}</Badge>
                      </td>
                      <td className="p-2">
                        {item.isImported ? (
                          <Badge variant="secondary">Already imported</Badge>
                        ) : item.tags && item.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {item.tags.map((tag, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
