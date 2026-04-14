import { WorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import {
  WorkItemErrorPolicy,
  WorkItemExpand,
} from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import db from "@/lib/db";

export interface ChildWorkItemSnapshot {
  id: number;
  parentId: number;
  title: string;
  type: string;
  state: string;
  assignedTo?: string | null;
}

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const uniqueParentIds = (parentIds: number[]): number[] =>
  Array.from(
    new Set(
      parentIds
        .map((value) => parsePositiveInt(value))
        .filter((value): value is number => value !== null)
    )
  );

const CHILD_LINK_RELATION = "System.LinkTypes.Hierarchy-Forward";

const parseWorkItemIdFromUrl = (url?: string): number | null => {
  if (!url) return null;
  const match = url.match(/\/workItems\/(\d+)(?:$|[/?#])/i);
  if (!match) return null;
  return parsePositiveInt(match[1]);
};

const buildWorkItemTypeCategorySets = async (
  witApi: WorkItemTrackingApi,
  project: string
): Promise<{ taskTypes: Set<string>; bugTypes: Set<string> }> => {
  const taskTypes = new Set<string>(["task"]);
  const bugTypes = new Set<string>(["bug"]);

  try {
    const categories = await witApi.getWorkItemTypeCategories(project);
    for (const category of categories ?? []) {
      const referenceName = category.referenceName?.trim().toLowerCase();
      const targetSet =
        referenceName === "microsoft.taskcategory"
          ? taskTypes
          : referenceName === "microsoft.bugcategory"
            ? bugTypes
            : null;

      if (!targetSet) continue;

      for (const workItemType of category.workItemTypes ?? []) {
        const name = workItemType.name?.trim().toLowerCase();
        if (name) {
          targetSet.add(name);
        }
      }
    }
  } catch {
    // Fall back to literal Task/Bug matching if category metadata is unavailable.
  }

  return { taskTypes, bugTypes };
};

const normalizeChildWorkItemType = (
  type: string,
  categorySets: { taskTypes: Set<string>; bugTypes: Set<string> }
): "task" | "bug" | null => {
  const normalized = type.trim().toLowerCase();
  if (!normalized) return null;
  if (categorySets.bugTypes.has(normalized)) return "bug";
  if (categorySets.taskTypes.has(normalized)) return "task";
  return null;
};

export const fetchChildWorkItemsForParentIds = async (
  witApi: WorkItemTrackingApi,
  project: string,
  parentIds: number[]
): Promise<ChildWorkItemSnapshot[]> => {
  const uniqueIds = uniqueParentIds(parentIds);
  if (uniqueIds.length === 0) return [];
  const workItemTypeCategories = await buildWorkItemTypeCategorySets(witApi, project);

  const parentBatchSize = 200;
  const workItemBatchSize = 200;
  const allItems: ChildWorkItemSnapshot[] = [];
  const childIdToParentId = new Map<number, number>();

  for (let i = 0; i < uniqueIds.length; i += parentBatchSize) {
    const parentBatch = uniqueIds.slice(i, i + parentBatchSize);
    const parentItems = await witApi.getWorkItems(
      parentBatch,
      ["System.Id"],
      undefined,
      WorkItemExpand.Relations,
      WorkItemErrorPolicy.Omit,
      project
    );

    for (const parentItem of parentItems ?? []) {
      const parentId = parsePositiveInt(parentItem.id);
      if (!parentId) continue;

      for (const relation of parentItem.relations ?? []) {
        if (relation.rel !== CHILD_LINK_RELATION) continue;
        const childId = parseWorkItemIdFromUrl(relation.url);
        if (!childId) continue;
        childIdToParentId.set(childId, parentId);
      }
    }
  }

  const childIds = Array.from(childIdToParentId.keys());
  if (childIds.length === 0) return [];

  for (let i = 0; i < childIds.length; i += workItemBatchSize) {
    const idBatch = childIds.slice(i, i + workItemBatchSize);
    const workItems = await witApi.getWorkItems(
      idBatch,
      [
        "System.Id",
        "System.Title",
        "System.WorkItemType",
        "System.State",
        "System.AssignedTo",
      ],
      undefined,
      undefined,
      WorkItemErrorPolicy.Omit,
      project
    );

    for (const workItem of workItems ?? []) {
      if (!workItem.id || !workItem.fields) continue;
      const parentId = childIdToParentId.get(workItem.id);
      if (!parentId) continue;

      const type = String(workItem.fields["System.WorkItemType"] ?? "Unknown");
      const normalizedType = normalizeChildWorkItemType(type, workItemTypeCategories);
      const state = String(workItem.fields["System.State"] ?? "Unknown");
      const normalizedState = state.trim().toLowerCase();
      if ((normalizedType !== "task" && normalizedType !== "bug") || normalizedState === "removed") {
        continue;
      }

      const assignedField = workItem.fields["System.AssignedTo"] as
        | string
        | { displayName?: string; uniqueName?: string }
        | undefined;
      const assignedTo =
        typeof assignedField === "string"
          ? assignedField
          : assignedField?.displayName || assignedField?.uniqueName || null;

      allItems.push({
        id: workItem.id,
        parentId,
        title: String(workItem.fields["System.Title"] ?? "Untitled"),
        type: normalizedType === "bug" ? "Bug" : "Task",
        state,
        assignedTo,
      });
    }
  }

  return allItems;
};

export const syncChildWorkItemsSnapshot = (params: {
  projectId: number;
  parentIds: number[];
  items: ChildWorkItemSnapshot[];
}): { parents: number; items: number; deleted: number } => {
  const { projectId } = params;
  const parentIds = uniqueParentIds(params.parentIds);

  if (parentIds.length === 0) {
    return { parents: 0, items: 0, deleted: 0 };
  }

  const parentIdSet = new Set(parentIds);
  const itemsById = new Map<number, ChildWorkItemSnapshot>();
  for (const item of params.items) {
    const itemId = parsePositiveInt(item.id);
    const parentId = parsePositiveInt(item.parentId);
    if (!itemId || !parentId || !parentIdSet.has(parentId)) {
      continue;
    }
    itemsById.set(itemId, {
      ...item,
      id: itemId,
      parentId,
      title: item.title || "Untitled",
      type: item.type || "Unknown",
      state: item.state || "Unknown",
      assignedTo: item.assignedTo ?? null,
    });
  }

  const uniqueItems = Array.from(itemsById.values());

  const insertStmt = db.prepare(`
    INSERT INTO release_work_item_children (
      project_id,
      parent_external_id,
      child_external_id,
      title,
      work_item_type,
      state,
      assigned_to,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project_id, child_external_id) DO UPDATE SET
      parent_external_id = excluded.parent_external_id,
      title = excluded.title,
      work_item_type = excluded.work_item_type,
      state = excluded.state,
      assigned_to = excluded.assigned_to,
      updated_at = CURRENT_TIMESTAMP
  `);

  const syncTransaction = db.transaction(
    (transactionParentIds: number[], transactionItems: ChildWorkItemSnapshot[]) => {
      let deleted = 0;
      const deleteBatchSize = 200;

      for (let i = 0; i < transactionParentIds.length; i += deleteBatchSize) {
        const batch = transactionParentIds.slice(i, i + deleteBatchSize);
        const placeholders = batch.map(() => "?").join(", ");
        const deleteResult = db
          .prepare(
            `
            DELETE FROM release_work_item_children
            WHERE project_id = ?
              AND parent_external_id IN (${placeholders})
          `
          )
          .run(projectId, ...batch);
        deleted += deleteResult.changes;
      }

      for (const item of transactionItems) {
        insertStmt.run(
          projectId,
          item.parentId,
          item.id,
          item.title,
          item.type,
          item.state,
          item.assignedTo ?? null
        );
      }

      return deleted;
    }
  );

  const deleted = syncTransaction(parentIds, uniqueItems);

  return {
    parents: parentIds.length,
    items: uniqueItems.length,
    deleted,
  };
};
