export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        host_user_id: user.host_user_id ?? null,
        name: user.name,
        email: user.email ?? null,
        is_admin: user.is_admin ?? 0,
      },
    });
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json({ error: "Failed to resolve session" }, { status: 500 });
  }
}
