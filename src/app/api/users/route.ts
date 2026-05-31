export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/authorization";
import { getHostDirectorySnapshot } from "@/lib/host-directory";
import { listHostBackedUsers, upsertHostDirectoryUsers, type HostBackedUser } from "@/lib/host-users";

const usersResponse = (users: HostBackedUser[], directoryStatus: string) =>
  NextResponse.json(users.map((user) => ({
    ...user,
    hostName: user.name,
    name: user.app_display_name || user.name,
  })), {
    headers: {
      "Cache-Control": "no-store",
      "X-Project-Manager-Host-Directory-Status": directoryStatus,
    },
  });

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const directory = await getHostDirectorySnapshot();
    const users =
      directory.status === "ok"
        ? upsertHostDirectoryUsers(directory.users)
        : listHostBackedUsers();

    return usersResponse(users, directory.status);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const directory = await getHostDirectorySnapshot();
    const users =
      directory.status === "ok"
        ? upsertHostDirectoryUsers(directory.users)
        : listHostBackedUsers();

    return usersResponse(users, directory.status);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to synchronize users" }, { status: 500 });
  }
}
