import { NextRequest, NextResponse } from "next/server";
import { HOSTY_APP_IDENTITY_COOKIE } from "@/lib/host-identity";
import { exchangeHostyAppAuthorizationCode } from "@/lib/host-app-code";
import { hostyAppIdentityCookieOptions } from "@/lib/host-app-cookie";
import { describeOpaqueValue, logHostAuthDebug } from "@/lib/host-auth-debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOriginSignIn(request)) {
    return appAuthError("cross_site_request_blocked", "Sign-in must originate from this app.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const code =
    body && typeof body === "object" && "code" in body
      ? (body as { code?: unknown }).code
      : null;

  logHostAuthDebug("app-code endpoint received request", {
    code: describeOpaqueValue(typeof code === "string" ? code : null),
  });

  const result = await exchangeHostyAppAuthorizationCode(
    typeof code === "string" ? code : null,
    body && typeof body === "object" && "codeVerifier" in body
      ? (body as { codeVerifier?: unknown }).codeVerifier : null,
    "api-route"
  );
  if (!result.ok) {
    logHostAuthDebug("app-code endpoint exchange failed", {
      errorCode: result.code,
      status: result.status,
      message: result.message,
    });
    return appAuthError(result.code, result.message, result.status);
  }

  const appResponse = NextResponse.json(
    { ok: true, accessToken: result.accessToken },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
  appResponse.cookies.set(
    HOSTY_APP_IDENTITY_COOKIE,
    result.accessToken,
    hostyAppIdentityCookieOptions(request, result.maxAge)
  );
  logHostAuthDebug("app-code endpoint set identity cookie", {
    maxAge: result.maxAge,
  });

  return appResponse;
}

function appAuthError(code: string, message: string, status: number) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function isSameOriginSignIn(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  if (origin === null) return fetchSite === "same-origin";

  try {
    const source = new URL(origin);
    // Use the public Host header rather than the internal Next listen address behind a proxy.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
    const protocol = forwardedProto ? `${forwardedProto}:` : request.nextUrl.protocol;
    return (source.protocol === "http:" || source.protocol === "https:") &&
      source.origin === origin && source.host === host.toLowerCase() && source.protocol === protocol;
  } catch {
    return false;
  }
}
