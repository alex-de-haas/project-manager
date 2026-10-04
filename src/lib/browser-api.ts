import { appFetch } from "@hosty-sdk/app/browser-auth";

// This is a selection, not authority: API handlers still check project membership.
let activeProjectId = "";
export const getActiveProjectId = () => activeProjectId;
export const setActiveProjectId = (id: string) => { activeProjectId = id; };
export const refreshAppContext = () => window.dispatchEvent(new Event("pm:refresh-context"));

export function apiFetch(input: string | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (activeProjectId && !headers.has("x-project-id")) headers.set("x-project-id", activeProjectId);
  return appFetch(input, { ...init, headers });
}

/** Recover a stale project selection without discarding the browser's app grant. */
export async function fetchAppContext(signal?: AbortSignal) {
  const selectedProject = activeProjectId;
  const response = await apiFetch("/api/auth/session", { signal });
  if (selectedProject && selectedProject === activeProjectId && !signal?.aborted &&
      (response.status === 403 || response.status === 404)) {
    setActiveProjectId("");
    // Retry this read once, letting the server choose an accessible project.
    return apiFetch("/api/auth/session", { signal });
  }
  return response;
}
