import { NextRequest, NextResponse } from "next/server";
import {
  DOCKER_HOST_IDENTITY_HEADER,
  HOSTY_APP_IDENTITY_COOKIE,
  LEGACY_DOCKER_HOST_IDENTITY_COOKIE,
  requestHeadersWithTrustedHostIdentity,
  verifyDockerHostIdentityToken,
} from "@/lib/host-identity";

const PUBLIC_PATHS = [
  "/api/auth/bootstrap",
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

  const headerToken = request.headers.get(DOCKER_HOST_IDENTITY_HEADER)?.trim();
  const cookieToken =
    request.cookies.get(HOSTY_APP_IDENTITY_COOKIE)?.value?.trim() ||
    request.cookies.get(LEGACY_DOCKER_HOST_IDENTITY_COOKIE)?.value?.trim();
  const headerClaims = await verifyDockerHostIdentityToken(headerToken);
  const cookieClaims = headerClaims
    ? null
    : await verifyDockerHostIdentityToken(cookieToken);
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
