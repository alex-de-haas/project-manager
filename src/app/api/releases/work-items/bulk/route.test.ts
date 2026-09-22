import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "pm-bulk-test-"));
process.env.HOSTY_APP_DATA_DIR = dataDir;
const { default: db } = await import("@/lib/db");
const { POST } = await import("./route");
const { NextRequest } = await import("next/server");
const { INTERNAL_HOST_USER_ID_HEADER } = await import("@/lib/host-identity");
let project: number;
let foreignProject: number;
let source: number;
let target: number;
let foreignRelease: number;
let first: number;
let second: number;
let story: number;
let user: number;

const insert = (sql: string, ...values: (number | string)[]) => Number(db.prepare(sql).run(...values).lastInsertRowid);
const release = (projectId: number, name: string) => insert("INSERT INTO releases (user_id, project_id, name, start_date, end_date) VALUES (?, ?, ?, '2026-09-01', '2026-09-30')", user, projectId, name);
const workItem = (title: string, type = "user_story", projectId = project) => insert("INSERT INTO work_items (project_id, title, type, status, notes) VALUES (?, ?, ?, 'new', 'Keep this note')", projectId, title, type);
const member = (releaseId: number, workItemId: number, order = 0) => insert("INSERT INTO release_items (release_id, work_item_id, display_order) VALUES (?, ?, ?)", releaseId, workItemId, order);
const snapshot = () => db.prepare("SELECT * FROM release_items ORDER BY id").all();
const request = (body: unknown) => POST(new NextRequest("http://localhost/api/releases/work-items/bulk", {
  method: "POST", headers: { "content-type": "application/json", [INTERNAL_HOST_USER_ID_HEADER]: "bulk-owner", "x-project-id": String(project) }, body: JSON.stringify(body),
}));
const move = (changes = {}) => request({ action: "move", sourceReleaseId: source, targetReleaseId: target, ids: [second, first], ...changes });

beforeAll(() => {
  user = insert("INSERT INTO users (host_user_id, name) VALUES ('bulk-owner', 'Owner')");
  project = insert("INSERT INTO projects (user_id, name) VALUES (?, 'Main')", user);
  foreignProject = insert("INSERT INTO projects (user_id, name) VALUES (?, 'Other')", user);
  db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(project, user);
});
beforeEach(() => {
  db.exec("DELETE FROM release_items; DELETE FROM releases; DELETE FROM work_items;");
  source = release(project, "Source");
  target = release(project, "Target");
  foreignRelease = release(foreignProject, "Foreign");
  story = workItem("First");
  first = member(source, story, 2);
  second = member(source, workItem("Second"), 7);
});
afterAll(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe("atomic bulk release operations", () => {
  it("appends in source order and preserves work items, children, notes, and provider links", async () => {
    member(target, workItem("Existing"), 10);
    const child = workItem("Child", "task");
    db.prepare("UPDATE work_items SET parent_work_item_id = ? WHERE id = ?").run(story, child);
    db.prepare("INSERT INTO work_item_external_links (work_item_id, project_id, provider, external_id) VALUES (?, ?, 'azure_devops', '4242')").run(story, project);
    const before = db.prepare("SELECT * FROM work_items ORDER BY id").all();
    expect((await move()).status).toBe(200);
    expect(db.prepare("SELECT id, display_order FROM release_items WHERE id IN (?, ?) ORDER BY display_order").all(first, second))
      .toEqual([{ id: first, display_order: 11 }, { id: second, display_order: 12 }]);
    expect(db.prepare("SELECT * FROM work_items ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT external_id FROM work_item_external_links WHERE work_item_id = ?").get(story)).toEqual({ external_id: "4242" });
  });
  it("removes only selected memberships and preserves canonical data and other releases", async () => {
    const otherMembership = member(target, story);
    const child = workItem("Child", "task");
    db.prepare("UPDATE work_items SET parent_work_item_id = ? WHERE id = ?").run(story, child);
    const before = db.prepare("SELECT * FROM work_items ORDER BY id").all();
    expect((await request({ action: "remove", sourceReleaseId: source, ids: [first, second] })).status).toBe(200);
    expect(db.prepare("SELECT id FROM release_items").all()).toEqual([{ id: otherMembership }]);
    expect(db.prepare("SELECT * FROM work_items ORDER BY id").all()).toEqual(before);
  });
  it.each([[], [0], [-1], [1.5], ["1"], [null]].map((ids) => ({ ids })))("rejects invalid IDs $ids", async ({ ids }) => {
    const before = snapshot();
    expect((await move({ ids })).status).toBe(400);
    expect(snapshot()).toEqual(before);
  });
  it("does not bulk-operate on a child task membership", async () => {
    const task = member(source, workItem("Child", "task"));
    const before = snapshot();
    const response = await move({ ids: [first, task] });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Some selected items are unavailable or are not user stories in this release. Reload and select user stories again.",
    });
    expect(snapshot()).toEqual(before);
  });
  it("rejects duplicate IDs, invalid action and same-release moves", async () => {
    for (const changes of [{ ids: [first, first] }, { action: "assign" }, { targetReleaseId: source }, { sourceReleaseId: null }, { targetReleaseId: "2" }]) {
      const before = snapshot();
      expect((await move(changes)).status).toBe(400);
      expect(snapshot()).toEqual(before);
    }
  });
  it.each(["move", "remove"])("rejects stale or foreign selected items for %s", async (action) => {
    const foreignItem = member(foreignRelease, workItem("Foreign", "user_story", foreignProject));
    for (const id of [999999, foreignItem]) {
      const before = snapshot();
      expect((await move({ action, ids: [first, id] })).status).toBe(409);
      expect(snapshot()).toEqual(before);
    }
  });
  it("rejects completed, missing and foreign destinations and foreign sources", async () => {
    db.prepare("UPDATE releases SET status = 'completed' WHERE id = ?").run(target);
    for (const changes of [{}, { targetReleaseId: foreignRelease }, { targetReleaseId: 999999 }, { sourceReleaseId: foreignRelease }]) {
      const before = snapshot();
      expect((await move(changes)).status).toBeGreaterThanOrEqual(400);
      expect(snapshot()).toEqual(before);
    }
  });
  it("rejects a duplicate destination membership without moving other stories", async () => {
    member(target, story);
    const before = snapshot();
    expect((await move()).status).toBe(409);
    expect(snapshot()).toEqual(before);
  });
  it.each(["move", "remove"])("rolls back earlier writes on a database failure during %s", async (action) => {
    const before = snapshot();
    db.exec(`CREATE TRIGGER fail_bulk BEFORE ${action === "move" ? "UPDATE" : "DELETE"} ON release_items WHEN OLD.id = ${second} BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    try {
      expect((await move({ action })).status).toBe(500);
      expect(snapshot()).toEqual(before);
    } finally { db.exec("DROP TRIGGER fail_bulk"); }
  });
});
