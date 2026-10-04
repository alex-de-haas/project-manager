import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";

const dataDir = mkdtempSync(join(tmpdir(), "pm-session-test-"));
process.env.HOSTY_APP_DATA_DIR = dataDir;
const { default: db } = await import("@/lib/db");
const { GET } = await import("./route");
const { INTERNAL_HOST_USER_ID_HEADER } = await import("@/lib/host-identity");
let projectId: number;
let revokedProjectId: number;

beforeAll(() => {
  const userId = Number(db.prepare(
    "INSERT INTO users (host_user_id, name) VALUES ('session-user', 'User')"
  ).run().lastInsertRowid);
  const otherUserId = Number(db.prepare(
    "INSERT INTO users (host_user_id, name) VALUES ('other-user', 'Other')"
  ).run().lastInsertRowid);
  projectId = Number(db.prepare("INSERT INTO projects (user_id, name) VALUES (?, 'Allowed')")
    .run(userId).lastInsertRowid);
  revokedProjectId = Number(db.prepare("INSERT INTO projects (user_id, name) VALUES (?, 'Revoked')")
    .run(otherUserId).lastInsertRowid);
  db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(projectId, userId);
});
afterAll(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
const request = (project?: number) => new NextRequest("https://app.test/api/auth/session", {
  headers: {
    [INTERNAL_HOST_USER_ID_HEADER]: "session-user",
    ...(project === undefined ? {} : { "x-project-id": String(project) }),
  },
});

it("returns 403 for a project without membership", async () => {
  const response = await GET(request(revokedProjectId));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Project access denied" });
});
it("returns 404 for a deleted project", async () => {
  const response = await GET(request(999999));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Project not found" });
});
it("selects an accessible project after the stale selection is omitted", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.activeProjectId).toBe(projectId);
  expect(body.projects.map((project: { id: number }) => project.id)).toEqual([projectId]);
});
it("still requires authenticated identity", async () => {
  const response = await GET(new NextRequest("https://app.test/api/auth/session"));
  expect(response.status).toBe(401);
});
