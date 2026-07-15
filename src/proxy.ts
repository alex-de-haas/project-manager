import { NextRequest, NextResponse } from "next/server";
import {
  HOSTY_APP_IDENTITY_HEADER,
  HOSTY_APP_IDENTITY_COOKIE,
  INTERNAL_HOST_ROLE_HEADER,
  INTERNAL_HOST_LAUNCH_CODE_HEADER,
  INTERNAL_HOST_USER_EMAIL_HEADER,
  INTERNAL_HOST_USER_ID_HEADER,
  INTERNAL_HOST_USER_NAME_HEADER,
  revalidateHostyAppIdentityToken,
  requestHeadersWithTrustedHostIdentity,
} from "@/lib/host-identity";
import {
  describeOpaqueValue,
  describeUrlForAuth,
  logHostAuthDebug,
} from "@/lib/host-auth-debug";

const PUBLIC_PATHS = [
  "/api/auth/app-code",
  "/api/auth/identity",
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
    return NextResponse.next({
      request: {
        headers: stripInternalHeaders(request.headers),
      },
    });
  }

  const hasLaunchCode = isHostyLaunchCodeRequest(request, pathname);
  if (hasLaunchCode) {
    logHostAuthDebug("proxy detected launch code; leaving exchange to app-code bootstrap", {
      request: describeUrlForAuth(request.nextUrl),
      code: describeOpaqueValue(request.nextUrl.searchParams.get("code")),
    });
    return NextResponse.next({
      request: {
        headers: launchCodeBootstrapHeaders(request.headers),
      },
    });
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
    logHostAuthDebug("proxy rejecting request without trusted identity", {
      request: describeUrlForAuth(request.nextUrl),
      method: request.method,
      cookieToken: describeOpaqueValue(cookieToken),
      headerToken: describeOpaqueValue(headerToken),
    });
    return NextResponse.json(
      { error: "Hosty app identity is required" },
      { status: 401 }
    );
  }

  logHostAuthDebug("proxy allowing unauthenticated bootstrap navigation", {
    request: describeUrlForAuth(request.nextUrl),
    method: request.method,
    cookieToken: describeOpaqueValue(cookieToken),
    headerToken: describeOpaqueValue(headerToken),
  });

  return NextResponse.next({
    request: {
      headers: stripInternalHeaders(request.headers),
    },
  });
}

const isHostyLaunchCodeRequest = (request: NextRequest, pathname: string) =>
  request.method === "GET" &&
  !pathname.startsWith("/api/") &&
  Boolean(request.nextUrl.searchParams.get("code")?.trim());

const launchCodeBootstrapHeaders = (headers: Headers): Headers => {
  const cleanHeaders = stripInternalHeaders(headers);
  const remainingCookies = removeCookie(cleanHeaders.get("cookie"), HOSTY_APP_IDENTITY_COOKIE);
  cleanHeaders.set(INTERNAL_HOST_LAUNCH_CODE_HEADER, "1");
  if (remainingCookies) {
    cleanHeaders.set("cookie", remainingCookies);
  } else {
    cleanHeaders.delete("cookie");
  }
  return cleanHeaders;
};

const stripInternalHeaders = (headers: Headers): Headers => {
  const cleanHeaders = new Headers(headers);
  cleanHeaders.delete("authorization");
  cleanHeaders.delete("x-user-id");
  for (const key of Array.from(cleanHeaders.keys())) {
    if (key.toLowerCase().startsWith("x-docker-host-")) {
      cleanHeaders.delete(key);
    }
  }
  cleanHeaders.delete(INTERNAL_HOST_USER_ID_HEADER);
  cleanHeaders.delete(INTERNAL_HOST_USER_EMAIL_HEADER);
  cleanHeaders.delete(INTERNAL_HOST_USER_NAME_HEADER);
  cleanHeaders.delete(INTERNAL_HOST_ROLE_HEADER);
  cleanHeaders.delete(INTERNAL_HOST_LAUNCH_CODE_HEADER);
  return cleanHeaders;
};

const removeCookie = (cookieHeader: string | null, name: string) => {
  if (!cookieHeader) {
    return "";
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${name}=`))
    .join("; ");
};

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
