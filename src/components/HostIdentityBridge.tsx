"use client";

import { useEffect, useState } from "react";
import {
  describeOpaqueValue,
  describeUrlForAuth,
  logHostAuthDebug,
} from "@/lib/host-auth-debug";

type AppCodeExchangeResult =
  | { ok: true }
  | { ok: false; message: string };

const appCodeExchangeRequests = new Map<string, Promise<AppCodeExchangeResult>>();

export function HostIdentityBridge() {
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code")?.trim();
    logHostAuthDebug("bridge mounted", {
      location: describeUrlForAuth(url),
      code: describeOpaqueValue(code),
    });

    if (!code) {
      return undefined;
    }
    const authorizationCode = code;
    removeCodeFromUrl();

    let cancelled = false;

    async function exchangeInitialCode() {
      logHostAuthDebug("bridge starting initial exchange", {
        code: describeOpaqueValue(authorizationCode),
      });
      setPendingCode(authorizationCode);
      setErrorMessage(null);
      const result = await exchangeCode(authorizationCode);
      if (cancelled) {
        return;
      }

      if (result.ok) {
        logHostAuthDebug("bridge exchange succeeded; reloading");
        removeCodeFromUrl();
        window.location.reload();
      } else {
        logHostAuthDebug("bridge exchange failed", {
          message: result.message,
        });
        setErrorMessage(result.message);
      }
    }

    void exchangeInitialCode();

    return () => {
      cancelled = true;
    };
  }, []);

  async function retryExchange() {
    if (!pendingCode || isRetrying) {
      return;
    }

    setIsRetrying(true);
    setErrorMessage(null);
    logHostAuthDebug("bridge retrying exchange", {
      code: describeOpaqueValue(pendingCode),
    });
    const result = await exchangeCode(pendingCode);
    setIsRetrying(false);

    if (result.ok) {
      logHostAuthDebug("bridge retry succeeded; reloading");
      removeCodeFromUrl();
      window.location.reload();
    } else {
      logHostAuthDebug("bridge retry failed", {
        message: result.message,
      });
      setErrorMessage(result.message);
    }
  }

  if (!pendingCode || !errorMessage) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-lg">
        <h2 className="text-base font-semibold">Hosty authorization failed</h2>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void retryExchange()}
            disabled={isRetrying}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {isRetrying ? "Retrying..." : "Retry"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function exchangeCode(code: string): Promise<AppCodeExchangeResult> {
  const pending = appCodeExchangeRequests.get(code);
  if (pending) {
    return pending;
  }

  const request = exchangeCodeWithServer(code);
  appCodeExchangeRequests.set(code, request);

  try {
    return await request;
  } finally {
    appCodeExchangeRequests.delete(code);
  }
}

async function exchangeCodeWithServer(code: string): Promise<AppCodeExchangeResult> {
  try {
    logHostAuthDebug("bridge posting app code", {
      code: describeOpaqueValue(code),
    });
    const response = await fetch("/api/auth/app-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });

    logHostAuthDebug("bridge app-code response", {
      status: response.status,
      ok: response.ok,
    });

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      message: await readAppAuthError(response),
    };
  } catch (error) {
    logHostAuthDebug("bridge app-code request failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      message:
        error instanceof Error
          ? error.message
          : "Could not exchange Hosty authorization code.",
    });
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Could not exchange Hosty authorization code: ${error.message}`
          : "Could not exchange Hosty authorization code.",
    };
  }
}

async function readAppAuthError(response: Response) {
  const fallback = `Hosty authorization code exchange failed with HTTP ${response.status}.`;
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const error = (payload as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    return typeof message === "string" && message.trim() ? message.trim() : fallback;
  }

  const message = (payload as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

function removeCodeFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
