export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getRequestProjectId, getRequestUserId, projectContextErrorResponse } from "@/lib/user-context";

class MembershipError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const isId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export async function POST(request: NextRequest) {
  try {
    const projectId = getRequestProjectId(request, getRequestUserId(request));
    const body = await request.json().catch(() => null);
    if (!body || !["move", "remove"].includes(body.action) ||
        !isId(body.sourceReleaseId) || !Array.isArray(body.ids) ||
        body.ids.length === 0 || !body.ids.every(isId) ||
        new Set(body.ids).size !== body.ids.length ||
        (body.action === "move" && (!isId(body.targetReleaseId) || body.targetReleaseId === body.sourceReleaseId))) {
      return NextResponse.json({ error: "Provide an action, unique item IDs, and valid source and target releases." }, { status: 400 });
    }
    const ids = new Set<number>(body.ids);
    db.transaction(() => {
      const source = db.prepare("SELECT id FROM releases WHERE id = ? AND project_id = ?")
        .get(body.sourceReleaseId, projectId);
      if (!source) throw new MembershipError("Source release not found.", 404);
      const rows = (db.prepare(`
        SELECT ri.id, ri.work_item_id FROM release_items ri
        JOIN work_items wi ON wi.id = ri.work_item_id
        WHERE ri.release_id = ? AND wi.project_id = ? AND wi.type = 'user_story'
        ORDER BY ri.display_order ASC, ri.created_at DESC, ri.id ASC
      `).all(body.sourceReleaseId, projectId) as { id: number; work_item_id: number }[])
        .filter((row) => ids.has(row.id));
      if (rows.length !== ids.size) {
        throw new MembershipError("Some selected items are unavailable or are not user stories in this release. Reload and select user stories again.");
      }
      if (body.action === "remove") {
        const remove = db.prepare("DELETE FROM release_items WHERE id = ?");
        for (const row of rows) remove.run(row.id);
        return;
      }
      const target = db.prepare("SELECT status FROM releases WHERE id = ? AND project_id = ?")
        .get(body.targetReleaseId, projectId) as { status: string } | undefined;
      if (!target) throw new MembershipError("Target release not found.", 404);
      if (target.status === "completed") throw new MembershipError("Cannot move stories to a completed release.");
      const existing = new Set((db.prepare("SELECT work_item_id FROM release_items WHERE release_id = ?")
        .all(body.targetReleaseId) as { work_item_id: number }[]).map((row) => row.work_item_id));
      if (rows.some((row) => existing.has(row.work_item_id))) {
        throw new MembershipError("A selected story already belongs to the target release. No stories were moved.");
      }
      const { maximum } = db.prepare("SELECT MAX(display_order) AS maximum FROM release_items WHERE release_id = ?")
        .get(body.targetReleaseId) as { maximum: number | null };
      const move = db.prepare("UPDATE release_items SET release_id = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      rows.forEach((row, index) => move.run(body.targetReleaseId, (maximum ?? -1) + 1 + index, row.id));
    })();
    return NextResponse.json({ success: true, count: ids.size });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;
    if (error instanceof MembershipError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Bulk release operation failed:", error);
    return NextResponse.json({ error: "Could not update the selected stories. No changes were applied." }, { status: 500 });
  }
}
