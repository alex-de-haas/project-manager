export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { User } from "@/types";
import { createInvitationToken, hashInvitationToken, INVITATION_EXPIRY_SECONDS } from "@/lib/invitations";
import { requireAdminUser } from "@/lib/authorization";

const normalizeBaseUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return null;
  }
};

const getInvitationBaseUrl = (request: NextRequest): string => {
  const configured = normalizeBaseUrl(process.env.APP_BASE_URL ?? "");
  if (configured) {
    return configured;
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    if (host) {
      const forwardedProto = request.headers.get("x-forwarded-proto");
      const proto = forwardedProto?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
      const fromForwardedHeaders = normalizeBaseUrl(`${proto}://${host}`);
      if (fromForwardedHeaders) {
        return fromForwardedHeaders;
      }
    }
  }

  return request.nextUrl.origin;
};

const parseUserId = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeEmail = (value: unknown): string => {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const fallbackNameFromEmail = (email: string): string => {
  const [localPart] = email.split("@");
  return localPart || email;
};

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const users = db
      .prepare("SELECT id, name, email, is_admin, created_at FROM users ORDER BY created_at ASC")
      .all() as User[];
    return NextResponse.json(users);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const rawName = typeof body?.name === "string" ? body.name : "";
    const name = rawName.trim() || fallbackNameFromEmail(email);

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "User name is required" }, { status: 400 });
    }

    const existing = db
      .prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)")
      .get(email) as { id: number } | undefined;
    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    const invitationToken = createInvitationToken();
    const invitationTokenHash = hashInvitationToken(invitationToken);
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + INVITATION_EXPIRY_SECONDS;

    const createUserWithInvitation = db.transaction(() => {
      const count = db
        .prepare("SELECT COUNT(*) as total FROM users")
        .get() as { total: number };
      const isFirstUser = count.total === 0 ? 1 : 0;

      const result = db
        .prepare("INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, NULL, ?)")
        .run(name, email, isFirstUser);
      const user = db
        .prepare("SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?")
        .get(result.lastInsertRowid) as User;

      const projectResult = db
        .prepare("INSERT INTO projects (user_id, name, updated_at) VALUES (?, 'Default', CURRENT_TIMESTAMP)")
        .run(user.id);
      const defaultProjectId = Number(projectResult.lastInsertRowid);
      db.prepare(
        "INSERT OR IGNORE INTO project_members (project_id, user_id, added_by_user_id) VALUES (?, ?, ?)"
      ).run(defaultProjectId, user.id, user.id);

      db.prepare(
        "INSERT OR IGNORE INTO settings (user_id, project_id, key, value) VALUES (?, ?, ?, ?)"
      ).run(user.id, defaultProjectId, "default_day_length", "8");

      db.prepare("DELETE FROM user_invitations WHERE user_id = ?").run(user.id);
      db.prepare("INSERT INTO user_invitations (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .run(user.id, invitationTokenHash, expiresAtSeconds);
      return user;
    });

    const user = createUserWithInvitation();

    const inviteLink = `${getInvitationBaseUrl(request)}/invite?token=${encodeURIComponent(invitationToken)}`;
    return NextResponse.json(
      {
        ...user,
        invitation_link: inviteLink,
        invitation_expires_at: new Date(expiresAtSeconds * 1000).toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
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
    const hasName = body?.name !== undefined;
    const hasEmail = body?.email !== undefined;
    const hasIsAdmin = body?.is_admin !== undefined;
    const rawName = hasName && typeof body?.name === "string" ? body.name : "";
    const email = hasEmail ? normalizeEmail(body?.email) : undefined;
    const isAdmin =
      hasIsAdmin && typeof body?.is_admin === "boolean"
        ? (body.is_admin ? 1 : 0)
        : undefined;

    if (!hasName && !hasEmail && !hasIsAdmin) {
      return NextResponse.json({ error: "At least one field is required" }, { status: 400 });
    }
    if (hasName && !rawName.trim()) {
      return NextResponse.json({ error: "User name is required" }, { status: 400 });
    }
    if (hasEmail && (!email || !isValidEmail(email))) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }
    if (hasIsAdmin && isAdmin === undefined) {
      return NextResponse.json({ error: "is_admin must be a boolean" }, { status: 400 });
    }

    const existingUser = db
      .prepare("SELECT id, name, email, is_admin FROM users WHERE id = ?")
      .get(userId) as (User & { is_admin: number }) | undefined;
    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const nextName = hasName ? rawName.trim() : existingUser.name;
    const nextEmail = hasEmail ? email : existingUser.email;
    const nextIsAdmin = isAdmin ?? existingUser.is_admin;

    if (nextName !== existingUser.name) {
      const duplicateName = db
        .prepare("SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id != ?")
        .get(nextName, userId) as { id: number } | undefined;
      if (duplicateName) {
        return NextResponse.json({ error: "A user with this name already exists" }, { status: 409 });
      }
    }

    if (nextEmail !== existingUser.email) {
      const duplicateEmail = db
        .prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?")
        .get(nextEmail, userId) as { id: number } | undefined;
      if (duplicateEmail) {
        return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
      }
    }

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

    db.prepare("UPDATE users SET name = ?, email = ?, is_admin = ? WHERE id = ?").run(
      nextName,
      nextEmail,
      nextIsAdmin,
      userId
    );

    const updated = db
      .prepare("SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?")
      .get(userId) as User;

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to rename user" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const userId = parseUserId(request.nextUrl.searchParams.get("id"));
    if (!userId) {
      return NextResponse.json({ error: "Valid user id is required" }, { status: 400 });
    }

    const existingUser = db
      .prepare("SELECT id, is_admin FROM users WHERE id = ?")
      .get(userId) as { id: number; is_admin: number } | undefined;
    if (!existingUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const count = db
      .prepare("SELECT COUNT(*) as total FROM users")
      .get() as { total: number };
    if (count.total <= 1) {
      return NextResponse.json({ error: "At least one user is required" }, { status: 400 });
    }

    if (existingUser.is_admin === 1) {
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

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return NextResponse.json({ message: "User deleted" });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
