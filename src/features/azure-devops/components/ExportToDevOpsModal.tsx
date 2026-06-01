"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

interface ParentWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
}

interface ExportToDevOpsModalProps {
  task: {
    id: number;
    title: string;
    type: "task" | "bug";
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function ExportToDevOpsModal({ task, onClose, onSuccess }: ExportToDevOpsModalProps) {
  const [parentWorkItems, setParentWorkItems] = useState<ParentWorkItem[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [filterText, setFilterText] = useState("");

  const fetchParentWorkItems = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/azure-devops/export");
      const data = await response.json();

      if (response.ok) {
        setParentWorkItems(data.parentWorkItems || []);
      } else {
        toast.error(`Failed to fetch parent work items: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      toast.error("Failed to fetch parent work items: Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchParentWorkItems();
  }, [fetchParentWorkItems]);

  const filteredWorkItems = useMemo(() => {
    const searchText = filterText.trim().toLowerCase();
    if (!searchText) return parentWorkItems;

    return parentWorkItems.filter(
      (item) =>
        item.id.toString().includes(searchText) ||
        item.title.toLowerCase().includes(searchText) ||
        item.type.toLowerCase().includes(searchText)
    );
  }, [filterText, parentWorkItems]);

  const handleExport = async () => {
    setExporting(true);

    try {
      const response = await fetch("/api/azure-devops/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          taskId: task.id,
          parentWorkItemId: selectedParentId || undefined
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.statusSyncFailed) {
          toast.info(data.message || "Exported to Azure DevOps, but status sync failed");
        } else {
          toast.success(data.message || "Successfully exported to Azure DevOps");
        }
        onSuccess();
      } else {
        toast.error(`Export failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      toast.error("Export failed: Network error");
    } finally {
      setExporting(false);
    }
  };

  const getTypeBadgeStyle = (type: string) => {
    switch (type.toLowerCase()) {
      case "epic":
        return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-800";
      case "feature":
        return "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800";
      case "user story":
      case "product backlog item":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800";
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Export to Azure DevOps</DialogTitle>
          <DialogDescription>
            Export &quot;{task.title}&quot; to Azure DevOps. When assignment is set, it uses the selected assignee email from task creation.
            Optionally select a parent work item.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border p-3 bg-muted/50">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Task:</span>
              <Badge variant="outline" className="text-xs">
                {task.type === "bug" ? "Bug" : "Task"}
              </Badge>
              <span className="font-medium">{task.title}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter">Select Parent Work Item (Optional)</Label>
            <Input
              id="filter"
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search by ID, title, or type..."
              disabled={loading || exporting}
            />
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="border rounded-md max-h-[300px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-left w-12">
                      <input
                        type="radio"
                        checked={selectedParentId === null}
                        onChange={() => setSelectedParentId(null)}
                        className="h-4 w-4"
                        disabled={exporting}
                        title="No parent"
                      />
                    </th>
                    <th className="p-2 text-left w-20">ID</th>
                    <th className="p-2 text-left">Title</th>
                    <th className="p-2 text-left w-32">Type</th>
                    <th className="p-2 text-left w-24">State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t hover:bg-muted/50">
                    <td className="p-2">
                      <input
                        type="radio"
                        checked={selectedParentId === null}
                        onChange={() => setSelectedParentId(null)}
                        className="h-4 w-4"
                        disabled={exporting}
                      />
                    </td>
                    <td className="p-2 text-muted-foreground" colSpan={4}>
                      No parent (create as standalone work item)
                    </td>
                  </tr>
                  {filteredWorkItems.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t hover:bg-muted/50 cursor-pointer ${
                        selectedParentId === item.id ? "bg-blue-50 dark:bg-blue-950/50" : ""
                      }`}
                      onClick={() => !exporting && setSelectedParentId(item.id)}
                    >
                      <td className="p-2">
                        <input
                          type="radio"
                          checked={selectedParentId === item.id}
                          onChange={() => setSelectedParentId(item.id)}
                          className="h-4 w-4"
                          disabled={exporting}
                        />
                      </td>
                      <td className="p-2 font-mono text-sm">{item.id}</td>
                      <td className="p-2 text-sm truncate max-w-[200px]" title={item.title}>
                        {item.title}
                      </td>
                      <td className="p-2">
                        <Badge variant="outline" className={`text-xs ${getTypeBadgeStyle(item.type)}`}>
                          {item.type}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">
                          {item.state}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredWorkItems.length === 0 && parentWorkItems.length > 0 && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No work items match your filter
                </div>
              )}
              {parentWorkItems.length === 0 && !loading && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No parent work items found in Azure DevOps
                </div>
              )}
            </div>
          )}

        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={onClose}
            disabled={exporting}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleExport} 
            disabled={exporting || loading}
          >
            {exporting ? "Exporting..." : "Export to Azure DevOps"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
