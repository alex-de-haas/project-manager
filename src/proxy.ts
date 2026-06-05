import { NextRequest, NextResponse } from "next/server";
import {
  HOSTY_APP_IDENTITY_HEADER,
  HOSTY_APP_IDENTITY_COOKIE,
  revalidateHostyAppIdentityToken,
  requestHeadersWithTrustedHostIdentity,
} from "@/lib/host-identity";

const PUBLIC_PATHS = [
  "/api/auth/app-code",
  "/api/health",
];

const isPublicPath = (pathname: string) => {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/icons/")) return true;
  return false;
};

const isUnsafeMethod = (method: string) =>
  !["GET", "HEAD", "OPTIONS"].includes(method);

const isCrossSiteCookieMutation = (request: NextRequest, pathname: string) =>
  pathname.startsWith("/api/") &&
  isUnsafeMethod(request.method) &&
  request.headers.get("sec-fetch-site") === "cross-site";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization")?.trim();
  const bearerToken = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const headerToken =
    bearerToken || request.headers.get(HOSTY_APP_IDENTITY_HEADER)?.trim() || null;
  const cookieToken = request.cookies.get(HOSTY_APP_IDENTITY_COOKIE)?.value?.trim();
  const headerClaims = await revalidateHostyAppIdentityToken(headerToken);
  const cookieClaims = headerClaims
    ? null
    : await revalidateHostyAppIdentityToken(cookieToken);
  const claims = headerClaims ?? cookieClaims;

  if (claims) {
    if (cookieClaims && isCrossSiteCookieMutation(request, pathname)) {
      return NextResponse.json(
        { error: "Cross-site app identity cookie requests are not allowed" },
        { status: 403 }
      );
    }

    return NextResponse.next({
      request: {
        headers: requestHeadersWithTrustedHostIdentity(request.headers, claims),
      },
    });
  }

  if (pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) {
    return NextResponse.json(
      { error: "Hosty app identity is required" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
