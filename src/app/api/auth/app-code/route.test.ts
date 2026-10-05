import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { exchangeHostyAppAuthorizationCode } from "@/lib/host-app-code";
import { POST } from "./route";

vi.mock("@/lib/host-app-code", () => ({ exchangeHostyAppAuthorizationCode: vi.fn() }));
vi.mock("@/lib/host-auth-debug", () => ({ describeOpaqueValue: vi.fn(), logHostAuthDebug: vi.fn() }));

const code = "valid-one-time-code";
const codeVerifier = "v".repeat(43);
const exchange = vi.mocked(exchangeHostyAppAuthorizationCode);

beforeEach(() => {
  exchange.mockReset();
  exchange.mockResolvedValue({ ok: true, accessToken: "hostyg_project-manager", maxAge: 600 });
});
afterEach(() => vi.unstubAllEnvs());

function signInRequest(headers: Record<string, string>, url = "https://app.test/api/auth/app-code") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ code, codeVerifier }),
  });
}

describe("app-code browser request boundary", () => {
  it.each([
    ["foreign origin", { origin: "https://attacker.test" }],
    ["foreign origin despite same-origin metadata", { origin: "https://attacker.test", "sec-fetch-site": "same-origin" }],
    ["opaque origin", { origin: "null" }],
    ["opaque origin despite same-origin metadata", { origin: "null", "sec-fetch-site": "same-origin" }],
    ["absent browser provenance", {}],
    ["absent origin with cross-site metadata", { "sec-fetch-site": "cross-site" }],
    ["malformed origin", { origin: "not a URL" }],
    ["malformed origin despite same-origin metadata", { origin: "not a URL", "sec-fetch-site": "same-origin" }],
    ["origin containing a path", { origin: "https://app.test/another-path" }],
    ["origin containing credentials", { origin: "https://attacker@app.test" }],
    ["origin containing a query", { origin: "https://app.test?code=secret" }],
    ["different port", { origin: "https://app.test:4430" }],
    ["different scheme without Fetch Metadata", { origin: "http://app.test" }],
    ["different scheme despite same-origin metadata", { origin: "http://app.test", "sec-fetch-site": "same-origin" }],
    ["same-site request", { origin: "https://app.test", "sec-fetch-site": "same-site" }],
    ["foreign simple text/plain POST", { origin: "https://attacker.test", "sec-fetch-site": "cross-site", "content-type": "text/plain" }],
  ] as const)("refuses %s before parsing or exchanging a valid code", async (_name, headers) => {
    const request = signInRequest(headers);
    const parse = vi.spyOn(request, "json");
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "cross_site_request_blocked" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(parse).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each([
    ["same-origin browser", { origin: "https://app.test", "sec-fetch-site": "same-origin" }],
    ["same-origin Origin without Fetch Metadata", { origin: "https://app.test" }],
    ["same-origin Fetch Metadata without Origin", { "sec-fetch-site": "same-origin" }],
  ] as const)("accepts %s and returns the app-owned cookie", async (_name, headers) => {
    const response = await POST(signInRequest(headers));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, accessToken: "hostyg_project-manager" });
    expect(exchange).toHaveBeenCalledExactlyOnceWith(code, codeVerifier, "api-route");
    expect(response.headers.get("set-cookie")).toContain("project_manager_hosty_identity=hostyg_project-manager");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([false, true])("accepts the public HTTPS Host behind an internal HTTP listener (metadata: %s)", async metadata => {
    const headers: Record<string, string> = {
      origin: "https://pm.test:5443", host: "pm.test:5443", "x-forwarded-proto": "https",
    };
    if (metadata) headers["sec-fetch-site"] = "same-origin";
    const response = await POST(signInRequest(headers, "http://127.0.0.1:3100/api/auth/app-code"));
    expect(response.status).toBe(200);
    expect(exchange).toHaveBeenCalledExactlyOnceWith(code, codeVerifier, "api-route");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});

it.each<[string, Record<string, string>, string]>([
  ["https://app.test", {}, "http://app.test/api/auth/app-code"],
  ["http://pm.test:5443", { host: "pm.test:5443", "x-forwarded-proto": "https" }, "http://127.0.0.1:3100/api/auth/app-code"],
])("refuses wrong-scheme Origin %s including public proxy forwarding", async (origin, headers, url) => {
  const request = signInRequest({ origin, ...headers }, url);
  const parse = vi.spyOn(request, "json");
  const response = await POST(request);
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(parse).not.toHaveBeenCalled();
  expect(exchange).not.toHaveBeenCalled();
});


it.each([
  ["https", 443, false],
  ["https", 443, true],
  ["http", 80, false],
  ["http", 80, true],
] as const)("normalizes an explicit default public Host port (%s:%s, metadata: %s)", async (scheme, port, metadata) => {
  const headers: Record<string, string> = {
    origin: `${scheme}://pm.test`, host: `pm.test:${port}`, "x-forwarded-proto": scheme,
  };
  if (metadata) headers["sec-fetch-site"] = "same-origin";
  const response = await POST(signInRequest(headers, "http://127.0.0.1:3100/api/auth/app-code"));
  expect(response.status).toBe(200);
  expect(exchange).toHaveBeenCalledExactlyOnceWith(code, codeVerifier, "api-route");
  expect(response.headers.get("set-cookie")).toContain("project_manager_hosty_identity=hostyg_project-manager");
});

it.each(["https://pm.test:443", "http://pm.test:80"])("normalizes a default Host port without proxy headers (%s)", async publicUrl => {
  const response = await POST(signInRequest({
    origin: new URL(publicUrl).origin,
    host: publicUrl.slice(publicUrl.indexOf("://") + 3),
  }, `${publicUrl}/api/auth/app-code`));
  expect(response.status).toBe(200);
  expect(exchange).toHaveBeenCalledExactlyOnceWith(code, codeVerifier, "api-route");
});

it.each([
  ["https://pm.test", "pm.test:80", "https"],
  ["http://pm.test", "pm.test:443", "http"],
  ["http://pm.test", "pm.test:443", "https"],
  ["https://pm.test", "pm.test:80", "http"],
  ["https://foreign.test", "pm.test:443", "https"],
  ["https://pm.test", "attacker@pm.test:443", "https"],
  ["https://pm.test", "pm.test:443/path", "https"],
] as const)("still refuses a mismatching or malformed public origin (%s, %s, %s)", async (origin, host, scheme) => {
  const request = signInRequest({ origin, host, "x-forwarded-proto": scheme }, "http://127.0.0.1:3100/api/auth/app-code");
  const parse = vi.spyOn(request, "json");
  const response = await POST(request);
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(parse).not.toHaveBeenCalled();
  expect(exchange).not.toHaveBeenCalled();
});
