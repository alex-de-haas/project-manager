"use client";

import { createContext, useContext, useEffect, useState } from "react";
import TopNavigation from "@/components/TopNavigation";
import { fetchAppContext, setActiveProjectId, refreshAppContext } from "@/lib/browser-api";

type AppContextData = {
  user: { id: number; host_user_id: string; name: string; email: string | null; is_admin: number };
  projects: { id: number; name: string }[];
  activeProjectId: number | null;
  defaultProjectId: number | null;
};
const Context = createContext<AppContextData | null>(null);
export const useAppContext = () => useContext(Context);

export function AppContext({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState<{ data: AppContextData; revision: number } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("pm:refresh-context", refresh);
    return () => window.removeEventListener("pm:refresh-context", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchAppContext(controller.signal).then(async response => {
      if (!response.ok) throw new Error("Could not load your project context.");
      const data = await response.json() as AppContextData;
      if (!controller.signal.aborted) {
        setActiveProjectId(data.activeProjectId ? String(data.activeProjectId) : "");
        setLoaded({ data, revision });
        setError("");
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [revision]);
  if (error) return <div role="alert" className="p-6">{error} <button onClick={refreshAppContext}>Retry</button></div>;
  if (!loaded || loaded.revision !== revision) return <div role="status" className="p-6">Loading your projects…</div>;
  const { data } = loaded;
  return <Context.Provider value={data}>
    <div className="flex h-dvh flex-col overflow-hidden bg-muted/30">
      <TopNavigation key={`${revision}:${data.activeProjectId}`} initialUser={data.user}
        initialProjects={data.projects} initialActiveProjectId={String(data.activeProjectId ?? "")}
        initialDefaultProjectId={String(data.defaultProjectId ?? "")} />
      <main key={revision} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  </Context.Provider>;
}
