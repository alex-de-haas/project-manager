import { describe, expect, it } from "vitest";
import {
  addDays,
  computeExpectedHours,
  countBusinessDays,
  isIsoDate,
  resolveBalanceRange,
} from "./time-balance";

describe("countBusinessDays", () => {
  it("counts a full month", () => {
    // August 2026 starts on a Saturday and holds 21 weekdays.
    expect(countBusinessDays("2026-08-01", "2026-09-01")).toBe(21);
  });

  it("counts across a year boundary", () => {
    expect(countBusinessDays("2026-12-28", "2027-01-04")).toBe(5);
  });

  it("counts a February that starts and ends on a Sunday", () => {
    expect(countBusinessDays("2026-02-01", "2026-03-01")).toBe(20);
  });

  it("returns zero for a weekend-only range", () => {
    expect(countBusinessDays("2026-08-29", "2026-08-31")).toBe(0);
  });

  it("returns zero for an empty or inverted range", () => {
    expect(countBusinessDays("2026-08-31", "2026-08-31")).toBe(0);
    expect(countBusinessDays("2026-09-01", "2026-08-01")).toBe(0);
  });

  it("counts a single weekday and skips a single weekend day", () => {
    expect(countBusinessDays("2026-08-31", "2026-09-01")).toBe(1);
    expect(countBusinessDays("2026-08-30", "2026-08-31")).toBe(0);
  });

  it("stays exact over a long history", () => {
    // Ten years of weekdays; the arithmetic must not drift the way a day-by-day loop could.
    expect(countBusinessDays("2016-01-01", "2026-01-01")).toBe(2609);
  });
});

describe("resolveBalanceRange", () => {
  const today = "2026-08-31";

  it("ends at the period start for a past period", () => {
    expect(resolveBalanceRange("2026-08-01", today, "2026-01-05")).toEqual({
      startInclusive: "2026-01-05",
      endExclusive: "2026-08-01",
    });
  });

  it("caps a future period at the day after today", () => {
    expect(resolveBalanceRange("2026-10-01", today, "2026-01-05")).toEqual({
      startInclusive: "2026-01-05",
      endExclusive: "2026-09-01",
    });
  });

  it("returns null when nothing has been tracked yet", () => {
    expect(resolveBalanceRange("2026-08-01", today, null)).toBeNull();
  });

  it("returns null when the baseline is not before the cutoff", () => {
    expect(resolveBalanceRange("2026-08-01", today, "2026-08-01")).toBeNull();
    expect(resolveBalanceRange("2026-08-01", today, "2026-08-14")).toBeNull();
  });
});

describe("computeExpectedHours", () => {
  it("prices business days at the day length", () => {
    expect(
      computeExpectedHours({ businessDays: 21, fullDayOffs: 0, halfDayOffs: 0, dayLength: 8 })
    ).toBe(168);
  });

  it("drops full day-offs and halves half day-offs", () => {
    expect(
      computeExpectedHours({ businessDays: 21, fullDayOffs: 2, halfDayOffs: 1, dayLength: 8 })
    ).toBe(148);
  });

  it("never goes negative", () => {
    expect(
      computeExpectedHours({ businessDays: 1, fullDayOffs: 3, halfDayOffs: 0, dayLength: 8 })
    ).toBe(0);
  });
});

describe("balance arithmetic", () => {
  const balance = (trackedHours: number, expected: Parameters<typeof computeExpectedHours>[0]) =>
    trackedHours - computeExpectedHours(expected);

  it("is zero with no history", () => {
    expect(balance(0, { businessDays: 0, fullDayOffs: 0, halfDayOffs: 0, dayLength: 8 })).toBe(0);
  });

  it("turns weekend work into a surplus", () => {
    // Two weekend days tracked at 4h each inside a range with no business days.
    expect(balance(8, { businessDays: 0, fullDayOffs: 0, halfDayOffs: 0, dayLength: 8 })).toBe(8);
  });

  it("reports a deficit when tracked hours fall short", () => {
    expect(balance(150, { businessDays: 21, fullDayOffs: 0, halfDayOffs: 0, dayLength: 8 })).toBe(
      -18
    );
  });
});

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-08-31")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-8-31")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});
