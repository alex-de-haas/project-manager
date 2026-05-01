export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { parseIcsDayOffs } from "@/lib/ics";
import { safeServerFetch, validateHttpUrlForServerFetch } from "@/lib/safe-fetch";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";

const MAX_ICS_CONTENT_LENGTH = 2_000_000;

class DayOffImportError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const loadCalendarContent = async (url: string) => {
  try {
    await validateHttpUrlForServerFetch(url);
  } catch (error) {
    throw new DayOffImportError(error instanceof Error ? error.message : "Invalid calendar URL");
  }

  let response: Response;
  try {
    response = await safeServerFetch(url, {
      headers: {
        Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new DayOffImportError(error instanceof Error ? error.message : "Invalid calendar URL");
  }

  if (!response.ok) {
    throw new DayOffImportError(
      `Failed to fetch calendar (${response.status})`,
      502
    );
  }

  return response.text();
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const url =
      typeof body.url === "string" && body.url.trim().length > 0
        ? body.url.trim()
        : null;
    const fileContent =
      typeof body.fileContent === "string" && body.fileContent.trim().length > 0
        ? body.fileContent
        : null;

    if (!url && !fileContent) {
      return NextResponse.json(
        { error: "Provide either a calendar URL or an ICS file" },
        { status: 400 }
      );
    }

    const content = url ? await loadCalendarContent(url) : fileContent!;

    if (content.length > MAX_ICS_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: "ICS file is too large" },
        { status: 400 }
      );
    }

    const importedDayOffs = parseIcsDayOffs(content);

    if (importedDayOffs.length === 0) {
      return NextResponse.json(
        { error: "No day-offs could be parsed from this ICS calendar" },
        { status: 400 }
      );
    }

    const findExisting = db.prepare(
      "SELECT id FROM day_offs WHERE user_id = ? AND date = ?"
    );
    const insertDayOff = db.prepare(
      "INSERT INTO day_offs (user_id, project_id, date, description, is_half_day) VALUES (?, ?, ?, ?, ?)"
    );

    const transaction = db.transaction((entries: typeof importedDayOffs) => {
      let added = 0;
      let skipped = 0;

      for (const entry of entries) {
        const existing = findExisting.get(userId, entry.date) as
          | { id: number }
          | undefined;

        if (existing) {
          skipped += 1;
          continue;
        }

        insertDayOff.run(
          userId,
          projectId,
          entry.date,
          entry.description,
          entry.isHalfDay ? 1 : 0
        );
        added += 1;
      }

      return { added, skipped };
    });

    const result = transaction(importedDayOffs);

    return NextResponse.json({
      added: result.added,
      skipped: result.skipped,
      total: importedDayOffs.length,
    });
  } catch (error) {
    console.error("Error importing ICS day-offs:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import ICS day-offs",
      },
      { status: error instanceof DayOffImportError ? error.status : 500 }
    );
  }
}
