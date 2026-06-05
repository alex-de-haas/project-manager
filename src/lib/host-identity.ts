import { getAppId, getHostyCoreOrigin } from "@/lib/module-runtime";

export const HOSTY_APP_IDENTITY_HEADER = "x-docker-host-identity";
export const HOSTY_APP_IDENTITY_COOKIE = "project_manager_hosty_identity";
export const INTERNAL_HOST_USER_ID_HEADER = "x-project-manager-host-user-id";
export const INTERNAL_HOST_USER_EMAIL_HEADER = "x-project-manager-host-user-email";
export const INTERNAL_HOST_USER_NAME_HEADER = "x-project-manager-host-user-name";
export const INTERNAL_HOST_ROLE_HEADER = "x-project-manager-host-role";

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

type HeaderReader = Pick<Headers, "get">;

const CORE_AUTH_TIMEOUT_MS = 1500;

const sanitizeHeaderValue = (value: string | null | undefined) =>
  value?.replace(/[\r\n]/g, " ").trim() ?? "";

const readString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readExpiresAtMs = (value: unknown) => {
  const expiresAt = readString(value);
  if (!expiresAt) return null;

  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildCoreEndpoint = (path: string) => {
  const coreOrigin = getHostyCoreOrigin();
  if (!coreOrigin) return null;

  try {
    return new URL(path, coreOrigin).toString();
  } catch {
    return null;
  }
};

export const revalidateHostyAppIdentityToken = async (
  token: string | null | undefined
): Promise<HostIdentityClaims | null> => {
  const accessToken = token?.trim();
  if (!accessToken) return null;

  const endpoint = buildCoreEndpoint("/api/auth/apps/revalidate");
  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_AUTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || payload.active !== true) return null;

    const appId = readString(payload.appId);
    const userId = readString(payload.userId);
    const expiresAtMs = readExpiresAtMs(payload.expiresAt);
    if (!appId || appId !== getAppId() || !userId || !expiresAtMs || expiresAtMs <= Date.now()) {
      return null;
    }

    return {
      sub: userId,
      aud: appId,
      exp: Math.floor(expiresAtMs / 1000),
      email: readString(payload.email) ?? undefined,
      name: readString(payload.displayName) ?? undefined,
      hostRole: readString(payload.hostRole) ?? undefined,
    };
  } catch {
    return null;
  }
};

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
