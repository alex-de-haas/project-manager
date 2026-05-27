"use client";

import { useEffect } from "react";

const readyMessage = { type: "docker-host:ready" };
const requestIdentityMessage = { type: "docker-host:request-identity" };
const bootstrapMarker = "project-manager:docker-host-identity-bootstrapped-at";
const bootstrapIdentityMarker = "project-manager:docker-host-identity-fingerprint";
const bootstrapRefreshMs = 4 * 60 * 1000;
const bootstrapRetryMs = 1000;

type HostIdentitySnapshot = {
  sub: string;
  email: string | null;
  name: string | null;
  hostRole: string | null;
};

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
      const tokenIdentityFingerprint = getTokenIdentityFingerprint(token);
      const storedIdentityFingerprint = window.sessionStorage.getItem(bootstrapIdentityMarker);
      const renderedIdentityFingerprint = getRenderedIdentityFingerprint();
      const activeIdentityFingerprint = renderedIdentityFingerprint ?? storedIdentityFingerprint;
      const identityMissing = isIdentityMissing();
      const identityChanged = Boolean(
        tokenIdentityFingerprint &&
          activeIdentityFingerprint &&
          tokenIdentityFingerprint !== activeIdentityFingerprint
      );
      const needsInitialFingerprint = Boolean(tokenIdentityFingerprint && !storedIdentityFingerprint);
      const needsRefresh = now - bootstrappedAt >= bootstrapRefreshMs;

      if (!identityMissing && !identityChanged && !needsInitialFingerprint && !needsRefresh) {
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

        window.sessionStorage.setItem(bootstrapMarker, String(Date.now()));
        if (tokenIdentityFingerprint) {
          window.sessionStorage.setItem(bootstrapIdentityMarker, tokenIdentityFingerprint);
        }
        stopRetrying();
        if (identityMissing || identityChanged) {
          window.location.reload();
        }
      } finally {
        bootstrapping = false;
      }
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(readyMessage, hostOrigin ?? "*");
    requestIdentity();
    if (isIdentityMissing()) {
      retryId = window.setInterval(requestIdentity, bootstrapRetryMs);
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

function getTokenIdentityFingerprint(token: string) {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const sub = normalizeString(payload.sub);
    if (!sub) {
      return null;
    }

    return identityFingerprint({
      sub,
      email: normalizeString(payload.email),
      name: normalizeString(payload.name),
      hostRole: normalizeString(payload.hostRole),
    });
  } catch {
    return null;
  }
}

function getRenderedIdentityFingerprint() {
  const marker = document.querySelector<HTMLElement>("[data-project-manager-host-identity='present']");
  if (!marker) {
    return null;
  }

  const sub = normalizeString(marker.dataset.hostUserId);
  if (!sub) {
    return null;
  }

  return identityFingerprint({
    sub,
    email: normalizeString(marker.dataset.hostUserEmail),
    name: normalizeString(marker.dataset.hostUserName),
    hostRole: normalizeString(marker.dataset.hostRole),
  });
}

function identityFingerprint(snapshot: HostIdentitySnapshot) {
  return JSON.stringify({
    sub: snapshot.sub,
    email: snapshot.email,
    name: snapshot.name,
    hostRole: snapshot.hostRole,
  });
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
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
