export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  clearDefaultProjectIdForUser,
  getDefaultProjectIdForUser,
  setDefaultProjectIdForUser,
} from "@/lib/default-project";
import { getRequestUserId } from "@/lib/user-context";

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    return NextResponse.json({
      projectId: getDefaultProjectIdForUser(userId),
    });
  } catch (error) {
    console.error("Default project error:", error);
    return NextResponse.json(
      { error: "Failed to fetch default project" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const body = await request.json();
    const projectId = Number(body?.projectId);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json(
        { error: "Valid project ID is required" },
        { status: 400 }
      );
    }

    setDefaultProjectIdForUser(userId, projectId);
    return NextResponse.json({ projectId });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Project is not available for this user"
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error("Default project error:", error);
    return NextResponse.json(
      { error: "Failed to set default project" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    clearDefaultProjectIdForUser(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Default project error:", error);
    return NextResponse.json(
      { error: "Failed to clear default project" },
      { status: 500 }
    );
  }
}
