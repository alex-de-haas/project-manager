import {
  getRecoveryParams,
  resolveAppSession,
  HOSTY_APP_IDENTITY_HEADER as SDK_IDENTITY_HEADER,
  type HostyAppConfig,
} from "@hosty-sdk/app/server";
import type { AppSessionStatus } from "@hosty-sdk/app";
import { PROJECT_MANAGER_APP_ID, getAppId } from "@/lib/module-runtime";

export const HOSTY_APP_IDENTITY_HEADER = SDK_IDENTITY_HEADER;
export const HOSTY_APP_IDENTITY_COOKIE = "project_manager_hosty_identity";
export const INTERNAL_HOST_USER_ID_HEADER = "x-project-manager-host-user-id";
export const INTERNAL_HOST_USER_EMAIL_HEADER = "x-project-manager-host-user-email";
export const INTERNAL_HOST_USER_NAME_HEADER = "x-project-manager-host-user-name";
export const INTERNAL_HOST_ROLE_HEADER = "x-project-manager-host-role";
export const INTERNAL_HOST_LAUNCH_CODE_HEADER = "x-project-manager-host-launch-code";

/** This app's SDK configuration: the cookie namespace stays app-owned, the host role passes
 * through unmapped (Project Manager keeps the raw Host role). The legacy PROJECT_MANAGER_APP_ID
 * env override predates HOSTY_APP_ID and is folded into the fallback. */
export const hostyAppConfig: HostyAppConfig = {
  appIdFallback: process.env.PROJECT_MANAGER_APP_ID?.trim() || PROJECT_MANAGER_APP_ID,
  identityCookieName: HOSTY_APP_IDENTITY_COOKIE,
};

export interface HostIdentityClaims {
  sub: string;
  aud: string;
  exp: number;
  email?: string;
  name?: string;
  hostRole?: string;
}

export interface TrustedHostIdentity {
  id: string;
  email: string | null;
  name: string | null;
  hostRole: string | null;
}

/** Recovery classification of the app session (the SDK taxonomy, consumed by the identity
 * probe route and the client bridge): not-present/expired are recoverable, forbidden is
 * terminal, unavailable is transient, misconfigured is an operator problem. */
export type { AppSessionStatus };

type HeaderReader = Pick<Headers, "get">;
type AppIdentityTokenSource = "cookie" | "authorization-header" | "identity-header";

const sanitizeHeaderValue = (value: string | null | undefined) =>
  value?.replace(/[\r\n]/g, " ").trim() ?? "";

const isExpiredByTimestamp = (expiresAt: string | null) => {
  if (!expiresAt) return true;
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= Date.now();
};

/**
 * Revalidates a token against Core via the SDK (30s positive cache, negatives never cached,
 * in-flight dedup) and maps the identity onto this app's claims shape. A grant Core reports
 * active but whose expiry is unusable or past is rejected, keeping the probe and the real
 * auth path in agreement about the same token.
 */
export const revalidateHostyAppIdentityToken = async (
  token: string | null | undefined
): Promise<HostIdentityClaims | null> => {
  const resolution = await resolveAppSession(token?.trim() || null, hostyAppConfig);
  if (resolution.status !== "active" || isExpiredByTimestamp(resolution.identity.expiresAt)) {
    return null;
  }

  const { identity } = resolution;
  return {
    sub: identity.userId,
    aud: getAppId(),
    exp: Math.floor(Date.parse(identity.expiresAt as string) / 1000),
    email: identity.email ?? undefined,
    name: identity.displayName ?? undefined,
    hostRole: identity.hostRole ?? undefined,
  };
};

/** Classifies a session token for the recovery bridge, honoring the platform contract via the
 * SDK; an active grant with an unusable or past expiry classifies as expired (recoverable). */
export const classifyAppSessionStatus = async (
  token: string | null | undefined
): Promise<AppSessionStatus> => {
  const resolution = await resolveAppSession(token?.trim() || null, hostyAppConfig);
  if (resolution.status === "active" && isExpiredByTimestamp(resolution.identity.expiresAt)) {
    return "expired";
  }
  return resolution.status;
};

/** Recovery parameters for the identity probe response (request-time env, never baked). */
export const readSessionRecoveryParams = () => getRecoveryParams(hostyAppConfig);

export const requestHeadersWithTrustedHostIdentity = (
  sourceHeaders: Headers,
  claims: HostIdentityClaims
) => {
  const headers = new Headers(sourceHeaders);
  headers.delete("authorization");
  headers.delete("x-user-id");
  for (const key of Array.from(headers.keys())) {
    if (key.toLowerCase().startsWith("x-docker-host-")) {
      headers.delete(key);
    }
  }
  headers.delete(INTERNAL_HOST_USER_ID_HEADER);
  headers.delete(INTERNAL_HOST_USER_EMAIL_HEADER);
  headers.delete(INTERNAL_HOST_USER_NAME_HEADER);
  headers.delete(INTERNAL_HOST_ROLE_HEADER);

  headers.set(INTERNAL_HOST_USER_ID_HEADER, sanitizeHeaderValue(claims.sub));
  if (claims.email) {
    headers.set(INTERNAL_HOST_USER_EMAIL_HEADER, sanitizeHeaderValue(claims.email));
  }
  if (claims.name) {
    headers.set(INTERNAL_HOST_USER_NAME_HEADER, sanitizeHeaderValue(claims.name));
  }
  if (claims.hostRole) {
    headers.set(INTERNAL_HOST_ROLE_HEADER, sanitizeHeaderValue(claims.hostRole));
  }

  return headers;
};

export const readTrustedHostIdentity = (headers: HeaderReader): TrustedHostIdentity | null => {
  const id = headers.get(INTERNAL_HOST_USER_ID_HEADER)?.trim();
  if (!id) return null;

  return {
    id,
    email: headers.get(INTERNAL_HOST_USER_EMAIL_HEADER)?.trim() || null,
    name: headers.get(INTERNAL_HOST_USER_NAME_HEADER)?.trim() || null,
    hostRole: headers.get(INTERNAL_HOST_ROLE_HEADER)?.trim() || null,
  };
};

export const resolveTrustedHostIdentity = async (
  headers: HeaderReader
): Promise<TrustedHostIdentity | null> => {
  const trustedIdentity = readTrustedHostIdentity(headers);
  if (trustedIdentity) {
    return trustedIdentity;
  }

  const tokenInput = readAppIdentityToken(headers);
  const claims = await revalidateHostyAppIdentityToken(tokenInput.token);
  if (!claims) {
    return null;
  }

  return {
    id: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
    hostRole: claims.hostRole ?? null,
  };
};

export const readAppIdentityToken = (
  headers: HeaderReader
): {
  token: string | null;
  source: AppIdentityTokenSource | null;
} => {
  const cookieToken = readCookie(headers.get("cookie"), HOSTY_APP_IDENTITY_COOKIE);
  if (cookieToken) {
    return { token: cookieToken, source: "cookie" };
  }

  const authorization = headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return { token: authorization.slice("Bearer ".length).trim(), source: "authorization-header" };
  }

  const identityHeader = headers.get(HOSTY_APP_IDENTITY_HEADER)?.trim();
  if (identityHeader) {
    return { token: identityHeader, source: "identity-header" };
  }

  return { token: null, source: null };
};

const readCookie = (cookieHeader: string | null, name: string) => {
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
};
