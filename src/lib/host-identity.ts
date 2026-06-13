import { getAppId, getHostyCoreOrigin } from "@/lib/module-runtime";

export const HOSTY_APP_IDENTITY_HEADER = "x-docker-host-identity";
export const HOSTY_APP_IDENTITY_COOKIE = "project_manager_hosty_identity";
export const INTERNAL_HOST_USER_ID_HEADER = "x-project-manager-host-user-id";
export const INTERNAL_HOST_USER_EMAIL_HEADER = "x-project-manager-host-user-email";
export const INTERNAL_HOST_USER_NAME_HEADER = "x-project-manager-host-user-name";
export const INTERNAL_HOST_ROLE_HEADER = "x-project-manager-host-role";
export const INTERNAL_HOST_LAUNCH_CODE_HEADER = "x-project-manager-host-launch-code";

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
type AppIdentityTokenSource = "cookie" | "authorization-header" | "identity-header";

const CORE_AUTH_TIMEOUT_MS = 1500;
const TOKEN_REVALIDATION_CACHE_TTL_MS = 15_000;
const MAX_TOKEN_REVALIDATION_CACHE_ENTRIES = 256;

type TokenRevalidationCacheEntry = {
  claims: HostIdentityClaims | null;
  cachedAt: number;
};

const tokenRevalidationCache = new Map<string, TokenRevalidationCacheEntry>();
const pendingTokenRevalidations = new Map<string, Promise<HostIdentityClaims | null>>();

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

const getHostyAppServiceToken = () =>
  process.env.HOSTY_APP_SERVICE_TOKEN?.trim() || null;

export const revalidateHostyAppIdentityToken = async (
  token: string | null | undefined
): Promise<HostIdentityClaims | null> => {
  const accessToken = token?.trim();
  if (!accessToken) return null;

  const now = Date.now();
  const cached = readCachedTokenRevalidation(accessToken, now);
  if (cached !== undefined) {
    return cached;
  }

  const pending = pendingTokenRevalidations.get(accessToken);
  if (pending) {
    return pending;
  }

  const endpoint = buildCoreEndpoint("/api/auth/apps/revalidate");
  if (!endpoint) return null;
  const serviceToken = getHostyAppServiceToken();
  if (!serviceToken) return null;

  const revalidation = revalidateTokenWithCore(accessToken, endpoint, serviceToken);
  pendingTokenRevalidations.set(accessToken, revalidation);

  try {
    return await revalidation;
  } finally {
    pendingTokenRevalidations.delete(accessToken);
  }
};

const revalidateTokenWithCore = async (
  accessToken: string,
  endpoint: string,
  serviceToken: string
): Promise<HostIdentityClaims | null> => {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ accessToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_AUTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      writeCachedTokenRevalidation(accessToken, null);
      return null;
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || payload.active !== true) {
      writeCachedTokenRevalidation(accessToken, null);
      return null;
    }

    const appId = readString(payload.appId);
    const userId = readString(payload.userId);
    const expiresAtMs = readExpiresAtMs(payload.expiresAt);
    if (!appId || appId !== getAppId() || !userId || !expiresAtMs || expiresAtMs <= Date.now()) {
      writeCachedTokenRevalidation(accessToken, null);
      return null;
    }

    const claims = {
      sub: userId,
      aud: appId,
      exp: Math.floor(expiresAtMs / 1000),
      email: readString(payload.email) ?? undefined,
      name: readString(payload.displayName) ?? undefined,
      hostRole: readString(payload.hostRole) ?? undefined,
    };
    writeCachedTokenRevalidation(accessToken, claims);
    return claims;
  } catch {
    return null;
  }
};

const readCachedTokenRevalidation = (accessToken: string, now: number) => {
  const cached = tokenRevalidationCache.get(accessToken);
  if (!cached) {
    return undefined;
  }

  const tokenStillValid = !cached.claims || cached.claims.exp * 1000 > now;
  if (tokenStillValid && now - cached.cachedAt < TOKEN_REVALIDATION_CACHE_TTL_MS) {
    return cached.claims;
  }

  tokenRevalidationCache.delete(accessToken);
  return undefined;
};

const writeCachedTokenRevalidation = (
  accessToken: string,
  claims: HostIdentityClaims | null
) => {
  const now = Date.now();
  pruneTokenRevalidationCache(now);
  tokenRevalidationCache.set(accessToken, { claims, cachedAt: now });
};

const pruneTokenRevalidationCache = (now: number) => {
  if (tokenRevalidationCache.size < MAX_TOKEN_REVALIDATION_CACHE_ENTRIES) {
    return;
  }

  for (const [accessToken, cached] of tokenRevalidationCache) {
    const tokenExpired = cached.claims && cached.claims.exp * 1000 <= now;
    const cacheExpired = now - cached.cachedAt >= TOKEN_REVALIDATION_CACHE_TTL_MS;
    if (tokenExpired || cacheExpired) {
      tokenRevalidationCache.delete(accessToken);
    }
  }

  while (tokenRevalidationCache.size >= MAX_TOKEN_REVALIDATION_CACHE_ENTRIES) {
    const oldestAccessToken = tokenRevalidationCache.keys().next().value;
    if (!oldestAccessToken) {
      return;
    }
    tokenRevalidationCache.delete(oldestAccessToken);
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

  return trustedIdentityFromClaims(claims);
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

const trustedIdentityFromClaims = (claims: HostIdentityClaims): TrustedHostIdentity => ({
  id: claims.sub,
  email: claims.email ?? null,
  name: claims.name ?? null,
  hostRole: claims.hostRole ?? null,
});

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
