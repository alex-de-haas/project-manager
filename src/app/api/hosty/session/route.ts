import { resolveAppSession } from "@hosty-sdk/app/server";
import { createHostySessionResponse } from "@hosty-sdk/app/session/server";
import {
  classifyResolvedAppSession,
  hostyAppConfig,
  readAppIdentityToken,
  readSessionRecoveryParams,
} from "@/lib/host-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { token } = readAppIdentityToken(request.headers);
  const [session, recovery] = await Promise.all([
    resolveAppSession(token, hostyAppConfig),
    readSessionRecoveryParams(),
  ]);
  // Keep the probe consistent with Project Manager's existing local expiry check.
  const classified = session.status === "active" && classifyResolvedAppSession(session) === "expired"
    ? { status: "expired" as const, error: { code: "token_expired", message: "App access expired.", status: 401 } }
    : session;
  return createHostySessionResponse(classified, recovery, { signal: request.signal });
}
