import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "pm_auth";

const PUBLIC_PATHS = [
  "/login",
  "/invite",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/auth/bootstrap",
  "/api/auth/invite",
];

const isPublicPath = (pathname: string) => {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/icons/")) return true;
  return false;
};

const DEVELOPMENT_AUTH_SECRET = "local-dev-auth-secret-change-in-production";

const getAuthSecret = () => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") return null;
  return DEVELOPMENT_AUTH_SECRET;
};

const verifyToken = async (token: string | undefined): Promise<boolean> => {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const authSecret = getAuthSecret();
  if (!authSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  const signedBase64 = btoa(
    String.fromCharCode(...Array.from(new Uint8Array(signed)))
  );
  const expectedSignature = signedBase64
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

  if (expectedSignature !== signature) return false;

  try {
    const normalizedPayload = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalizedPayload + "=".repeat((4 - (normalizedPayload.length % 4 || 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as { exp?: number };
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = await verifyToken(authToken);

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && isAuthenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${pathname}${search}`;
  loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
