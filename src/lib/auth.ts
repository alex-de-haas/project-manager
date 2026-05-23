import type { NextRequest } from "next/server";
import { readTrustedHostIdentity } from "@/lib/host-identity";
import { ensureHostUser } from "@/lib/host-users";
import type { User } from "@/types";

export type AuthenticatedUser = User & { host_user_id?: string | null };

export const getAuthenticatedUser = (request: NextRequest): AuthenticatedUser | null => {
  const identity = readTrustedHostIdentity(request.headers);
  return identity ? ensureHostUser(identity) : null;
};

export const getAuthenticatedUserId = (request: NextRequest): number | null =>
  getAuthenticatedUser(request)?.id ?? null;
