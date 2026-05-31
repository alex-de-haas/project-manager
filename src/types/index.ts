export type WorkItemType = "user_story" | "task" | "bug";
export type TrackableWorkItemType = Extract<WorkItemType, "task" | "bug">;
export type WorkItemStatus = "new" | "in_progress" | "resolved" | "completed";
export type IntegrationProvider = "none" | "azure_devops";

export interface WorkItemExternalLink {
  id: number;
  work_item_id: number;
  project_id: number;
  provider: IntegrationProvider;
  external_id: string;
  external_url?: string | null;
  native_type?: string | null;
  native_status?: string | null;
  native_assignee_id?: string | null;
  native_assignee_name?: string | null;
  native_assignee_unique_name?: string | null;
  native_assignee_is_current_user?: number | null;
  sync_enabled: number;
  sync_status: "synced" | "sync_failed";
  last_sync_error?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkItem {
  id: number;
  project_id: number;
  title: string;
  description?: string | null;
  type: WorkItemType;
  status: WorkItemStatus;
  tags?: string | null;
  assigned_user_id?: number | null;
  parent_work_item_id?: number | null;
  display_order?: number | null;
  completed_at?: Date | string | null;
  sync_state?: "synced" | "sync_failed" | "not_synced";
  created_by_user_id?: number | null;
  created_at: Date;
  updated_by_user_id?: number | null;
  updated_at?: Date;
  externalLink?: WorkItemExternalLink | null;

  // Flattened fields returned by list APIs for compact table rendering.
  user_id?: number | null;
  external_id?: string | null;
  external_source?: IntegrationProvider | null;
  azure_assigned_to_id?: string | null;
  azure_assigned_to_name?: string | null;
  azure_assigned_to_unique_name?: string | null;
  azure_assignee_is_current_user?: number | null;
}

export interface TimeEntry {
  id: number;
  work_item_id: number;
  user_id: number;
  date: string; // YYYY-MM-DD format
  hours: number;
  created_at: Date;
}

export interface WorkItemWithTimeEntries extends Omit<WorkItem, "type"> {
  type: TrackableWorkItemType;
  timeEntries: Record<string, number>; // date -> hours
  totalHoursTracked?: number;
  assignedUserName?: string | null;
  assignedUserEmail?: string | null;
  isAssignedToCurrentUser?: boolean;
  azureAssignedToName?: string | null;
  azureAssignedToUniqueName?: string | null;
  isAzureAssignedToCurrentUser?: boolean | null;
  blockers?: Blocker[];
  checklistSummary?: {
    total: number;
    completed: number;
  };
}

export type TaskType = TrackableWorkItemType;
export type Task = WorkItem;
export type TaskWithTimeEntries = WorkItemWithTimeEntries;

export interface Settings {
  id: number;
  user_id?: number;
  project_id?: number;
  key: string;
  value: string;
  created_at: Date;
  updated_at: Date;
}

export interface AzureDevOpsSettings {
  organization: string;
  project: string;
  projectUrl?: string;
  pat: string;
  hasPat?: boolean;
}

export interface AiProviderSettings {
  baseUrl: string;
  model: string;
}

export interface AzureDevOpsWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  tags?: string[];
  isImported?: boolean;
}

export interface DayOff {
  id: number;
  user_id?: number;
  date: string; // YYYY-MM-DD format
  description?: string | null;
  is_half_day: number;
  created_at: Date;
}

export interface Release {
  id: number;
  user_id?: number;
  project_id?: number;
  name: string;
  start_date: string; // YYYY-MM-DD format
  end_date: string; // YYYY-MM-DD format
  display_order?: number | null;
  status: "active" | "completed";
  created_at: Date;
}

export interface ReleaseWorkItem {
  id: number;
  release_id: number;
  work_item_id?: number;
  title: string;
  description?: string | null;
  external_id?: string | null;
  external_source?: IntegrationProvider | null;
  work_item_type?: string | null;
  state?: string | null;
  tags?: string | null;
  notes?: string | null;
  task_id?: number | null;
  parent_work_item_id?: number | null;
  assignedUserId?: number | null;
  assignedUserName?: string | null;
  assignedUserEmail?: string | null;
  blockers?: Blocker[];
  display_order: number;
  created_at: Date;
}

export type BlockerSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Blocker {
  id: number;
  work_item_id: number;
  task_id?: number;
  comment: string;
  severity: BlockerSeverity;
  is_resolved: number; // SQLite uses 0/1 for boolean
  created_by_user_id?: number | null;
  created_at: Date;
  updated_by_user_id?: number | null;
  updated_at?: Date;
  resolved_at?: Date | null;
  resolved_by_user_id?: number | null;
  resolution_comment?: string | null;
}

export interface TaskWithBlockers extends Task {
  blockers: Blocker[];
}

export interface ChecklistItem {
  id: number;
  user_id?: number;
  work_item_id: number;
  task_id?: number;
  title: string;
  is_completed: number; // SQLite uses 0/1 for boolean
  display_order: number;
  created_by_user_id?: number | null;
  created_at: Date;
  updated_by_user_id?: number | null;
  updated_at?: Date;
  completed_at?: Date | null;
  locked_at?: Date | null;
}

export interface User {
  id: number;
  host_user_id: string;
  name: string;
  app_display_name?: string | null;
  email?: string | null;
  is_admin?: number;
  created_at: Date;
}

export interface Project {
  id: number;
  user_id?: number;
  name: string;
  description?: string | null;
  integration_provider?: IntegrationProvider;
  integration_enabled?: number;
  member_user_ids?: number[];
  created_at: Date;
  updated_at: Date;
}
