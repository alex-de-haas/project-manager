import { NextRequest, NextResponse } from "next/server";
import { resolveAppSession } from "@hosty-sdk/app/server";
import { classifyResolvedAppSession, hostyAppConfig, readAppIdentityToken, readSessionRecoveryParams } from "@/lib/host-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { token } = readAppIdentityToken(request.headers);
  const session = await resolveAppSession(token, hostyAppConfig);
  const status = classifyResolvedAppSession(session);
  return NextResponse.json({
    status,
    recovery: await readSessionRecoveryParams(),
    ...(status === "active" && session.status === "active" ? {
      activeUntil: session.identity.activeUntil,
      activityRequired: session.identity.activityRequired,
    } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
}
