import crypto from "crypto";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE_NAME = "pm_auth";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

interface SessionPayload {
  uid: number;
  exp: number;
}

const base64UrlEncode = (value: string) =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf-8");
};

const DEVELOPMENT_AUTH_SECRET = "local-dev-auth-secret-change-in-production";

const getAuthSecret = () => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production");
  }
  return DEVELOPMENT_AUTH_SECRET;
};

const signPayload = (payload: string) =>
  crypto
    .createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

export const createAuthToken = (userId: number): string => {
  const payload: SessionPayload = {
    uid: userId,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const verifyAuthToken = (
  token: string | null | undefined
): SessionPayload | null => {
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length) return null;
  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (!payload.uid || !payload.exp) return null;
    if (payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

export const getAuthenticatedUserId = (request: NextRequest): number | null => {
  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = verifyAuthToken(sessionToken);
  return payload?.uid ?? null;
};

export const getSessionMaxAgeSeconds = () => SESSION_MAX_AGE_SECONDS;
