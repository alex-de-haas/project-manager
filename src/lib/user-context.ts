import type { NextRequest } from "next/server";
import db from "@/lib/db";
import { getAuthenticatedUserId } from "@/lib/auth";
import { isAdminUser } from "@/lib/authorization";
import { canAccessProject, getDefaultProjectIdForUser } from "@/lib/default-project";

export const PROJECT_COOKIE_NAME = "pm_project_id";
export const PROJECT_USER_COOKIE_NAME = "pm_project_user_id";

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

const getFallbackProjectId = (userId: number): number => {
  const defaultProjectId = getDefaultProjectIdForUser(userId);
  if (defaultProjectId) {
    return defaultProjectId;
  }

  if (isAdminUser(userId)) {
    const firstProject = db
      .prepare("SELECT id FROM projects ORDER BY created_at ASC, id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    return firstProject?.id ?? 0;
  }

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

  return existingMembership?.id ?? 0;
};

const resolveKnownProjectId = (userId: number, candidateProjectId: number | null): number => {
  const fallbackProjectId = getFallbackProjectId(userId);

  if (!candidateProjectId) {
    return fallbackProjectId;
  }

  return canAccessProject(userId, candidateProjectId)
    ? candidateProjectId
    : fallbackProjectId;
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

  const cookieUserId = parseProjectId(request.cookies.get(PROJECT_USER_COOKIE_NAME)?.value);
  const fromCookie = cookieUserId === userId
    ? parseProjectId(request.cookies.get(PROJECT_COOKIE_NAME)?.value)
    : null;
  return resolveKnownProjectId(userId, fromCookie);
};
