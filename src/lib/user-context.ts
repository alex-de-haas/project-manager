import type { NextRequest } from "next/server";
import db from "@/lib/db";
import { getAuthenticatedUserId } from "@/lib/auth";

export const PROJECT_COOKIE_NAME = "pm_project_id";
const DEFAULT_PROJECT_NAME = "Default";

export const getRequestUserId = (request: NextRequest): number => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    throw new Error("Docker Host identity is required");
  }
  return userId;
};

const parseProjectId = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const ensureDefaultProjectForUser = (userId: number): number => {
  const existingMembership = db
    .prepare(`
      SELECT p.id
      FROM project_members pm
      INNER JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ?
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT 1
    `)
    .get(userId) as { id: number } | undefined;

  if (existingMembership) {
    return existingMembership.id;
  }

  const projectInserted = db
    .prepare("INSERT INTO projects (user_id, name) VALUES (?, ?)")
    .run(userId, DEFAULT_PROJECT_NAME);
  const projectId = Number(projectInserted.lastInsertRowid);
  db.prepare(
    "INSERT OR IGNORE INTO project_members (project_id, user_id, added_by_user_id) VALUES (?, ?, ?)"
  ).run(projectId, userId, userId);
  return projectId;
};

const resolveKnownProjectId = (userId: number, candidateProjectId: number | null): number => {
  const fallbackProjectId = ensureDefaultProjectForUser(userId);

  if (!candidateProjectId) {
    return fallbackProjectId;
  }

  const project = db
    .prepare("SELECT project_id as id FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(candidateProjectId, userId) as { id: number } | undefined;

  return project ? candidateProjectId : fallbackProjectId;
};

export const getRequestProjectId = (
  request: NextRequest,
  resolvedUserId?: number
): number => {
  const userId = resolvedUserId ?? getRequestUserId(request);
  const fromHeader = parseProjectId(request.headers.get("x-project-id"));
  if (fromHeader) return resolveKnownProjectId(userId, fromHeader);

  const fromQuery = parseProjectId(request.nextUrl.searchParams.get("projectId"));
  if (fromQuery) return resolveKnownProjectId(userId, fromQuery);

  const fromCookie = parseProjectId(request.cookies.get(PROJECT_COOKIE_NAME)?.value);
  return resolveKnownProjectId(userId, fromCookie);
};
