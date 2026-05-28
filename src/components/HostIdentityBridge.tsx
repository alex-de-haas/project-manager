"use client";

import { useEffect } from "react";

const readyMessage = { type: "docker-host:ready" };
const requestIdentityMessage = { type: "docker-host:request-identity" };
const bootstrapMarker = "project-manager:docker-host-identity-bootstrapped-at";
const bootstrapIdentityMarker = "project-manager:docker-host-identity-fingerprint";
const bootstrapExpiresAtMarker = "project-manager:docker-host-identity-expires-at";
const bootstrapRefreshSkewMs = 60 * 1000;
const bootstrapRetryMs = 1000;
const bootstrapRefreshTimeoutMs = 8000;
const bootstrapMinimumRefreshDelayMs = 5000;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

type HostIdentitySnapshot = {
  sub: string;
  email: string | null;
  name: string | null;
  hostRole: string | null;
  expiresAtMs?: number | null;
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
    let refreshId: number | null = null;
    let refreshWaitTimeoutId: number | null = null;
    let refreshWaiters: Array<(success: boolean) => void> = [];
    const originalFetch = window.fetch.bind(window);

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

    const stopScheduledRefresh = () => {
      if (refreshId) {
        window.clearTimeout(refreshId);
        refreshId = null;
      }
    };

    const finishPendingRefresh = (success: boolean) => {
      if (refreshWaitTimeoutId) {
        window.clearTimeout(refreshWaitTimeoutId);
        refreshWaitTimeoutId = null;
      }

      const waiters = refreshWaiters;
      refreshWaiters = [];
      for (const resolve of waiters) {
        resolve(success);
      }
    };

    const scheduleTokenRefresh = () => {
      stopScheduledRefresh();

      const expiresAtMs = getStoredTokenExpiresAtMs();
      if (!expiresAtMs) {
        return;
      }

      const delayMs = Math.max(
        bootstrapMinimumRefreshDelayMs,
        expiresAtMs - Date.now() - bootstrapRefreshSkewMs
      );
      refreshId = window.setTimeout(() => {
        void ensureFreshIdentity(true);
      }, delayMs);
    };

    const identityNeedsRefresh = () => {
      if (isIdentityMissing()) {
        return true;
      }

      if (!window.sessionStorage.getItem(bootstrapIdentityMarker)) {
        return true;
      }

      const expiresAtMs = getStoredTokenExpiresAtMs();
      return !expiresAtMs || expiresAtMs - Date.now() <= bootstrapRefreshSkewMs;
    };

    const ensureFreshIdentity = (force = false) => {
      if (!force && !identityNeedsRefresh()) {
        return Promise.resolve(true);
      }

      const shouldStartRequest = refreshWaiters.length === 0;
      const promise = new Promise<boolean>((resolve) => {
        refreshWaiters.push(resolve);
      });

      if (shouldStartRequest) {
        requestIdentity();
        refreshWaitTimeoutId = window.setTimeout(() => {
          finishPendingRefresh(false);
        }, bootstrapRefreshTimeoutMs);
      }

      return promise;
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
      const tokenIdentity = getTokenIdentitySnapshot(token);
      const tokenIdentityFingerprint = tokenIdentity ? identityFingerprint(tokenIdentity) : null;
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
      const storedExpiresAtMs = getStoredTokenExpiresAtMs();
      const needsRefresh = !storedExpiresAtMs || storedExpiresAtMs - now <= bootstrapRefreshSkewMs;

      if (!identityMissing && !identityChanged && !needsInitialFingerprint && !needsRefresh) {
        finishPendingRefresh(true);
        scheduleTokenRefresh();
        return;
      }

      if (bootstrapping) {
        return;
      }

      bootstrapping = true;
      try {
        const response = await originalFetch("/api/auth/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        if (!response.ok || disposed) {
          finishPendingRefresh(false);
          return;
        }

        window.sessionStorage.setItem(bootstrapMarker, String(Date.now()));
        if (tokenIdentityFingerprint) {
          window.sessionStorage.setItem(bootstrapIdentityMarker, tokenIdentityFingerprint);
        }
        if (tokenIdentity?.expiresAtMs) {
          window.sessionStorage.setItem(bootstrapExpiresAtMarker, String(tokenIdentity.expiresAtMs));
        }
        stopRetrying();
        scheduleTokenRefresh();
        finishPendingRefresh(!(identityMissing || identityChanged));
        if (identityMissing || identityChanged) {
          window.location.reload();
        }
      } finally {
        bootstrapping = false;
      }
    }

    const guardedFetch: typeof window.fetch = async (input, init) => {
      if (disposed) {
        return originalFetch(input, init);
      }

      const shouldGuard = shouldGuardApiFetch(input, init);
      const retryInput = shouldGuard ? cloneRetryInput(input) : null;

      if (shouldGuard && identityNeedsRefresh()) {
        const refreshed = await ensureFreshIdentity();
        if (!refreshed) {
          return identityRefreshRequiredResponse();
        }
      }

      const response = await originalFetch(input, init);
      if (shouldGuard && response.status === 401) {
        const refreshed = await ensureFreshIdentity(true);
        const finalRetryInput = retryInput ?? cloneRetryInput(input);
        if (refreshed && finalRetryInput) {
          return await originalFetch(finalRetryInput, init);
        }
      }

      return response;
    };

    const refreshOnActivation = () => {
      if (identityNeedsRefresh()) {
        void ensureFreshIdentity();
      }
    };

    window.fetch = guardedFetch;
    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", refreshOnActivation);
    window.addEventListener("pageshow", refreshOnActivation);
    document.addEventListener("visibilitychange", refreshOnActivation);
    window.parent.postMessage(readyMessage, hostOrigin ?? "*");
    requestIdentity();
    if (isIdentityMissing()) {
      retryId = window.setInterval(requestIdentity, bootstrapRetryMs);
    }
    scheduleTokenRefresh();

    return () => {
      disposed = true;
      stopRetrying();
      stopScheduledRefresh();
      finishPendingRefresh(false);
      if (window.fetch === guardedFetch) {
        window.fetch = originalFetch;
      }
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", refreshOnActivation);
      window.removeEventListener("pageshow", refreshOnActivation);
      document.removeEventListener("visibilitychange", refreshOnActivation);
    };
  }, []);

  return null;
}

function getTokenIdentitySnapshot(token: string): HostIdentitySnapshot | null {
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

    const exp = typeof payload.exp === "number" ? payload.exp : null;
    return {
      sub,
      email: normalizeString(payload.email),
      name: normalizeString(payload.name),
      hostRole: normalizeString(payload.hostRole),
      expiresAtMs: exp ? exp * 1000 : null,
    };
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

function getStoredTokenExpiresAtMs() {
  const value = Number(window.sessionStorage.getItem(bootstrapExpiresAtMarker) || "0");
  return Number.isFinite(value) && value > Date.now() ? value : null;
}

function shouldGuardApiFetch(input: FetchInput, init: FetchInit) {
  const url = getFetchUrl(input);
  if (!url || url.origin !== window.location.origin) {
    return false;
  }

  if (!url.pathname.startsWith("/api/") || url.pathname === "/api/auth/bootstrap") {
    return false;
  }

  if (!isSafelyRetryableFetch(input, init)) {
    return false;
  }

  return true;
}

function getFetchUrl(input: FetchInput) {
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.href);
    }

    if (input instanceof URL) {
      return new URL(input.toString(), window.location.href);
    }

    if (isRequest(input)) {
      return new URL(input.url, window.location.href);
    }
  } catch {
    return null;
  }

  return null;
}

function getFetchMethod(input: FetchInput, init: FetchInit) {
  const method = init?.method ?? (isRequest(input) ? input.method : "GET");
  return method.toUpperCase();
}

function cloneRetryInput(input: FetchInput) {
  if (!isRequest(input)) {
    return input;
  }

  try {
    return input.clone();
  } catch {
    return null;
  }
}

function isRequest(input: FetchInput): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function isSafelyRetryableFetch(input: FetchInput, init: FetchInit) {
  const method = getFetchMethod(input, init);
  if (method === "GET" || method === "HEAD") {
    return true;
  }

  return !fetchHasBody(input, init);
}

function fetchHasBody(input: FetchInput, init: FetchInit) {
  if (init && "body" in init && init.body !== undefined && init.body !== null) {
    return true;
  }

  return isRequest(input) && input.body !== null;
}

function identityRefreshRequiredResponse() {
  return new Response(
    JSON.stringify({
      error: "Docker Host identity refresh is required.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
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
