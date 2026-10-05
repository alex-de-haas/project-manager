import { NextRequest, NextResponse } from "next/server";
import { resolveAppSession } from "@hosty-sdk/app/server";
import { classifyResolvedAppSession, hostyAppConfig, readAppIdentityToken, readSessionRecoveryParams } from "@/lib/host-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { token } = readAppIdentityToken(request.headers);
  const session = await resolveAppSession(token, hostyAppConfig);
  const status = classifyResolvedAppSession(session);
  const errorCode = session.status === "active" && status === "expired"
    ? "token_expired"
    : session.status === "expired" || session.status === "forbidden"
      ? safeRejectionCode(session.error?.code)
      : null;
  return NextResponse.json({
    status,
    recovery: await readSessionRecoveryParams(),
    ...(errorCode ? { error: { code: errorCode } } : {}),
    ...(status === "active" && session.status === "active" ? {
      activeUntil: session.identity.activeUntil,
      activityRequired: session.identity.activityRequired,
    } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
}

function safeRejectionCode(code: string | undefined): string | null {
  if (code === "app_identity_app_mismatch") return "token_app_mismatch";
  return code && ["token_invalid", "token_revoked", "token_expired", "token_app_mismatch", "reauth_required"].includes(code)
    ? code
    : null;
}
