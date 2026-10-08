import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearRevalidationCache } from "@hosty-sdk/app/server";
import { proxy } from "@/proxy";
import { GET } from "./route";

afterEach(() => { clearRevalidationCache(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function core(hostRole = "host.admin", expiresAt: string | null = new Date(Date.now() + 60000).toISOString()) {
  vi.stubEnv("HOSTY_APP_ID", "com.haas.project-manager");
  vi.stubEnv("HOSTY_CORE_ORIGIN", "https://core.test");
  vi.stubEnv("HOSTY_CORE_PUBLIC_ORIGIN", "https://core.test");
  vi.stubEnv("HOSTY_APP_SERVICE_TOKEN", "private-service");
  const fetcher = vi.fn(async (url: unknown) => {
    if (String(url).endsWith("/protocol")) return Response.json({ version: 2 });
    if (String(url).endsWith("/revalidate")) return Response.json({
      active: true, appId: "com.haas.project-manager", userId: "host-user", hostRole, expiresAt,
    });
    return Response.json({ required: ["users.directory"], optional: [], granted: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("allows unauthenticated readiness through the proxy without trusting forged identity", async () => {
  core();
  const request = new NextRequest("https://app.test/api/hosty/session", {
    headers: { "x-project-manager-host-user-id": "forged" },
  });
  const forwarded = await proxy(request);
  expect(forwarded.headers.get("x-middleware-next")).toBe("1");
  expect(forwarded.headers.get("x-middleware-request-x-project-manager-host-user-id")).toBeNull();
  expect(await (await GET(request)).json()).toMatchObject({ status: "not-present", recovery: { appAuthProtocol: 2 } });
});

it.each(["host.admin", "host.user"])("reports missing setup for %s with role-appropriate controls", async role => {
  const fetcher = core(role);
  const request = new NextRequest("https://app.test/api/hosty/session", {
    headers: { authorization: "Bearer hostyg_current", cookie: "project_manager_hosty_identity=stale" },
  });
  const forwarded = await proxy(request);
  expect(forwarded.headers.get("x-middleware-request-authorization")).toBe("Bearer hostyg_current");
  const response = await GET(request);
  const body = await response.json();
  expect(body).toMatchObject({ status: "active", userId: "host-user", hosty: { version: 1, setup: "missing" } });
  expect(Boolean(body.hosty.notice)).toBe(role === "host.admin");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(body)).not.toContain("private-service");
  const call = fetcher.mock.calls.find(([url]) => String(url).endsWith("/revalidate"));
  expect(call).toBeDefined();
});

it.each([null, "invalid", "2000-01-01T00:00:00Z"])("keeps unusable expiry %s blocked before checking setup", async expiresAt => {
  const fetcher = core("host.admin", expiresAt);
  const response = await GET(new Request("https://app.test/api/hosty/session", {
    headers: { cookie: "project_manager_hosty_identity=expired" },
  }));
  expect(await response.json()).toMatchObject({ status: "expired", error: { code: "token_expired" } });
  expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith("/permissions"))).toBe(true);
});
