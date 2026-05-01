import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getAuthenticatedUserId } from "@/lib/auth";

export const isAdminUser = (userId: number): boolean => {
  const user = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(userId) as { is_admin?: number } | undefined;
  return user?.is_admin === 1;
};

export const requireAdminUser = (
  request: NextRequest
): { userId: number } | { response: NextResponse } => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (!isAdminUser(userId)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId };
};

export const canManageProject = (userId: number, projectId: number): boolean => {
  if (isAdminUser(userId)) return true;

  const project = db
    .prepare("SELECT user_id FROM projects WHERE id = ?")
    .get(projectId) as { user_id: number } | undefined;

  return project?.user_id === userId;
};
