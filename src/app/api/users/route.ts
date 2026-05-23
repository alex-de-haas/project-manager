export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { User } from "@/types";
import { requireAdminUser } from "@/lib/authorization";
import { getHostDirectorySnapshot } from "@/lib/host-directory";
import { listHostBackedUsers, upsertHostDirectoryUsers, type HostBackedUser } from "@/lib/host-users";

const parseUserId = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const readString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getTargetHostUserId = (request: NextRequest, body: Record<string, unknown>) =>
  readString(request.nextUrl.searchParams.get("hostUserId")) ||
  readString(request.nextUrl.searchParams.get("host_user_id")) ||
  readString(body.hostUserId) ||
  readString(body.host_user_id);

const withDirectoryRole = (
  users: HostBackedUser[],
  hostRolesByUserId: Map<string, string | null>
) =>
  users.map((user) => ({
    ...user,
    host_role: hostRolesByUserId.get(user.host_user_id) ?? null,
  }));

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const directory = await getHostDirectorySnapshot();
    const hostRolesByUserId = new Map(
      directory.users.map((user) => [user.id, user.hostRole] as const)
    );
    const users =
      directory.status === "ok"
        ? withDirectoryRole(upsertHostDirectoryUsers(directory.users), hostRolesByUserId)
        : listHostBackedUsers();

    return NextResponse.json(users, {
      headers: {
        "Cache-Control": "no-store",
        "X-Project-Manager-Host-Directory-Status": directory.status,
      },
    });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const body = await request.json();
    const bodyRecord = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const hostUserId = getTargetHostUserId(request, bodyRecord);
    const userId = parseUserId(request.nextUrl.searchParams.get("id"));

    if (!hostUserId && !userId) {
      return NextResponse.json(
        { error: "hostUserId or valid user id is required" },
        { status: 400 }
      );
    }

    const hasIsAdmin = body?.is_admin !== undefined;
    const isAdmin =
      hasIsAdmin && typeof body?.is_admin === "boolean"
        ? (body.is_admin ? 1 : 0)
        : undefined;

    if (!hasIsAdmin) {
      return NextResponse.json({ error: "is_admin is required" }, { status: 400 });
    }
    if (hasIsAdmin && isAdmin === undefined) {
      return NextResponse.json({ error: "is_admin must be a boolean" }, { status: 400 });
    }

    const directory = await getHostDirectorySnapshot();
    if (directory.status === "ok") {
      upsertHostDirectoryUsers(directory.users);
      if (hostUserId && !directory.users.some((user) => user.id === hostUserId)) {
        return NextResponse.json(
          { error: "User is not assigned to this module" },
          { status: 404 }
        );
      }
    }

    const existingUser = hostUserId
      ? (db
          .prepare(
            "SELECT id, name, email, is_admin, host_user_id, created_at FROM users WHERE host_user_id = ?"
          )
          .get(hostUserId) as (HostBackedUser & { is_admin: number }) | undefined)
      : (db
          .prepare(
            "SELECT id, name, email, is_admin, host_user_id, created_at FROM users WHERE id = ? AND host_user_id IS NOT NULL"
          )
          .get(userId) as (HostBackedUser & { is_admin: number }) | undefined);

    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const nextIsAdmin = isAdmin ?? existingUser.is_admin;

    if (existingUser.is_admin === 1 && nextIsAdmin === 0) {
      const adminCount = db
        .prepare("SELECT COUNT(*) as total FROM users WHERE is_admin = 1")
        .get() as { total: number };
      if (adminCount.total <= 1) {
        return NextResponse.json(
          { error: "At least one administrator is required" },
          { status: 400 }
        );
      }
    }

    db.prepare("UPDATE users SET is_admin = ? WHERE host_user_id = ?").run(
      nextIsAdmin,
      existingUser.host_user_id
    );

    const updated = db
      .prepare("SELECT id, name, email, is_admin, host_user_id, created_at FROM users WHERE host_user_id = ?")
      .get(existingUser.host_user_id) as User;

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update user role" }, { status: 500 });
  }
}
