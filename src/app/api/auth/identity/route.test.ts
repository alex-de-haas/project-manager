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
