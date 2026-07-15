import { NextRequest, NextResponse } from "next/server";
import {
  classifyAppSessionStatus,
  HOSTY_APP_IDENTITY_COOKIE,
} from "@/lib/host-identity";
import { describeOpaqueValue, logHostAuthDebug } from "@/lib/host-auth-debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lightweight session-status probe for the client recovery bridge. Kept public in the
// proxy so an expired app session can still learn *why* it is unauthorized (expired vs
// denied vs Core-unreachable) instead of dead-ending on a blanket 401.
//
// This probe is intentionally cookie-only. It must never honor a caller-supplied
// Authorization / X-Docker-Host-Identity header: the route is public, so accepting
// header tokens would turn it into an unauthenticated oracle that revalidates
// attacker-chosen tokens against Core (a status probe + request amplifier). The
// recovery contract only ever concerns *this browser's* app session, which lives in the
// HttpOnly app identity cookie.
export async function GET(request: NextRequest) {
  const cookieToken = request.cookies.get(HOSTY_APP_IDENTITY_COOKIE)?.value?.trim() || null;
  const status = await classifyAppSessionStatus(cookieToken);

  logHostAuthDebug("identity probe classified session", {
    status,
    token: describeOpaqueValue(cookieToken),
  });

  return NextResponse.json(
    { appSession: { status } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
