export type TaskType = 'task' | 'bug';

export interface Task {
  id: number;
  user_id?: number;
  project_id?: number;
  title: string;
  type: TaskType;
  status?: string | null;
  tags?: string | null;
  external_id?: string | null;
  external_source?: string | null;
  created_at: Date;
  completed_at?: Date | null;
}

export interface TimeEntry {
  id: number;
  task_id: number;
  date: string; // YYYY-MM-DD format
  hours: number;
  created_at: Date;
}

export interface TaskWithTimeEntries extends Task {
  timeEntries: Record<string, number>; // date -> hours
  blockers?: Blocker[];
  checklistSummary?: {
    total: number;
    completed: number;
  };
}

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
  pat: string;
}

export interface GeneralSettings {
  default_day_length: number;
}

export interface LMStudioSettings {
  endpoint: string;
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
  project_id?: number;
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
  user_id?: number;
  project_id?: number;
  release_id: number;
  title: string;
  external_id?: string | null;
  external_source?: string | null;
  work_item_type?: string | null;
  state?: string | null;
  tags?: string | null;
  notes?: string | null;
  task_id?: number | null;
  blockers?: Blocker[];
  display_order: number;
  created_at: Date;
}

export type BlockerSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Blocker {
  id: number;
  user_id?: number;
  project_id?: number;
  task_id: number;
  comment: string;
  severity: BlockerSeverity;
  is_resolved: number; // SQLite uses 0/1 for boolean
  created_at: Date;
  resolved_at?: Date | null;
  resolution_comment?: string | null;
}

export interface TaskWithBlockers extends Task {
  blockers: Blocker[];
}

export interface ChecklistItem {
  id: number;
  user_id?: number;
  project_id?: number;
  task_id: number;
  title: string;
  is_completed: number; // SQLite uses 0/1 for boolean
  display_order: number;
  created_at: Date;
  completed_at?: Date | null;
}

export interface User {
  id: number;
  name: string;
  email?: string | null;
  is_admin?: number;
  created_at: Date;
}

export interface Project {
  id: number;
  user_id?: number;
  name: string;
  member_user_ids?: number[];
  created_at: Date;
  updated_at: Date;
}
