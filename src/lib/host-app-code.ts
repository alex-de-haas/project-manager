import { getHostyCoreOrigin } from "@/lib/module-runtime";
import {
  describeEndpointOrigin,
  describeOpaqueValue,
  logHostAuthDebug,
} from "@/lib/host-auth-debug";

const CORE_TOKEN_EXCHANGE_TIMEOUT_MS = 1500;

type TokenExchangeResponse = {
  accessToken?: unknown;
  expiresInSeconds?: unknown;
};

export type HostyAppCodeExchangeResult =
  | {
      ok: true;
      accessToken: string;
      maxAge: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
    };

export async function exchangeHostyAppAuthorizationCode(
  code: string | null | undefined,
  codeVerifier: unknown,
  source = "unknown"
): Promise<HostyAppCodeExchangeResult> {
  const authorizationCode = code?.trim();
  if (!authorizationCode) {
    logHostAuthDebug("exchange skipped: missing code", { source });
    return appAuthError(
      "app_auth_code_required",
      "A Hosty app authorization code is required.",
      422
    );
  }

  if (typeof codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    return appAuthError("code_verifier_required", "A valid sign-in proof is required.", 400);
  }

  const serviceToken = process.env.HOSTY_APP_SERVICE_TOKEN?.trim();
  if (!serviceToken) {
    logHostAuthDebug("exchange skipped: app service token is not configured", { source });
    return appAuthError(
      "app_service_token_missing",
      "HOSTY_APP_SERVICE_TOKEN is not configured.",
      503
    );
  }

  const endpoint = buildTokenEndpoint();
  if (!endpoint) {
    logHostAuthDebug("exchange skipped: Core origin is not configured", {
      source,
    });
    return appAuthError("core_origin_invalid", "HOSTY_CORE_ORIGIN is not configured.", 503);
  }

  logHostAuthDebug("exchange started", {
    source,
    code: describeOpaqueValue(authorizationCode),
    coreOrigin: describeEndpointOrigin(endpoint),
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ code: authorizationCode, codeVerifier }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_TOKEN_EXCHANGE_TIMEOUT_MS),
    });
  } catch (error) {
    logHostAuthDebug("exchange request failed", {
      source,
      code: describeOpaqueValue(authorizationCode),
      coreOrigin: describeEndpointOrigin(endpoint),
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : "Core token exchange is unavailable.",
    });
    return appAuthError(
      isAbortError(error) ? "core_token_exchange_timeout" : "core_token_exchange_unavailable",
      error instanceof Error ? error.message : "Core token exchange is unavailable.",
      503
    );
  }

  const payload = (await response.json().catch(() => null)) as TokenExchangeResponse | null;
  logHostAuthDebug("exchange response received", {
    source,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    logHostAuthDebug("exchange rejected by Core", {
      source,
      status: response.status,
      errorCode: readErrorCode(payload) || "app_auth_code_exchange_failed",
      message: readErrorMessage(payload) || `Core token exchange returned HTTP ${response.status}.`,
    });
    return appAuthError(
      readErrorCode(payload) || "app_auth_code_exchange_failed",
      readErrorMessage(payload) || `Core token exchange returned HTTP ${response.status}.`,
      response.status
    );
  }

  const accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
  if (!accessToken) {
    logHostAuthDebug("exchange response missing token", { source });
    return appAuthError(
      "app_identity_token_missing",
      "Core token exchange did not return an app identity token.",
      502
    );
  }

  const maxAge =
    typeof payload?.expiresInSeconds === "number" && Number.isFinite(payload.expiresInSeconds)
      ? Math.max(1, Math.floor(payload.expiresInSeconds))
      : 5 * 60;

  logHostAuthDebug("exchange succeeded", {
    source,
    maxAge,
    token: describeOpaqueValue(accessToken),
  });

  return {
    ok: true,
    accessToken,
    maxAge,
  };
}

function buildTokenEndpoint() {
  const coreOrigin = getHostyCoreOrigin();
  if (!coreOrigin) return null;

  try {
    return new URL("/api/auth/apps/token", coreOrigin).toString();
  } catch {
    return null;
  }
}

function appAuthError(
  code: string,
  message: string,
  status: number
): HostyAppCodeExchangeResult {
  return {
    ok: false,
    code,
    message,
    status,
  };
}

function readErrorCode(payload: unknown) {
  return readErrorField(payload, "code");
}

function readErrorMessage(payload: unknown) {
  return readErrorField(payload, "message");
}

function readErrorField(payload: unknown, field: "code" | "message") {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    return readString((error as Record<string, unknown>)[field]);
  }

  return readString((payload as Record<string, unknown>)[field]);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
