import { afterEach, expect, it, vi } from "vitest";
import { forgetAppGrant, rememberAppGrant } from "@hosty-sdk/app/browser-auth";
import { apiFetch, setActiveProjectId } from "./browser-api";

afterEach(() => { forgetAppGrant(); setActiveProjectId(""); vi.unstubAllGlobals(); });
it("sends an in-memory grant and selected project without relying on cookies", async () => {
  vi.stubGlobal("window", { location: new URL("https://app.test/") });
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
  vi.stubGlobal("window", { location: new URL("https://app.test/") });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  rememberAppGrant("hostyg_popup");
  await expect(apiFetch("https://other.test/api/tasks")).rejects.toThrow("origin");
  expect(fetch).not.toHaveBeenCalled();
});
