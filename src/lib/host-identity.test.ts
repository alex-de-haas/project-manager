import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAppSessionStatus } from "@/lib/host-identity";

const APP_ID = "com.haas.project-manager";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function futureIso(msFromNow = 60_000) {
  return new Date(Date.now() + msFromNow).toISOString();
}

describe("classifyAppSessionStatus", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.HOSTY_CORE_ORIGIN = "http://core.internal";
    process.env.HOSTY_APP_SERVICE_TOKEN = "svc-token";
    process.env.HOSTY_APP_ID = APP_ID;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.HOSTY_CORE_ORIGIN;
    delete process.env.HOSTY_APP_SERVICE_TOKEN;
    delete process.env.HOSTY_APP_ID;
  });

  it("returns not-present without a token, before any Core call", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await classifyAppSessionStatus(null)).toBe("not-present");
    expect(await classifyAppSessionStatus("   ")).toBe("not-present");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error when the app service token is not configured", async () => {
    delete process.env.HOSTY_APP_SERVICE_TOKEN;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await classifyAppSessionStatus("hostyg_token")).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Core 401 to expired (recoverable)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: { code: "token_expired" } })) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("expired");
  });

  it("maps Core 403 to forbidden (terminal)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: { code: "app_access_denied" } })) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("forbidden");
  });

  it("maps other non-OK statuses to error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: { code: "boom" } })) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("error");
  });

  it("returns active for a valid, unexpired, matching-app grant", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        active: true,
        appId: APP_ID,
        userId: "42",
        expiresAt: futureIso(),
      })
    ) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("active");
  });

  it("treats a token issued for a different app as forbidden", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        active: true,
        appId: "com.haas.other-app",
        userId: "42",
        expiresAt: futureIso(),
      })
    ) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("forbidden");
  });

  it("treats active:false as expired", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { active: false, appId: APP_ID, expiresAt: futureIso() })
    ) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("expired");
  });

  it("treats a past expiresAt as expired", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        active: true,
        appId: APP_ID,
        userId: "42",
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      })
    ) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("expired");
  });

  it("maps a Core timeout to unavailable (keep the session)", async () => {
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";
    global.fetch = vi.fn().mockRejectedValue(timeout) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("unavailable");
  });

  it("maps a generic network failure to error", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("connection refused")) as unknown as typeof fetch;
    expect(await classifyAppSessionStatus("hostyg_token")).toBe("error");
  });
});
