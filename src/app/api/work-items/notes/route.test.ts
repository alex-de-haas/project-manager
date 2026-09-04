import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "pm-notes-test-"));
process.env.HOSTY_APP_DATA_DIR = dataDir;

const { default: db } = await import("@/lib/db");
const { PATCH } = await import("@/app/api/work-items/notes/route");
const { INTERNAL_HOST_USER_ID_HEADER, INTERNAL_HOST_USER_NAME_HEADER } = await import(
  "@/lib/host-identity"
);
const { NextRequest } = await import("next/server");

let userId: number;
let otherUserId: number;
let projectId: number;
let otherProjectId: number;
let taskId: number;
let userStoryId: number;
let foreignTaskId: number;

const request = (body: unknown, hostUserId: string, project: number) =>
  new NextRequest("http://localhost/api/work-items/notes", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      [INTERNAL_HOST_USER_ID_HEADER]: hostUserId,
      [INTERNAL_HOST_USER_NAME_HEADER]: `host-${hostUserId}`,
      "x-project-id": String(project),
    },
    body: JSON.stringify(body),
  });

const readNotes = (workItemId: number) =>
  (db.prepare("SELECT notes FROM work_items WHERE id = ?").get(workItemId) as {
    notes: string | null;
  }).notes;

const insertWorkItem = (project: number, type: string, title: string) =>
  Number(
    db
      .prepare(
        "INSERT INTO work_items (project_id, title, type, status, assigned_user_id) VALUES (?, ?, ?, 'new', ?)"
      )
      .run(project, title, type, userId).lastInsertRowid
  );

beforeAll(() => {
  userId = Number(
    db
      .prepare("INSERT INTO users (host_user_id, name, email) VALUES ('host-1', 'Owner', 'owner@example.com')")
      .run().lastInsertRowid
  );
  otherUserId = Number(
    db
      .prepare("INSERT INTO users (host_user_id, name, email) VALUES ('host-2', 'Outsider', 'out@example.com')")
      .run().lastInsertRowid
  );

  projectId = Number(
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, 'Main')").run(userId)
      .lastInsertRowid
  );
  otherProjectId = Number(
    db.prepare("INSERT INTO projects (user_id, name) VALUES (?, 'Other')").run(otherUserId)
      .lastInsertRowid
  );

  db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(projectId, userId);
  db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(
    otherProjectId,
    otherUserId
  );

  taskId = insertWorkItem(projectId, "task", "Tracked task");
  userStoryId = insertWorkItem(projectId, "user_story", "Planned story");
  foreignTaskId = insertWorkItem(otherProjectId, "task", "Someone else's task");

  // The note must stay editable on provider-linked items — it never leaves the app.
  db.prepare(
    "INSERT INTO work_item_external_links (work_item_id, project_id, provider, external_id) VALUES (?, ?, 'azure_devops', '4242')"
  ).run(taskId, projectId);
});

afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("PATCH /api/work-items/notes", () => {
  it("saves a note on an Azure DevOps-linked task", async () => {
    const response = await PATCH(request({ workItemId: taskId, notes: "  **local** only  " }, "host-1", projectId));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ notes: "**local** only" });
    expect(readNotes(taskId)).toBe("**local** only");
  });

  it("saves a note on a user story, which Time Management never lists", async () => {
    const response = await PATCH(request({ workItemId: userStoryId, notes: "Story note" }, "host-1", projectId));

    expect(response.status).toBe(200);
    expect(readNotes(userStoryId)).toBe("Story note");
  });

  it("clears the note when the text is blank", async () => {
    await PATCH(request({ workItemId: taskId, notes: "   " }, "host-1", projectId));

    expect(readNotes(taskId)).toBeNull();
  });

  it("rejects a non-string note", async () => {
    const response = await PATCH(request({ workItemId: taskId, notes: 42 }, "host-1", projectId));

    expect(response.status).toBe(400);
  });

  it("rejects a missing work item id", async () => {
    const response = await PATCH(request({ notes: "orphan" }, "host-1", projectId));

    expect(response.status).toBe(400);
  });

  it("does not reach a work item in another project", async () => {
    const response = await PATCH(request({ workItemId: foreignTaskId, notes: "leak" }, "host-1", projectId));

    expect(response.status).toBe(404);
    expect(readNotes(foreignTaskId)).toBeNull();
  });
});
