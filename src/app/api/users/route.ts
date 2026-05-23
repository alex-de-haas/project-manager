export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { User } from "@/types";
import { requireAdminUser } from "@/lib/authorization";

const parseUserId = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const users = db
      .prepare(`
        SELECT id, name, email, is_admin, created_at
        FROM users
        WHERE host_user_id IS NOT NULL
        ORDER BY created_at ASC
      `)
      .all() as User[];
    return NextResponse.json(users);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const userId = parseUserId(request.nextUrl.searchParams.get("id"));
    if (!userId) {
      return NextResponse.json({ error: "Valid user id is required" }, { status: 400 });
    }

    const body = await request.json();
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

    const existingUser = db
      .prepare("SELECT id, name, email, is_admin FROM users WHERE id = ? AND host_user_id IS NOT NULL")
      .get(userId) as (User & { is_admin: number }) | undefined;
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

    db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(
      nextIsAdmin,
      userId
    );

    const updated = db
      .prepare("SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?")
      .get(userId) as User;

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update user role" }, { status: 500 });
  }
}
