"use client";

import { useEffect } from "react";

const readyMessage = { type: "docker-host:ready" };
const requestIdentityMessage = { type: "docker-host:request-identity" };
const bootstrapMarker = "project-manager:docker-host-identity-bootstrapped-at";
const bootstrapRefreshMs = 4 * 60 * 1000;

export function HostIdentityBridge() {
  useEffect(() => {
    if (window.parent === window) {
      return undefined;
    }

    const hostOrigin = getReferrerOrigin();
    if (!hostOrigin) {
      return undefined;
    }

    let bootstrapping = false;
    let disposed = false;

    const requestIdentity = () => {
      window.parent.postMessage(requestIdentityMessage, hostOrigin);
    };

    async function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== "docker-host:identity"
      ) {
        return;
      }

      const token = (data as { token?: unknown }).token;
      const expectedHostOrigin = (data as { hostOrigin?: unknown }).hostOrigin;
      if (
        event.source !== window.parent ||
        event.origin !== hostOrigin ||
        (typeof expectedHostOrigin === "string" && expectedHostOrigin !== event.origin) ||
        typeof token !== "string" ||
        !token.trim()
      ) {
        return;
      }

      const now = Date.now();
      const bootstrappedAt = Number(window.sessionStorage.getItem(bootstrapMarker) || "0");
      const identityMissing = Boolean(
        document.querySelector("[data-project-manager-host-identity='missing']")
      );
      if (!identityMissing && now - bootstrappedAt < bootstrapRefreshMs) {
        return;
      }

      if (bootstrapping) {
        return;
      }

      bootstrapping = true;
      try {
        const response = await fetch("/api/auth/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({ token }),
        });

        if (!response.ok || disposed) {
          return;
        }

        window.sessionStorage.setItem(bootstrapMarker, String(now));
        if (identityMissing) {
          window.location.reload();
        }
      } finally {
        bootstrapping = false;
      }
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(readyMessage, hostOrigin);
    const refreshId = window.setInterval(requestIdentity, bootstrapRefreshMs);

    return () => {
      disposed = true;
      window.clearInterval(refreshId);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}

function getReferrerOrigin() {
  if (!document.referrer) {
    return null;
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}
