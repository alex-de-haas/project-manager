"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { AzureDevOpsWorkItem } from "@/types";

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

interface ImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportModal({ onClose, onSuccess }: ImportModalProps) {
  const [workItems, setWorkItems] = useState<AzureDevOpsWorkItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [filterText, setFilterText] = useState("");

  const fetchWorkItems = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/azure-devops/work-items");
      const data = await response.json();

      if (response.ok) {
        setWorkItems(data.workItems || []);
      } else {
        toast.error(`Failed to fetch work items: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      toast.error("Failed to fetch work items: Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWorkItems();
  }, [fetchWorkItems]);

  const filteredWorkItems = useMemo(() => {
    const searchText = filterText.trim().toLowerCase();
    if (!searchText) return workItems;

    return workItems.filter(
      (item) =>
        item.id.toString().includes(searchText) ||
        item.title.toLowerCase().includes(searchText)
    );
  }, [filterText, workItems]);

  const filteredWorkItemIds = useMemo(
    () => filteredWorkItems.map((item) => item.id),
    [filteredWorkItems]
  );

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const allVisibleSelected = filteredWorkItemIds.every((id) =>
        current.has(id)
      );
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
      const response = await fetch("/api/azure-devops/import", {
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

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Import from Azure DevOps</DialogTitle>
          <DialogDescription>
            Select Azure DevOps tasks and bugs assigned to you for Time Management.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="filter">Search by ID or Title</Label>
            <Input
              id="filter"
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter by work item ID or title..."
              disabled={loading || importing}
            />
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredWorkItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {workItems.length === 0
                ? "No new tasks or bugs available to import"
                : "No work items match your filter"}
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
                        disabled={importing}
                      />
                    </th>
                    <th className="p-2 text-left w-20">ID</th>
                    <th className="p-2 text-left">Title</th>
                    <th className="p-2 text-left w-24">Type</th>
                    <th className="p-2 text-left w-24">State</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkItems.map((item) => (
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
          )}

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
}
