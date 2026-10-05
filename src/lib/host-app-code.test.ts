import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeHostyAppAuthorizationCode } from "./host-app-code";

const verifier = "v".repeat(43);

beforeEach(() => {
  vi.stubEnv("HOSTY_CORE_ORIGIN", "https://core.test");
  vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", "  hosty_app_service.project-manager  ");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("exchangeHostyAppAuthorizationCode", () => {
  it("authenticates code exchange with the app service token and forwards the initiating proof without redirects", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ accessToken: "hostyg_project-manager", expiresInSeconds: 600 })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeHostyAppAuthorizationCode("  authorization-code  ", verifier)).toEqual({
      ok: true,
      accessToken: "hostyg_project-manager",
      maxAge: 600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://core.test/api/auth/apps/token",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer hosty_app_service.project-manager",
        },
        body: JSON.stringify({ code: "authorization-code", codeVerifier: verifier }),
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it.each([undefined, "", "   "])(
    "fails locally when the service token is missing (%s)",
    async (serviceToken) => {
      vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", serviceToken);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      expect(await exchangeHostyAppAuthorizationCode("authorization-code", verifier)).toEqual({
        ok: false,
        code: "app_service_token_missing",
        message: "HOSTY_APP_SERVICE_TOKEN is not configured.",
        status: 503,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("still rejects a missing authorization code before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeHostyAppAuthorizationCode("   ", verifier)).toMatchObject({
      ok: false,
      code: "app_auth_code_required",
      status: 422,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves Core refusal details (nested: %s)", async (nested) => {
    const error = { code: "invalid_code", message: "Invalid authorization code." };
    const payload = nested ? { error } : error;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload, { status: 401 })));

    expect(await exchangeHostyAppAuthorizationCode("authorization-code", verifier)).toEqual({
      ok: false,
      ...error,
      status: 401,
    });
  });
});

it.each([undefined, null, "", "short", "x".repeat(129), " "+verifier])("rejects missing or malformed proof locally (%s)", async proof => {
  const fetchMock=vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await exchangeHostyAppAuthorizationCode("leaked-code", proof)).toMatchObject({ ok: false, status: 400, code: "code_verifier_required" });
  expect(fetchMock).not.toHaveBeenCalled();
});
