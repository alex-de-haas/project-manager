import { NextRequest, NextResponse } from "next/server";
import {
  HOSTY_APP_IDENTITY_COOKIE,
  LEGACY_DOCKER_HOST_IDENTITY_COOKIE,
  verifyDockerHostIdentityToken,
} from "@/lib/host-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const token =
    body && typeof body === "object" && "token" in body
      ? (body as { token?: unknown }).token
      : null;

  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json(
      {
        error: {
          code: "app_identity_token_required",
          message: "A Hosty app identity token is required.",
        },
      },
      { status: 422 }
    );
  }

  const claims = await verifyDockerHostIdentityToken(token);
  if (!claims) {
    return NextResponse.json(
      {
        error: {
          code: "app_identity_token_invalid",
          message: "The Hosty app identity token could not be verified.",
        },
      },
      { status: 401 }
    );
  }

  const secure = request.nextUrl.protocol === "https:";
  const maxAge = Math.min(5 * 60, claims.exp - Math.floor(Date.now() / 1000));
  if (maxAge <= 0) {
    return NextResponse.json(
      {
        error: {
          code: "app_identity_token_expired",
          message: "The Hosty app identity token has expired.",
        },
      },
      { status: 401 }
    );
  }

  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );

  response.cookies.set(HOSTY_APP_IDENTITY_COOKIE, token.trim(), {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  });
  response.cookies.delete({ name: LEGACY_DOCKER_HOST_IDENTITY_COOKIE, path: "/" });

  return response;
}
