import { describe, expect, it } from "vitest";

import { parseIcsDayOffs } from "@/lib/ics";

// Build ICS content with CRLF line endings (per RFC 5545).
const ics = (...lines: string[]) => lines.join("\r\n");

describe("parseIcsDayOffs", () => {
  it("parses a single all-day event (DTEND is exclusive)", () => {
    const content = ics(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260102",
      "SUMMARY:New Year",
      "END:VEVENT",
      "END:VCALENDAR"
    );

    expect(parseIcsDayOffs(content)).toEqual([
      { date: "2026-01-01", description: "New Year", isHalfDay: false },
    ]);
  });

  it("expands a multi-day all-day range inclusively, excluding DTEND", () => {
    const content = ics(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260104",
      "SUMMARY:Trip",
      "END:VEVENT",
      "END:VCALENDAR"
    );

    expect(parseIcsDayOffs(content).map((entry) => entry.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("treats an all-day event without DTEND as a single day", () => {
    const content = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260315",
      "SUMMARY:Day off",
      "END:VEVENT"
    );

    expect(parseIcsDayOffs(content)).toEqual([
      { date: "2026-03-15", description: "Day off", isHalfDay: false },
    ]);
  });

  it("dedupes overlapping dates and merges distinct descriptions", () => {
    const content = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260102",
      "SUMMARY:A",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260102",
      "SUMMARY:B",
      "END:VEVENT"
    );

    expect(parseIcsDayOffs(content)).toEqual([
      { date: "2026-01-01", description: "A; B", isHalfDay: false },
    ]);
  });

  it("decodes escaped SUMMARY text", () => {
    const content = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260201",
      "DTEND;VALUE=DATE:20260202",
      "SUMMARY:Vacation\\, summer\\; 2026",
      "END:VEVENT"
    );

    expect(parseIcsDayOffs(content)[0].description).toBe("Vacation, summer; 2026");
  });

  it("unfolds continuation lines (a leading space marks a fold)", () => {
    const content = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260201",
      "DTEND;VALUE=DATE:20260202",
      "SUMMARY:Team offsite in",
      " Berlin",
      "END:VEVENT"
    );

    // Folding removes the fold's leading space, so the two lines concatenate directly.
    expect(parseIcsDayOffs(content)[0].description).toBe("Team offsite inBerlin");
  });

  it("sorts results by date", () => {
    const content = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "DTEND;VALUE=DATE:20260311",
      "SUMMARY:Later",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260102",
      "SUMMARY:Earlier",
      "END:VEVENT"
    );

    expect(parseIcsDayOffs(content).map((entry) => entry.date)).toEqual([
      "2026-01-01",
      "2026-03-10",
    ]);
  });

  it("returns an empty array when there are no events", () => {
    expect(parseIcsDayOffs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual([]);
    expect(parseIcsDayOffs("")).toEqual([]);
  });
});
