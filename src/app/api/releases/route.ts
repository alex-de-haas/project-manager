export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Release } from "@/types";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const releases = db
      .prepare("SELECT * FROM releases WHERE project_id = ? ORDER BY COALESCE(display_order, 999999) ASC, created_at ASC")
      .all(projectId) as Release[];
    return NextResponse.json(releases);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch releases" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { name, start_date, end_date } = body as {
      name?: string;
      start_date?: string;
      end_date?: string;
    };

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Release name is required" },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const startDate = start_date?.trim() || today;
    const endDate = end_date?.trim() || startDate;

    if (endDate < startDate) {
      return NextResponse.json(
        { error: "End date must be after start date" },
        { status: 400 }
      );
    }

    const stmt = db.prepare(
      "SELECT MAX(display_order) as max_order FROM releases WHERE project_id = ?"
    );
    const currentMax = stmt.get(projectId) as { max_order: number | null };
    const nextOrder = (currentMax.max_order ?? -1) + 1;

    const insertStmt = db.prepare(
      "INSERT INTO releases (user_id, project_id, name, start_date, end_date, display_order, status) VALUES (?, ?, ?, ?, ?, ?, 'active')"
    );
    const result = insertStmt.run(userId, projectId, name.trim(), startDate, endDate, nextOrder);

    const release = db
      .prepare("SELECT * FROM releases WHERE id = ? AND project_id = ?")
      .get(result.lastInsertRowid, projectId) as Release;

    return NextResponse.json(release, { status: 201 });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to create release" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { id, status, name } = body as {
      id?: number;
      status?: "active" | "completed";
      name?: string;
    };

    if (id === undefined || id === null) {
      return NextResponse.json(
        { error: "Release id is required" },
        { status: 400 }
      );
    }

    const releaseId = Number(id);
    if (Number.isNaN(releaseId)) {
      return NextResponse.json(
        { error: "Release id must be a number" },
        { status: 400 }
      );
    }

    if (status !== undefined && status !== "active" && status !== "completed") {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const updates: string[] = [];
    const values: Array<string | number> = [];

    if (status !== undefined) {
      updates.push("status = ?");
      values.push(status);
    }

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return NextResponse.json(
          { error: "Release name cannot be empty" },
          { status: 400 }
        );
      }
      updates.push("name = ?");
      values.push(trimmedName);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    values.push(releaseId, projectId);
    const stmt = db.prepare(`UPDATE releases SET ${updates.join(", ")} WHERE id = ? AND project_id = ?`);
    const result = stmt.run(...values);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    const release = db
      .prepare("SELECT * FROM releases WHERE id = ? AND project_id = ?")
      .get(releaseId, projectId) as Release;

    return NextResponse.json(release);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to update release" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const idParam = searchParams.get("id");

    if (!idParam) {
      return NextResponse.json(
        { error: "Release id is required" },
        { status: 400 }
      );
    }

    const id = Number(idParam);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: "Release id must be a number" },
        { status: 400 }
      );
    }

    const stmt = db.prepare("DELETE FROM releases WHERE id = ? AND project_id = ?");
    const result = stmt.run(id, projectId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Release not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to delete release" },
      { status: 500 }
    );
  }
}
