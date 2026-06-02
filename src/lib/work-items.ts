import db from "@/lib/db";
import type {
  IntegrationProvider,
  TrackableWorkItemType,
  WorkItem,
  WorkItemStatus,
  WorkItemType,
} from "@/types";

export const WORK_ITEM_TYPES: WorkItemType[] = ["user_story", "task", "bug"];
export const TRACKABLE_WORK_ITEM_TYPES: TrackableWorkItemType[] = ["task", "bug"];
export const WORK_ITEM_STATUSES: WorkItemStatus[] = [
  "new",
  "in_progress",
  "resolved",
  "completed",
];

export const isTrackableWorkItemType = (
  type: string | null | undefined
): type is TrackableWorkItemType =>
  type === "task" || type === "bug";

export const normalizeWorkItemType = (
  value: string | null | undefined,
  fallback: WorkItemType = "task"
): WorkItemType => {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "user_story" || normalized === "userstory") return "user_story";
  if (normalized === "product_backlog_item" || normalized === "pbi") return "user_story";
  if (normalized === "bug") return "bug";
  if (normalized === "task") return "task";
  return fallback;
};

export const normalizeWorkItemStatus = (
  value: string | null | undefined,
  fallback: WorkItemStatus = "new"
): WorkItemStatus => {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_");
  if (!normalized) return fallback;

  if (["new", "todo", "to_do", "open", "proposed"].includes(normalized)) {
    return "new";
  }
  if (["active", "in_progress", "doing", "committed"].includes(normalized)) {
    return "in_progress";
  }
  if (["resolved", "ready_for_qa", "ready_for_test"].includes(normalized)) {
    return "resolved";
  }
  if (["closed", "done", "completed", "complete", "released"].includes(normalized)) {
    return "completed";
  }

  return fallback;
};

export const displayWorkItemStatus = (status: string | null | undefined): string => {
  switch (normalizeWorkItemStatus(status)) {
    case "new":
      return "New";
    case "in_progress":
      return "Active";
    case "resolved":
      return "Resolved";
    case "completed":
      return "Closed";
  }
};

export const displayWorkItemType = (type: string | null | undefined): string => {
  switch (normalizeWorkItemType(type)) {
    case "user_story":
      return "User Story";
    case "bug":
      return "Bug";
    case "task":
      return "Task";
  }
};

export const mapAzureDevOpsTypeToWorkItemType = (
  nativeType: string | null | undefined
): WorkItemType => normalizeWorkItemType(nativeType, "task");

export const mapAzureDevOpsTypeToTrackableWorkItemType = (
  nativeType: string | null | undefined
): TrackableWorkItemType | null => {
  const normalized = normalizeWorkItemType(nativeType, "user_story");
  return isTrackableWorkItemType(normalized) ? normalized : null;
};

export const mapAzureDevOpsStatusToWorkItemStatus = (
  nativeStatus: string | null | undefined
): WorkItemStatus => normalizeWorkItemStatus(nativeStatus);

export const getCompletedAtForStatus = (
  nextStatus: WorkItemStatus,
  previousCompletedAt?: Date | string | null
): string | null => {
  if (nextStatus === "completed") {
    if (previousCompletedAt) {
      return previousCompletedAt instanceof Date
        ? previousCompletedAt.toISOString()
        : previousCompletedAt;
    }
    return new Date().toISOString();
  }
  return null;
};

export const getUserProjectMembership = (
  projectId: number,
  userId: number
): {
  id: number;
  name: string;
  hostName?: string | null;
  email?: string | null;
  is_admin: number;
} | null => {
  const member = db
    .prepare(
      `
        SELECT
          u.id,
          COALESCE(u.app_display_name, u.name) AS name,
          u.name AS hostName,
          u.email,
          u.is_admin
        FROM users u
        WHERE u.id = ?
          AND (
            u.is_admin = 1
            OR EXISTS (
              SELECT 1
              FROM project_members pm
              WHERE pm.project_id = ? AND pm.user_id = u.id
            )
          )
      `
    )
    .get(userId, projectId) as
    | {
        id: number;
        name: string;
        hostName?: string | null;
        email?: string | null;
        is_admin: number;
      }
    | undefined;

  return member ?? null;
};

export const getProjectMembers = (projectId: number) =>
  db
    .prepare(
      `
        SELECT
          u.id,
          COALESCE(u.app_display_name, u.name) AS name,
          u.name AS hostName,
          u.email,
          u.is_admin
        FROM users u
        WHERE u.is_admin = 1
          OR EXISTS (
            SELECT 1
            FROM project_members pm
            WHERE pm.project_id = ? AND pm.user_id = u.id
          )
        ORDER BY u.is_admin DESC, lower(COALESCE(u.app_display_name, u.name)) ASC, u.id ASC
      `
    )
    .all(projectId) as Array<{
    id: number;
    name: string;
    hostName?: string | null;
    email?: string | null;
    is_admin: number;
  }>;

export const getWorkItemForUser = (
  workItemId: number,
  projectId: number,
  userId: number,
  options: { requireAssigned?: boolean; requireTrackable?: boolean } = {}
): WorkItem | null => {
  const conditions = ["wi.id = ?", "wi.project_id = ?"];
  const params: Array<number | string> = [workItemId, projectId];

  if (options.requireAssigned) {
    conditions.push("wi.assigned_user_id = ?");
    params.push(userId);
  }
  if (options.requireTrackable) {
    conditions.push("wi.type IN ('task', 'bug')");
  }

  const item = db
    .prepare(
      `
        SELECT
          wi.*,
          wi.assigned_user_id AS user_id,
          link.provider AS external_source,
          link.external_id,
          link.native_assignee_id AS azure_assigned_to_id,
          link.native_assignee_name AS azure_assigned_to_name,
          link.native_assignee_unique_name AS azure_assigned_to_unique_name,
          link.native_assignee_is_current_user AS azure_assignee_is_current_user
        FROM work_items wi
        LEFT JOIN work_item_external_links link
          ON link.work_item_id = wi.id
        WHERE ${conditions.join(" AND ")}
        LIMIT 1
      `
    )
    .get(...params) as WorkItem | undefined;

  return item ?? null;
};

export interface WorkflowGateResult {
  ok: boolean;
  error?: string;
}

const getGateStatus = (type: WorkItemType): WorkItemStatus =>
  type === "task" ? "completed" : "resolved";

export const evaluateWorkflowGate = (
  workItemId: number,
  type: WorkItemType,
  nextStatus: WorkItemStatus
): WorkflowGateResult => {
  const gatedStatus = getGateStatus(type);
  const entersGatedStatus =
    nextStatus === gatedStatus || (gatedStatus === "resolved" && nextStatus === "completed");
  if (!entersGatedStatus) {
    return { ok: true };
  }

  const checklist = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS completed
        FROM checklist_items
        WHERE work_item_id = ?
      `
    )
    .get(workItemId) as { total: number; completed: number | null };

  if (checklist.total > 0 && (checklist.completed ?? 0) < checklist.total) {
    return {
      ok: false,
      error:
        "Cannot move this work item to the selected status until all checklist items are completed.",
    };
  }

  const activeBlockers = db
    .prepare(
      "SELECT COUNT(*) AS total FROM blockers WHERE work_item_id = ? AND is_resolved = 0"
    )
    .get(workItemId) as { total: number };

  if (activeBlockers.total > 0) {
    return {
      ok: false,
      error:
        "Cannot move this work item to the selected status while active blockers exist.",
    };
  }

  return { ok: true };
};

export const applyLocalStatusChange = ({
  workItemId,
  projectId,
  userId,
  status,
  bypassWorkflowGate = false,
}: {
  workItemId: number;
  projectId: number;
  userId: number;
  status: string;
  bypassWorkflowGate?: boolean;
}): WorkflowGateResult => {
  const item = getWorkItemForUser(workItemId, projectId, userId);
  if (!item) {
    return { ok: false, error: "Work item not found" };
  }

  const nextStatus = normalizeWorkItemStatus(status, item.status);
  const gate = bypassWorkflowGate
    ? { ok: true as const }
    : evaluateWorkflowGate(workItemId, item.type, nextStatus);
  if (!gate.ok) {
    return gate;
  }

  db.prepare(
    `
      UPDATE work_items
      SET status = ?,
          completed_at = ?,
          updated_by_user_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ?
    `
  ).run(
    nextStatus,
    getCompletedAtForStatus(nextStatus, item.completed_at),
    userId,
    workItemId,
    projectId
  );

  return { ok: true };
};

export const upsertExternalLink = ({
  workItemId,
  projectId,
  provider,
  externalId,
  externalUrl,
  nativeType,
  nativeStatus,
  nativeAssigneeId,
  nativeAssigneeName,
  nativeAssigneeUniqueName,
  nativeAssigneeIsCurrentUser,
  sanitizedSnapshot,
}: {
  workItemId: number;
  projectId: number;
  provider: IntegrationProvider;
  externalId: string | number;
  externalUrl?: string | null;
  nativeType?: string | null;
  nativeStatus?: string | null;
  nativeAssigneeId?: string | null;
  nativeAssigneeName?: string | null;
  nativeAssigneeUniqueName?: string | null;
  nativeAssigneeIsCurrentUser?: boolean | null;
  sanitizedSnapshot?: unknown;
}) => {
  db.prepare(
    `
      INSERT INTO work_item_external_links (
        work_item_id,
        project_id,
        provider,
        external_id,
        external_url,
        native_type,
        native_status,
        native_assignee_id,
        native_assignee_name,
        native_assignee_unique_name,
        native_assignee_is_current_user,
        sanitized_snapshot,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id, provider, external_id) DO UPDATE SET
        work_item_id = excluded.work_item_id,
        external_url = excluded.external_url,
        native_type = excluded.native_type,
        native_status = excluded.native_status,
        native_assignee_id = excluded.native_assignee_id,
        native_assignee_name = excluded.native_assignee_name,
        native_assignee_unique_name = excluded.native_assignee_unique_name,
        native_assignee_is_current_user = COALESCE(
          excluded.native_assignee_is_current_user,
          native_assignee_is_current_user
        ),
        sanitized_snapshot = excluded.sanitized_snapshot,
        sync_enabled = 1,
        sync_status = 'synced',
        last_sync_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(
    workItemId,
    projectId,
    provider,
    String(externalId),
    externalUrl ?? null,
    nativeType ?? null,
    nativeStatus ?? null,
    nativeAssigneeId ?? null,
    nativeAssigneeName ?? null,
    nativeAssigneeUniqueName ?? null,
    nativeAssigneeIsCurrentUser === null || nativeAssigneeIsCurrentUser === undefined
      ? null
      : nativeAssigneeIsCurrentUser
        ? 1
        : 0,
    sanitizedSnapshot === undefined ? null : JSON.stringify(sanitizedSnapshot)
  );
};

export const markExternalLinkSyncFailed = (
  workItemId: number,
  provider: IntegrationProvider,
  message: string
) => {
  db.prepare(
    `
      UPDATE work_item_external_links
      SET sync_status = 'sync_failed',
          last_sync_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE work_item_id = ? AND provider = ?
    `
  ).run(message, workItemId, provider);

  db.prepare(
    `
      UPDATE work_items
      SET sync_state = 'sync_failed',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(workItemId);
};

export const getLinkedExternalId = (
  workItemId: number,
  provider: IntegrationProvider
): string | null => {
  const link = db
    .prepare(
      "SELECT external_id FROM work_item_external_links WHERE work_item_id = ? AND provider = ?"
    )
    .get(workItemId, provider) as { external_id: string } | undefined;
  return link?.external_id ?? null;
};
