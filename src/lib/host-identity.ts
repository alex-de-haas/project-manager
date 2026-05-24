import { getDockerHostInternalOrigin, getModuleId } from "@/lib/module-runtime";

export const DOCKER_HOST_IDENTITY_HEADER = "x-docker-host-identity";
export const DOCKER_HOST_IDENTITY_COOKIE = "project_manager_module_identity";
export const INTERNAL_HOST_USER_ID_HEADER = "x-project-manager-host-user-id";
export const INTERNAL_HOST_USER_EMAIL_HEADER = "x-project-manager-host-user-email";
export const INTERNAL_HOST_USER_NAME_HEADER = "x-project-manager-host-user-name";
export const INTERNAL_HOST_ROLE_HEADER = "x-project-manager-host-role";

export interface HostIdentityClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  hostRole?: string;
  moduleAccess?: string;
  moduleExposurePolicy?: string;
  email?: string;
  name?: string;
  endpointKey?: string;
}

export interface TrustedHostIdentity {
  id: string;
  email: string | null;
  name: string | null;
  hostRole: string | null;
}

type HeaderReader = Pick<Headers, "get">;

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JsonWebKeySet {
  keys?: HostJsonWebKey[];
}

type HostJsonWebKey = JsonWebKey & {
  alg?: string;
  kid?: string;
};

const JWKS_CACHE_MS = 5 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const JWT_EXPIRATION_LEEWAY_SECONDS = 60;

let jwksCache:
  | {
      url: string;
      fetchedAt: number;
      keys: HostJsonWebKey[];
    }
  | null = null;

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const base64UrlToJson = <T>(value: string): T => {
  const bytes = base64UrlToBytes(value);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
};

const hasAudience = (audience: string | string[], expected: string) =>
  Array.isArray(audience) ? audience.includes(expected) : audience === expected;

const sanitizeHeaderValue = (value: string | null | undefined) =>
  value?.replace(/[\r\n]/g, " ").trim() ?? "";

const resolveJwksUrl = async (): Promise<string | null> => {
  const configured = process.env.DOCKER_HOST_IDENTITY_JWKS_URL?.trim();
  if (configured) return configured;

  const origin = getDockerHostInternalOrigin();
  if (!origin) return null;

  const discoveryUrl = `${origin}/.well-known/docker-host/module-identity.json`;
  try {
    const response = await fetch(discoveryUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      const data = (await response.json()) as { jwksUrl?: string; jwks_uri?: string };
      const discovered = data.jwksUrl || data.jwks_uri;
      if (discovered) {
        return new URL(discovered, origin).toString();
      }
    }
  } catch {
    // Fall back to the documented JWKS path when discovery is unavailable.
  }

  return `${origin}/.well-known/docker-host/jwks.json`;
};

const fetchJwks = async (url: string): Promise<HostJsonWebKey[]> => {
  const now = Date.now();
  if (jwksCache && jwksCache.url === url && now - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Docker Host JWKS: ${response.status}`);
  }

  const jwks = (await response.json()) as JsonWebKeySet;
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  jwksCache = { url, fetchedAt: now, keys };
  return keys;
};

const isSupportedAlgorithm = (algorithm: string | undefined) =>
  algorithm === "ES256" || algorithm === "RS256";

const selectVerificationKey = (keys: HostJsonWebKey[], header: JwtHeader) => {
  if (header.kid) {
    const matching = keys.find(
      (key) => key.kid === header.kid && (!header.alg || !key.alg || key.alg === header.alg)
    );
    if (matching) return matching;
  }

  if (header.alg === "ES256") {
    return keys.find((key) => key.kty === "EC" && (!key.alg || key.alg === header.alg));
  }

  if (header.alg === "RS256") {
    return keys.find((key) => key.kty === "RSA" && (!key.alg || key.alg === header.alg));
  }

  return undefined;
};

const importVerificationKey = async (jwk: HostJsonWebKey, algorithm: string) => {
  if (algorithm === "ES256") {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  }

  if (algorithm === "RS256") {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  }

  return null;
};

const getVerifyAlgorithm = (algorithm: string) => {
  if (algorithm === "ES256") {
    return { name: "ECDSA", hash: "SHA-256" } as const;
  }

  if (algorithm === "RS256") {
    return { name: "RSASSA-PKCS1-v1_5" } as const;
  }

  return null;
};

export const verifyDockerHostIdentityToken = async (
  token: string | null | undefined
): Promise<HostIdentityClaims | null> => {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  try {
    const header = base64UrlToJson<JwtHeader>(encodedHeader);
    if (!isSupportedAlgorithm(header.alg)) return null;

    const claims = base64UrlToJson<HostIdentityClaims>(encodedPayload);
    if (claims.iss !== "docker-host") return null;
    if (!claims.sub || !claims.aud || !hasAudience(claims.aud, getModuleId())) return null;
    if (
      typeof claims.exp !== "number" ||
      claims.exp + JWT_EXPIRATION_LEEWAY_SECONDS <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    const jwksUrl = await resolveJwksUrl();
    if (!jwksUrl) return null;

    const jwk = selectVerificationKey(await fetchJwks(jwksUrl), header);
    if (!jwk) return null;

    const key = await importVerificationKey(jwk, header.alg);
    const verifyAlgorithm = getVerifyAlgorithm(header.alg);
    if (!key || !verifyAlgorithm) return null;
    const signature = base64UrlToBytes(encodedSignature) as BufferSource;
    const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`) as BufferSource;

    const isValid = await crypto.subtle.verify(
      verifyAlgorithm,
      key,
      signature,
      signedData
    );

    return isValid ? claims : null;
  } catch {
    return null;
  }
};

export const requestHeadersWithTrustedHostIdentity = (
  sourceHeaders: Headers,
  claims: HostIdentityClaims
) => {
  const headers = new Headers(sourceHeaders);
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
