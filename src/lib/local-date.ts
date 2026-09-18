import { format } from "date-fns";

/** Follow the browser's local calendar date, including after sleep or tab suspension. */
export function subscribeToLocalDate(onDate: (date: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout>;

  const refresh = () => {
    clearTimeout(timer);
    const now = new Date();
    onDate(format(now, "yyyy-MM-dd"));

    // Construct local midnight rather than adding 24 hours: DST days vary in length.
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(refresh, midnight.getTime() - now.getTime());
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") refresh();
  };

  refresh();
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
