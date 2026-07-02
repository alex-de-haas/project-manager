"use client";

import { useState, useEffect, useRef } from "react";
import type { ChecklistItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2, Pencil, GripVertical, Plus, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Multiline textarea that grows with its content instead of scrolling.
function AutoGrowTextarea({
  className,
  value,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <Textarea
      ref={ref}
      rows={1}
      value={value}
      className={`resize-none overflow-hidden ${className ?? ""}`}
      {...props}
    />
  );
}

interface ChecklistModalProps {
  taskId: number;
  taskTitle: string;
  onClose: () => void;
  onSuccess?: () => void;
}

interface SortableItemProps {
  item: ChecklistItem;
  onToggle: (item: ChecklistItem) => void;
  onDelete: (id: number) => void;
  onEdit: (id: number, title: string) => void;
}

function SortableItem({ item, onToggle, onDelete, onEdit }: SortableItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveEdit = () => {
    if (editTitle.trim() && editTitle !== item.title) {
      onEdit(item.id, editTitle.trim());
    } else {
      setEditTitle(item.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      setEditTitle(item.title);
      setIsEditing(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 bg-background border rounded-md group ${
        item.is_completed ? "opacity-60" : ""
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>
      
      <Checkbox
        checked={!!item.is_completed}
        onCheckedChange={() => onToggle(item)}
        className="flex-shrink-0"
      />
      
      {isEditing ? (
        <AutoGrowTextarea
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 min-h-[32px] py-1"
        />
      ) : (
        <span
          className={`flex-1 cursor-pointer whitespace-pre-wrap break-words ${
            item.is_completed ? "line-through text-muted-foreground" : ""
          }`}
          onClick={() => setIsEditing(true)}
          title="Click to edit"
        >
          {item.title}
        </span>
      )}
      
      {!isEditing && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto text-muted-foreground hover:text-primary"
          onClick={() => setIsEditing(true)}
          aria-label="Edit item"
          title="Edit item"
        >
          <Pencil className="w-4 h-4" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(item.id)}
        aria-label="Delete item"
        title="Delete item"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}

export default function ChecklistModal({
  taskId,
  taskTitle,
  onClose,
  onSuccess,
}: ChecklistModalProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [error, setError] = useState("");
  
  // AI generation state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchItems = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/checklist?taskId=${taskId}`);
      if (!response.ok) throw new Error("Failed to fetch checklist items");
      const data = await response.json();
      setItems(data);
      setError("");
    } catch (err) {
      setError("Failed to load checklist items");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const handleAddItem = async () => {
    if (!newItemTitle.trim()) return;

    try {
      const response = await fetch("/api/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          title: newItemTitle.trim(),
        }),
      });

      if (!response.ok) throw new Error("Failed to add checklist item");

      setNewItemTitle("");
      await fetchItems();
      onSuccess?.();
    } catch (err) {
      setError("Failed to add checklist item");
      console.error(err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddItem();
    }
  };

  const handleAiGenerate = async () => {
    if (!aiText.trim()) return;

    setAiGenerating(true);
    setError("");

    try {
      const response = await fetch("/api/checklist/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          text: aiText.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate checklist");
      }

      setAiText("");
      setShowAiPanel(false);
      await fetchItems();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate checklist from AI");
      console.error(err);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleToggle = async (item: ChecklistItem) => {
    try {
      const response = await fetch("/api/checklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          is_completed: item.is_completed ? 0 : 1,
        }),
      });

      if (!response.ok) throw new Error("Failed to toggle checklist item");

      await fetchItems();
      onSuccess?.();
    } catch (err) {
      setError("Failed to toggle checklist item");
      console.error(err);
    }
  };

  const handleEdit = async (id: number, title: string) => {
    try {
      const response = await fetch("/api/checklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });

      if (!response.ok) throw new Error("Failed to update checklist item");

      await fetchItems();
      onSuccess?.();
    } catch (err) {
      setError("Failed to update checklist item");
      console.error(err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`/api/checklist?id=${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete checklist item");

      await fetchItems();
      onSuccess?.();
    } catch (err) {
      setError("Failed to delete checklist item");
      console.error(err);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);
      setItems(newItems);

      // Update order in database
      try {
        await Promise.all(
          newItems.map((item, index) =>
            fetch("/api/checklist", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id, display_order: index }),
            })
          )
        );
        onSuccess?.();
      } catch (err) {
        setError("Failed to reorder items");
        console.error(err);
        await fetchItems(); // Revert on error
      }
    }
  };

  const completedCount = items.filter((item) => item.is_completed).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Checklist</span>
            {totalCount > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({completedCount}/{totalCount} - {progress}%)
              </span>
            )}
          </DialogTitle>
          <p className="text-sm text-muted-foreground truncate">{taskTitle}</p>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        {/* Progress bar */}
        {totalCount > 0 && (
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Add new item */}
        <div className="flex gap-2 items-start">
          <AutoGrowTextarea
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add new item... (Shift+Enter for a new line)"
            className="flex-1 min-h-[36px]"
          />
          <Button onClick={handleAddItem} disabled={!newItemTitle.trim()}>
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowAiPanel(!showAiPanel)}
            className="border-purple-600 text-purple-600 hover:bg-purple-50"
            title="Generate from text using AI"
          >
            <Sparkles className="w-4 h-4 mr-1" />
            AI
            {showAiPanel ? (
              <ChevronUp className="w-3 h-3 ml-1" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-1" />
            )}
          </Button>
        </div>

        {/* AI Generation Panel */}
        {showAiPanel && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span>Paste text below and AI will extract checklist items</span>
            </div>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="Paste meeting notes, requirements, task descriptions, or any text..."
              className="w-full min-h-[100px] p-2 text-sm border rounded-md resize-y bg-background"
              disabled={aiGenerating}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAiText("");
                  setShowAiPanel(false);
                }}
                disabled={aiGenerating}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAiGenerate}
                disabled={!aiText.trim() || aiGenerating}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {aiGenerating ? (
                  <>
                    <span className="animate-spin mr-1">⏳</span>
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-1" />
                    Generate Checklist
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Checklist items */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[150px] md:min-h-[360px]">
          {loading ? (
            null
          ) : items.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No checklist items yet. Add one above!
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {items.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
