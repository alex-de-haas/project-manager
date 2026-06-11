import type { NextRequest } from "next/server";

export function hostyAppIdentityCookieOptions(request: NextRequest, maxAge: number) {
  const secureCookie = shouldUseSecureAppCookie(request);

  return {
    httpOnly: true,
    sameSite: secureCookie ? "none" as const : "lax" as const,
    secure: secureCookie,
    path: "/",
    maxAge,
  };
}

function shouldUseSecureAppCookie(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();

  if (forwardedProto === "https" || request.nextUrl.protocol === "https:") {
    return true;
  }

  return false;
}
