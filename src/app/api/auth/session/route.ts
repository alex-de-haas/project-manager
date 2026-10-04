export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getProjectsForUser } from "@/lib/projects";
import { getDefaultProjectIdForUser } from "@/lib/default-project";
import { getOptionalRequestProjectId } from "@/lib/user-context";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      projects: getProjectsForUser(user.id),
      activeProjectId: getOptionalRequestProjectId(request, user.id),
      defaultProjectId: getDefaultProjectIdForUser(user.id),
      user: {
        id: user.id,
        host_user_id: user.host_user_id,
        name: user.app_display_name || user.name,
        hostName: user.name,
        email: user.email ?? null,
        is_admin: user.is_admin ?? 0,
      },
    });
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json({ error: "Failed to resolve session" }, { status: 500 });
  }
}
