import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getAuthenticatedUserId } from "@/lib/auth";
import { isAdminUser } from "@/lib/authorization";
import { canAccessProject, getDefaultProjectIdForUser } from "@/lib/default-project";

export const PROJECT_COOKIE_NAME = "pm_project_id";
export const PROJECT_USER_COOKIE_NAME = "pm_project_user_id";

export const getRequestUserId = (request: NextRequest): number => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    throw new Error("Hosty app identity is required");
  }
  return userId;
};

export class ProjectContextError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectContextError";
    this.status = status;
  }
}

export const projectContextErrorResponse = (error: unknown) => {
  if (error instanceof ProjectContextError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
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

const projectExists = (projectId: number): boolean => {
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(projectId) as { id: number } | undefined;
  return Boolean(project);
};

const resolveFallbackProjectId = (userId: number): number | null => {
  const fallbackProjectId = getFallbackProjectId(userId);
  return fallbackProjectId > 0 ? fallbackProjectId : null;
};

const resolveExplicitProjectId = (
  userId: number,
  candidateProjectId: number
): number => {
  if (canAccessProject(userId, candidateProjectId)) {
    return candidateProjectId;
  }

  if (projectExists(candidateProjectId)) {
    throw new ProjectContextError("Project access denied", 403);
  }

  throw new ProjectContextError("Project not found", 404);
};

export const getOptionalRequestProjectId = (
  request: NextRequest,
  resolvedUserId?: number
): number | null => {
  const userId = resolvedUserId ?? getRequestUserId(request);
  const fromHeader = parseProjectId(request.headers.get("x-project-id"));
  if (fromHeader) return resolveExplicitProjectId(userId, fromHeader);

  const fromQuery = parseProjectId(request.nextUrl.searchParams.get("projectId"));
  if (fromQuery) return resolveExplicitProjectId(userId, fromQuery);

  const cookieUserId = parseProjectId(request.cookies.get(PROJECT_USER_COOKIE_NAME)?.value);
  const fromCookie = cookieUserId === userId
    ? parseProjectId(request.cookies.get(PROJECT_COOKIE_NAME)?.value)
    : null;

  if (fromCookie && canAccessProject(userId, fromCookie)) {
    return fromCookie;
  }

  return resolveFallbackProjectId(userId);
};

export const getRequestProjectId = (
  request: NextRequest,
  resolvedUserId?: number
): number => {
  const projectId = getOptionalRequestProjectId(request, resolvedUserId);
  if (!projectId) {
    throw new ProjectContextError("An active project is required", 400);
  }
  return projectId;
};
