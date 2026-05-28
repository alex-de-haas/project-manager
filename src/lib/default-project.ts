import db from "@/lib/db";
import { isAdminUser } from "@/lib/authorization";

const DEFAULT_PROJECT_SETTING_PREFIX = "user_default_project:";

const getDefaultProjectSettingKey = (userId: number) =>
  `${DEFAULT_PROJECT_SETTING_PREFIX}${userId}`;

const parseProjectId = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const canAccessProject = (userId: number, projectId: number): boolean => {
  if (!Number.isInteger(projectId) || projectId <= 0) return false;

  if (isAdminUser(userId)) {
    const project = db
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(projectId) as { id: number } | undefined;
    return Boolean(project);
  }

  const membership = db
    .prepare("SELECT project_id FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId) as { project_id: number } | undefined;
  return Boolean(membership);
};

export const getDefaultProjectIdForUser = (userId: number): number | null => {
  const setting = db
    .prepare("SELECT value FROM module_settings WHERE key = ?")
    .get(getDefaultProjectSettingKey(userId)) as { value: string } | undefined;
  const projectId = parseProjectId(setting?.value);
  if (!projectId || !canAccessProject(userId, projectId)) {
    return null;
  }

  return projectId;
};

export const setDefaultProjectIdForUser = (userId: number, projectId: number) => {
  if (!canAccessProject(userId, projectId)) {
    throw new Error("Project is not available for this user");
  }

  db.prepare(`
    INSERT INTO module_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(getDefaultProjectSettingKey(userId), String(projectId));
};

export const clearDefaultProjectIdForUser = (userId: number) => {
  db.prepare("DELETE FROM module_settings WHERE key = ?").run(
    getDefaultProjectSettingKey(userId)
  );
};

export const clearDefaultProjectReferences = (projectId: number) => {
  db.prepare("DELETE FROM module_settings WHERE key LIKE ? AND value = ?").run(
    `${DEFAULT_PROJECT_SETTING_PREFIX}%`,
    String(projectId)
  );
};
