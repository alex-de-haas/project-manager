import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToLocalDate } from "./local-date";

describe("subscribeToLocalDate", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    [new Date(2026, 8, 18, 23, 59, 59), "2026-09-18", "2026-09-19"],
    [new Date(2026, 8, 30, 23, 59, 59), "2026-09-30", "2026-10-01"],
    [new Date(2026, 11, 31, 23, 59, 59), "2026-12-31", "2027-01-01"],
  ])("updates at local midnight starting at %s", (start, previous, next) => {
    vi.setSystemTime(start);
    const onDate = vi.fn();
    stop = subscribeToLocalDate(onDate);
    expect(onDate).toHaveBeenLastCalledWith(previous);
    vi.advanceTimersByTime(999);
    expect(onDate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onDate).toHaveBeenLastCalledWith(next);
  });

  it("continues updating on subsequent days", () => {
    vi.setSystemTime(new Date(2026, 8, 18, 23, 59, 59));
    const onDate = vi.fn();
    stop = subscribeToLocalDate(onDate);
    vi.advanceTimersByTime(1000 + 24 * 60 * 60 * 1000);
    expect(onDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-09-18", "2026-09-19", "2026-09-20",
    ]);
  });

  it.each(["focus", "pageshow", "visibilitychange"])("catches up after sleep on %s", (event) => {
    vi.setSystemTime(new Date(2026, 8, 18, 22));
    const onDate = vi.fn();
    stop = subscribeToLocalDate(onDate);
    // Move the wall clock without firing timers, as with a suspended browser tab.
    vi.setSystemTime(new Date(2026, 8, 20, 8));
    (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
    expect(onDate).toHaveBeenLastCalledWith("2026-09-20");
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(16 * 60 * 60 * 1000);
    expect(onDate).toHaveBeenLastCalledWith("2026-09-21");
  });

  it("removes the timer and wake-up listeners on disposal", () => {
    vi.setSystemTime(new Date(2026, 8, 18, 22));
    const onDate = vi.fn();
    stop = subscribeToLocalDate(onDate);
    stop();
    onDate.mockClear();
    vi.setSystemTime(new Date(2026, 8, 20, 8));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onDate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
