import { afterEach, expect, it, vi } from "vitest";
import { forgetAppGrant, rememberAppGrant } from "@hosty-sdk/app/browser-auth";
import { apiFetch, fetchAppContext, getActiveProjectId, setActiveProjectId } from "./browser-api";

afterEach(() => { forgetAppGrant(); setActiveProjectId(""); vi.unstubAllGlobals(); });
it("sends an in-memory grant and selected project without relying on cookies", async () => {
  vi.stubGlobal("window", { location: new URL("https://app.test/"), dispatchEvent: vi.fn() });
  const fetch = vi.fn(async (_input: unknown, _init: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  rememberAppGrant("hostyg_popup");
  setActiveProjectId("42");
  await apiFetch("/api/tasks", { method: "POST" });
  const init = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer hostyg_popup");
  expect(new Headers(init.headers).get("x-project-id")).toBe("42");
  expect(init.redirect).toBe("error");
});
it("refuses to send credentials or project context to another origin", async () => {
  vi.stubGlobal("window", { location: new URL("https://app.test/"), dispatchEvent: vi.fn() });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  rememberAppGrant("hostyg_popup");
  await expect(apiFetch("https://other.test/api/tasks")).rejects.toThrow("origin");
  expect(fetch).not.toHaveBeenCalled();
});

it.each([403, 404])("recovers stale project context after %s without losing the grant", async status => {
  vi.stubGlobal("window", { location: new URL("https://app.test/"), dispatchEvent: vi.fn() });
  const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status }))
    .mockResolvedValueOnce(Response.json({ activeProjectId: 7 }));
  vi.stubGlobal("fetch", fetch);
  rememberAppGrant("hostyg_popup");
  setActiveProjectId("42");
  expect(await (await fetchAppContext()).json()).toEqual({ activeProjectId: 7 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new Headers(fetch.mock.calls[0][1].headers).get("x-project-id")).toBe("42");
  expect(new Headers(fetch.mock.calls[1][1].headers).get("x-project-id")).toBeNull();
  for (const [, init] of fetch.mock.calls) {
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer hostyg_popup");
  }
  expect(getActiveProjectId()).toBe("");
});

it.each([401, 500])("does not reset project selection for status %s", async status => {
  vi.stubGlobal("window", { location: new URL("https://app.test/"), dispatchEvent: vi.fn() });
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
  vi.stubGlobal("fetch", fetch);
  setActiveProjectId("42");
  expect((await fetchAppContext()).status).toBe(status);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(getActiveProjectId()).toBe("42");
});

it("does not retry project fallback indefinitely", async () => {
  vi.stubGlobal("window", { location: new URL("https://app.test/"), dispatchEvent: vi.fn() });
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  setActiveProjectId("42");
  expect((await fetchAppContext()).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["selection", "abort"])("does not clear context after a newer %s", async change => {
  vi.stubGlobal("window", { location: new URL("https://app.test/"), dispatchEvent: vi.fn() });
  const controller = new AbortController();
  const fetch = vi.fn(async () => {
    if (change === "selection") setActiveProjectId("7");
    else controller.abort();
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  setActiveProjectId("42");
  await fetchAppContext(controller.signal);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(getActiveProjectId()).toBe(change === "selection" ? "7" : "42");
});
