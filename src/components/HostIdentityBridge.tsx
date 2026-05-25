"use client";

import { useEffect } from "react";

const readyMessage = { type: "docker-host:ready" };
const requestIdentityMessage = { type: "docker-host:request-identity" };
const bootstrapMarker = "project-manager:docker-host-identity-bootstrapped-at";
const bootstrapRefreshMs = 4 * 60 * 1000;
const bootstrapRetryMs = 1000;

export function HostIdentityBridge() {
  useEffect(() => {
    if (window.parent === window) {
      return undefined;
    }

    let hostOrigin = getReferrerOrigin();

    let bootstrapping = false;
    let disposed = false;
    let retryId: number | null = null;

    const requestIdentity = () => {
      window.parent.postMessage(requestIdentityMessage, hostOrigin ?? "*");
    };

    const isIdentityMissing = () =>
      Boolean(document.querySelector("[data-project-manager-host-identity='missing']"));

    const stopRetrying = () => {
      if (retryId) {
        window.clearInterval(retryId);
        retryId = null;
      }
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
      const validOrigin =
        typeof expectedHostOrigin === "string"
          ? expectedHostOrigin === event.origin
          : hostOrigin === event.origin;
      if (
        event.source !== window.parent ||
        !validOrigin ||
        typeof token !== "string" ||
        !token.trim()
      ) {
        return;
      }

      hostOrigin = event.origin;
      const now = Date.now();
      const bootstrappedAt = Number(window.sessionStorage.getItem(bootstrapMarker) || "0");
      const identityMissing = isIdentityMissing();
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
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        if (!response.ok || disposed) {
          return;
        }

        window.sessionStorage.setItem(bootstrapMarker, String(now));
        stopRetrying();
        if (identityMissing) {
          window.location.reload();
        }
      } finally {
        bootstrapping = false;
      }
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(readyMessage, hostOrigin ?? "*");
    if (isIdentityMissing()) {
      requestIdentity();
      retryId = window.setInterval(requestIdentity, bootstrapRetryMs);
    } else {
      window.sessionStorage.setItem(bootstrapMarker, String(Date.now()));
    }
    const refreshId = window.setInterval(requestIdentity, bootstrapRefreshMs);

    return () => {
      disposed = true;
      stopRetrying();
      window.clearInterval(refreshId);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}

function getReferrerOrigin() {
  const ancestorOrigin = window.location.ancestorOrigins?.[0];
  if (ancestorOrigin) {
    return ancestorOrigin;
  }

  if (!document.referrer) {
    return null;
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}
