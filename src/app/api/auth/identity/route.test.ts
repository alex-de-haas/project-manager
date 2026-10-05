import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearRevalidationCache } from "@hosty-sdk/app/server";
import { GET } from "./route";
import { proxy } from "@/proxy";

afterEach(() => { clearRevalidationCache(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("returns recovery details without identity", async () => {
  vi.stubEnv("HOSTY_APP_ID", "com.haas.project-manager");
  vi.stubEnv("HOSTY_CORE_PUBLIC_ORIGIN", "https://core.test");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const response = await GET(new NextRequest("https://app.test/api/auth/identity"));
  expect(await response.json()).toMatchObject({ status: "not-present", recovery: { appId: "com.haas.project-manager" } });
  expect(fetch).not.toHaveBeenCalled();
});
it("revalidates a popup bearer grant ahead of a stale cookie and returns activity metadata", async () => {
  vi.stubEnv("HOSTY_APP_ID", "com.haas.project-manager");
  vi.stubEnv("HOSTY_CORE_ORIGIN", "https://core.test");
  vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", "service-token");
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json({
    active: true, appId: "com.haas.project-manager", userId: "user_1",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    activeUntil: "2030-01-01T00:00:00Z", activityRequired: true,
  }));
  vi.stubGlobal("fetch", fetch);
  const response = await GET(new NextRequest("https://app.test/api/auth/identity", {
    headers: { authorization: "Bearer hostyg_fresh", cookie: "project_manager_hosty_identity=stale" },
  }));
  expect(await response.json()).toMatchObject({ status: "active", activityRequired: true, activeUntil: "2030-01-01T00:00:00Z" });
  expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({ accessToken: "hostyg_fresh" });
});
it("preserves probe token inputs while removing forged trusted identity", async () => {
  const response = await proxy(new NextRequest("https://app.test/api/auth/identity", {
    headers: { authorization: "Bearer hostyg_fresh", "x-project-manager-host-user-id": "forged" },
  }));
  expect(response.headers.get("x-middleware-request-authorization")).toBe("Bearer hostyg_fresh");
  expect(response.headers.get("x-middleware-request-x-project-manager-host-user-id")).toBeNull();
});

it.each([undefined, null, "not-a-date", "2000-01-01T00:00:00Z"])(
  "reports expired rather than active for unusable expiry %s", async expiresAt => {
    vi.stubEnv("HOSTY_APP_ID", "com.haas.project-manager");
    vi.stubEnv("HOSTY_CORE_ORIGIN", "https://core.test");
    vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", "service-token");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      active: true, appId: "com.haas.project-manager", userId: "user_1",
      expiresAt, activeUntil: "2030-01-01T00:00:00Z", activityRequired: true,
    })));
    const response = await GET(new NextRequest("https://app.test/api/auth/identity", {
      headers: { authorization: "Bearer hostyg_expired" },
    }));
    const body = await response.json();
    expect(body.status).toBe("expired");
    expect(body.error).toEqual({ code: "token_expired" });
    expect(body).not.toHaveProperty("activeUntil");
    expect(body).not.toHaveProperty("activityRequired");
  }
);

function mockCoreRevalidation(body: unknown, status = 200) {
  vi.stubEnv("HOSTY_APP_ID", "com.haas.project-manager");
  vi.stubEnv("HOSTY_CORE_ORIGIN", "https://core.test");
  vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", "service-token");
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) =>
    String(url).endsWith("/api/auth/apps/revalidate")
      ? Response.json(body, { status })
      : Response.json({ version: 2 })
  ));
}

it.each([
  [401, "token_invalid", "expired"],
  [401, "token_revoked", "expired"],
  [401, "token_expired", "expired"],
  [403, "token_app_mismatch", "forbidden"],
  [403, "reauth_required", "forbidden"],
] as const)("forwards only the safe %s/%s rejection code", async (status, code, expectedStatus) => {
  mockCoreRevalidation({ error: { code, message: "secret token/proof diagnostics" } }, status);
  const response = await GET(new NextRequest("https://app.test/api/auth/identity", {
    headers: { authorization: "Bearer hostyg_rejected" },
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ status: expectedStatus, error: { code } });
  expect(body.error).toEqual({ code });
  expect(JSON.stringify(body)).not.toContain("secret token/proof diagnostics");
});

it("normalizes a resolved app-audience mismatch to the browser cleanup code", async () => {
  mockCoreRevalidation({ active: true, appId: "foreign.app", userId: "user_1" });
  const response = await GET(new NextRequest("https://app.test/api/auth/identity", {
    headers: { authorization: "Bearer hostyg_wrong_app" },
  }));
  expect(await response.json()).toMatchObject({ status: "forbidden", error: { code: "token_app_mismatch" } });
});

it.each([
  [403, { error: { code: "arbitrary-secret-code", message: "secret" } }, "forbidden"],
  [503, { error: { code: "token_revoked", message: "secret" } }, "unavailable"],
] as const)("does not expose unrecognized or transient rejection details (%s)", async (status, payload, expectedStatus) => {
  mockCoreRevalidation(payload, status);
  const response = await GET(new NextRequest("https://app.test/api/auth/identity", {
    headers: { authorization: "Bearer hostyg_unknown" },
  }));
  const body = await response.json();
  expect(body.status).toBe(expectedStatus);
  expect(body).not.toHaveProperty("error");
});

it("keeps network failures transient without a cleanup rejection", async () => {
  vi.stubEnv("HOSTY_CORE_ORIGIN", "https://core.test");
  vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", "service-token");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("secret transport diagnostics"); }));
  const response = await GET(new NextRequest("https://app.test/api/auth/identity", {
    headers: { authorization: "Bearer hostyg_temporary" },
  }));
  const body = await response.json();
  expect(body.status).toBe("unavailable");
  expect(body).not.toHaveProperty("error");
});
