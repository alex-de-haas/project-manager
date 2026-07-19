import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRevalidationCache } from "@hosty-sdk/app/server";
import { classifyAppSessionStatus, revalidateHostyAppIdentityToken } from "@/lib/host-identity";

const ENV_KEYS = ["HOSTY_CORE_ORIGIN", "HOSTY_APP_ID", "HOSTY_APP_SERVICE_TOKEN"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const activePayload = () => ({
  active: true,
  appId: "com.haas.project-manager",
  userId: "user_1",
  email: "user@example.com",
  displayName: "User",
  hostRole: "host.admin",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.HOSTY_CORE_ORIGIN = "http://core.test";
  process.env.HOSTY_APP_ID = "com.haas.project-manager";
  process.env.HOSTY_APP_SERVICE_TOKEN = "hosty_app_service.1.x.y";
  // The SDK keeps a process-global positive cache; isolate every test.
  clearRevalidationCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  vi.unstubAllGlobals();
});

describe("classifyAppSessionStatus", () => {
  it("returns not-present without a token, before any Core call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await classifyAppSessionStatus(null)).toBe("not-present");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns misconfigured when the app service token is not configured", async () => {
    delete process.env.HOSTY_APP_SERVICE_TOKEN;
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("misconfigured");
  });

  it("maps Core 401 to expired (recoverable)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { code: "token_expired" })));
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("expired");
  });

  it("maps Core 403 to forbidden (terminal)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(403, { code: "user_disabled" })));
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("forbidden");
  });

  it("maps other non-OK statuses and network failures to unavailable (transient)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { code: "boom" })));
    expect(await classifyAppSessionStatus("hostyg_a")).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await classifyAppSessionStatus("hostyg_b")).toBe("unavailable");
  });

  it("returns active for a valid, unexpired, matching-app grant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, activePayload())));
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("active");
  });

  it("treats a token issued for a different app as forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ...activePayload(), appId: "other.app" })),
    );
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("forbidden");
  });

  it("does not classify an active grant with no userId as active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ...activePayload(), userId: "" })),
    );
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("expired");
  });

  it("treats active:false as expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ...activePayload(), active: false })),
    );
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("expired");
  });

  it("treats a past expiresAt as expired (probe/auth-path consistency)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ...activePayload(), expiresAt: new Date(Date.now() - 1000).toISOString() }),
      ),
    );
    expect(await classifyAppSessionStatus("hostyg_x")).toBe("expired");
  });
});

describe("revalidateHostyAppIdentityToken", () => {
  it("maps a valid grant onto the claims shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, activePayload())));
    const claims = await revalidateHostyAppIdentityToken("hostyg_x");
    expect(claims).toMatchObject({
      sub: "user_1",
      aud: "com.haas.project-manager",
      email: "user@example.com",
      name: "User",
      hostRole: "host.admin",
    });
    expect(claims && claims.exp * 1000).toBeGreaterThan(Date.now());
  });

  it("rejects a grant whose expiry is past, matching the probe classification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { ...activePayload(), expiresAt: new Date(Date.now() - 1000).toISOString() }),
      ),
    );
    expect(await revalidateHostyAppIdentityToken("hostyg_x")).toBeNull();
  });

  it("returns null for any non-active classification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, {})));
    expect(await revalidateHostyAppIdentityToken("hostyg_x")).toBeNull();
  });
});
