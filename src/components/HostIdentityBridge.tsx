"use client";

import { useEffect, useState } from "react";
import {
  describeOpaqueValue,
  describeUrlForAuth,
  logHostAuthDebug,
} from "@/lib/host-auth-debug";
// Type-only import: erased at compile time, so the server-only host-identity module is
// never pulled into the client bundle. Single source of truth for the status contract.
import type { AppSessionStatus } from "@/lib/host-identity";

// Once-per-tab guard so a standalone app that returns from Core still unauthorized does not
// bounce through /open forever. Cleared on a successful code exchange.
const RECOVERY_GUARD_KEY = "hosty.auth.recovery-attempted";
// How long an embedded frame waits for Shell to reissue a launch code before showing the manual
// sign-in fallback (i.e. it is embedded by something other than Hosty Shell).
const EMBEDDED_RECOVERY_TIMEOUT_MS = 4_000;
// Cap the status probe so a stalled request cannot leave the bridge stuck hidden — on
// timeout it classifies as unavailable and the user gets a Retry affordance.
const IDENTITY_PROBE_TIMEOUT_MS = 4_000;

type RecoveryUi =
  | { kind: "hidden" }
  | { kind: "signin"; openUrl: string; embedded: boolean }
  | { kind: "denied" }
  | { kind: "unavailable" };

function readIdentityStatus(body: unknown): AppSessionStatus | null {
  if (!body || typeof body !== "object") return null;
  const session = (body as { appSession?: unknown }).appSession;
  if (!session || typeof session !== "object") return null;
  const status = (session as { status?: unknown }).status;
  return typeof status === "string" ? (status as AppSessionStatus) : null;
}

function buildOpenUrl(corePublicOrigin: string, appId: string): string | null {
  if (!corePublicOrigin) return null;
  try {
    const target = new URL(`/api/apps/${encodeURIComponent(appId)}/open`, corePublicOrigin);
    // Exclude any URL fragment: Core rejects redirect URIs with a fragment (redirect_uri_invalid),
    // and the fragment never survives a server redirect anyway.
    const { origin, pathname, search } = window.location;
    target.searchParams.set("redirectUri", `${origin}${pathname}${search}`);
    return target.toString();
  } catch {
    return null;
  }
}

export function HostIdentityBridge({
  corePublicOrigin,
  appId,
}: {
  corePublicOrigin: string;
  appId: string;
}) {
  const [ui, setUi] = useState<RecoveryUi>({ kind: "hidden" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const readGuard = () => {
      try {
        return window.sessionStorage.getItem(RECOVERY_GUARD_KEY) === "1";
      } catch {
        return false;
      }
    };
    const writeGuard = (value: boolean) => {
      try {
        if (value) {
          window.sessionStorage.setItem(RECOVERY_GUARD_KEY, "1");
        } else {
          window.sessionStorage.removeItem(RECOVERY_GUARD_KEY);
        }
      } catch {
        // sessionStorage may be blocked; recovery still works, only the once-per-tab guard is lost.
      }
    };

    async function probeAndRecover() {
      let status: AppSessionStatus | null;
      try {
        const response = await fetch("/api/auth/identity", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(IDENTITY_PROBE_TIMEOUT_MS),
          ]),
        });
        status = readIdentityStatus(await response.json().catch(() => null));
      } catch {
        // A failed or timed-out probe (Core unreachable) is treated like "unavailable":
        // keep the cookie, offer retry.
        status = null;
      }
      if (cancelled) return;

      logHostAuthDebug("bridge probe classified session", { status });

      if (status === "active") {
        setUi({ kind: "hidden" });
        return;
      }
      if (status === "forbidden") {
        // Terminal: signed in but not allowed. Never auto-redirect (would loop).
        setUi({ kind: "denied" });
        return;
      }
      if (status !== "not-present" && status !== "expired") {
        // "unavailable" / "error" / null: transient. Do not drop the session; let the user retry.
        setUi({ kind: "unavailable" });
        return;
      }

      const openUrl = buildOpenUrl(corePublicOrigin, appId);
      if (!openUrl) {
        // No browser-reachable Core origin configured — cannot redirect. Offer retry instead.
        logHostAuthDebug("bridge recovery unavailable: no Core public origin");
        setUi({ kind: "unavailable" });
        return;
      }

      if (window.self !== window.top) {
        // Embedded: the sandbox forbids top navigation, so ask Shell to reissue a code. The payload
        // carries no secret, so targetOrigin "*" is safe — Shell verifies the sender before acting.
        logHostAuthDebug("bridge embedded recovery: posting hosty:auth-required");
        try {
          window.parent.postMessage({ type: "hosty:auth-required", appId }, "*");
        } catch {
          // Ignore; the timeout below still falls back to the manual sign-in card.
        }
        const timeoutId = window.setTimeout(() => {
          if (!cancelled) {
            setUi({ kind: "signin", openUrl, embedded: true });
          }
        }, EMBEDDED_RECOVERY_TIMEOUT_MS);
        // Clear the pending fallback timer if the effect is torn down before it fires.
        controller.signal.addEventListener("abort", () => window.clearTimeout(timeoutId), {
          once: true,
        });
        return;
      }

      // Standalone: auto-recover once per tab, then fall back to an explicit sign-in button.
      if (!readGuard()) {
        writeGuard(true);
        logHostAuthDebug("bridge standalone recovery: redirecting to Core /open", {
          openUrl: describeUrlForAuth(new URL(openUrl)),
        });
        window.location.assign(openUrl);
        return;
      }
      logHostAuthDebug("bridge standalone recovery already attempted; showing sign-in");
      setUi({ kind: "signin", openUrl, embedded: false });
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code")?.trim();
    logHostAuthDebug("bridge mounted", {
      location: describeUrlForAuth(url),
      code: describeOpaqueValue(code),
    });

    if (code) {
      url.searchParams.delete("code");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      logHostAuthDebug("bridge starting code exchange", { code: describeOpaqueValue(code) });
      void fetch("/api/auth/app-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal: controller.signal,
      })
        .then((response) => {
          if (cancelled) return;
          if (response.ok) {
            logHostAuthDebug("bridge code exchange succeeded; reloading");
            writeGuard(false);
            window.location.reload();
          } else {
            logHostAuthDebug("bridge code exchange failed; probing", { status: response.status });
            void probeAndRecover();
          }
        })
        .catch(() => {
          if (!cancelled) {
            logHostAuthDebug("bridge code exchange request errored; probing");
            void probeAndRecover();
          }
        });
    } else {
      void probeAndRecover();
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [corePublicOrigin, appId]);

  if (ui.kind === "hidden") {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[100] flex flex-wrap items-center justify-center gap-3 border-t bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
    >
      {ui.kind === "signin" ? (
        <>
          <span className="font-medium">Your Hosty session ended.</span>
          <a
            href={ui.openUrl}
            {...(ui.embedded ? { target: "_blank", rel: "noreferrer" } : {})}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in via Hosty
          </a>
        </>
      ) : ui.kind === "denied" ? (
        <span className="font-medium">
          You are signed in to Hosty but are not allowed to use this app.
        </span>
      ) : (
        <>
          <span className="font-medium">Can&rsquo;t reach Hosty right now.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
