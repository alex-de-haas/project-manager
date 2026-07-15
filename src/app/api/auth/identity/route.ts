import { NextRequest, NextResponse } from "next/server";
import {
  classifyAppSessionStatus,
  readAppIdentityToken,
} from "@/lib/host-identity";
import { describeOpaqueValue, logHostAuthDebug } from "@/lib/host-auth-debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lightweight session-status probe for the client recovery bridge. Kept public in the
// proxy so an expired app session can still learn *why* it is unauthorized (expired vs
// denied vs Core-unreachable) instead of dead-ending on a blanket 401.
export async function GET(request: NextRequest) {
  const tokenInput = readAppIdentityToken(request.headers);
  const status = await classifyAppSessionStatus(tokenInput.token);

  logHostAuthDebug("identity probe classified session", {
    status,
    tokenSource: tokenInput.source,
    token: describeOpaqueValue(tokenInput.token),
  });

  return NextResponse.json(
    { appSession: { status } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
