import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemErrorPolicy, type WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";

const azure = vi.hoisted(() => ({
  getWorkItems: vi.fn(),
  queryByWiql: vi.fn(),
}));
vi.mock("@/lib/azure-devops/settings", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/azure-devops/settings")>(),
  getAzureDevOpsSettingsForUser: () => ({ project: "Main" }),
  createAzureDevOpsConnectionContext: async () => ({
    settings: { project: "Main" }, connection: {}, witApi: azure,
  }),
  getOrResolveAzureDevOpsUserIdentity: async () => ({
    id: "azure-owner", displayName: "Owner", uniqueName: "owner@example.com",
  }),
}));

const dataDir = mkdtempSync(join(tmpdir(), "pm-refresh-test-"));
process.env.HOSTY_APP_DATA_DIR = dataDir;
const { default: db } = await import("@/lib/db");
const { POST } = await import("./route");
const { GET: getTasks } = await import("@/app/api/tasks/route");
const { NextRequest } = await import("next/server");
const { INTERNAL_HOST_USER_ID_HEADER } = await import("@/lib/host-identity");
let user: number;
let otherUser: number;
let project: number;
let otherProject: number;
const snapshots = new Map<number, WorkItem>();
const insert = (sql: string, ...values: (string | number | null)[]) =>
  Number(db.prepare(sql).run(...values).lastInsertRowid);
const headers = () => ({
  "content-type": "application/json",
  [INTERNAL_HOST_USER_ID_HEADER]: "refresh-owner",
  "x-project-id": String(project),
});
const request = (body: object) => POST(new NextRequest("http://localhost/api/azure-devops/refresh", {
  method: "POST", headers: headers(), body: JSON.stringify(body),
}));
const refresh = (body = {}) => request({
  startDate: "2026-10-01", endDate: "2026-10-31", taskIds: [], includeActiveItems: true, ...body,
});
const currentTasks = async () => (await getTasks(new NextRequest(
  "http://localhost/api/tasks?startDate=2026-10-01&endDate=2026-10-31", { headers: headers() },
))).json();
const readItem = (id: number) => db.prepare("SELECT * FROM work_items WHERE id = ?").get(id);

function trackedItem(externalId: number, options: {
  status?: string; assignedUser?: number | null; membershipUser?: number | null;
  projectId?: number; type?: string;
} = {}) {
  const projectId = options.projectId ?? project;
  const id = insert(`INSERT INTO work_items
    (project_id, title, type, status, assigned_user_id, created_at, completed_at, notes)
    VALUES (?, ?, ?, ?, ?, '2026-09-01', ?, 'Keep historical context')`,
  projectId, `Item ${externalId}`, options.type ?? "bug", options.status ?? "completed",
  options.assignedUser === undefined ? otherUser : options.assignedUser,
  (options.status ?? "completed") === "completed" ? "2026-09-25" : null);
  insert("INSERT INTO work_item_external_links (work_item_id, project_id, provider, external_id) VALUES (?, ?, 'azure_devops', ?)",
    id, projectId, String(externalId));
  if (options.membershipUser !== null) {
    insert("INSERT INTO time_tracking_items (project_id, user_id, work_item_id) VALUES (?, ?, ?)",
      projectId, options.membershipUser ?? user, id);
  }
  return id;
}

function remoteItem(id: number, state = "Active", assignedToOwner = true, type = "Bug") {
  snapshots.set(id, { id, fields: {
    "System.Title": `Item ${id}`, "System.WorkItemType": type, "System.State": state,
    "System.AssignedTo": assignedToOwner
      ? { id: "azure-owner", displayName: "Owner", uniqueName: "owner@example.com" }
      : { id: "azure-qa", displayName: "QA", uniqueName: "qa@example.com" },
    "Microsoft.VSTS.Common.ClosedDate": "2026-09-25",
  } });
}

beforeAll(() => {
  user = insert("INSERT INTO users (host_user_id, name) VALUES ('refresh-owner', 'Owner')");
  otherUser = insert("INSERT INTO users (host_user_id, name) VALUES ('refresh-qa', 'QA')");
  project = insert("INSERT INTO projects (user_id, name) VALUES (?, 'Main')", user);
  otherProject = insert("INSERT INTO projects (user_id, name) VALUES (?, 'Other')", user);
  insert("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)", project, user);
});
beforeEach(() => {
  db.exec("DELETE FROM release_items; DELETE FROM releases; DELETE FROM work_items;");
  snapshots.clear();
  vi.clearAllMocks();
  azure.queryByWiql.mockResolvedValue({ workItems: [] });
  azure.getWorkItems.mockImplementation(async (ids: number[]) => ids.flatMap((id) => snapshots.get(id) ?? []));
});
afterAll(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe("Time Management refresh across periods", () => {
  it.each(["resolved", "completed"])("discovers a %s bug returned from QA with no visible rows", async (status) => {
    const id = trackedItem(101, { status });
    insert("INSERT INTO time_entries (work_item_id, user_id, date, hours) VALUES (?, ?, '2026-09-24', 3)", id, user);
    const timeBefore = db.prepare("SELECT * FROM time_entries").all();
    const membershipsBefore = db.prepare("SELECT * FROM time_tracking_items").all();
    remoteItem(101);
    azure.queryByWiql.mockResolvedValue({ workItems: [{ id: 101 }] });
    if (status === "completed") expect(await currentTasks()).toEqual([]);

    const response = await refresh();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1 });
    expect(readItem(id)).toMatchObject({ status: "in_progress", assigned_user_id: user, completed_at: null, notes: "Keep historical context" });
    expect(await currentTasks()).toEqual([expect.objectContaining({ id, status: "Active", isAssignedToCurrentUser: true })]);
    expect(db.prepare("SELECT * FROM time_entries").all()).toEqual(timeBefore);
    expect(db.prepare("SELECT * FROM time_tracking_items").all()).toEqual(membershipsBefore);
    expect(azure.queryByWiql).toHaveBeenCalledWith({ query: expect.stringMatching(/\[System.AssignedTo\] = @Me/) }, { project: "Main" });
    expect(azure.queryByWiql.mock.calls[0][0].query).toContain("[System.TeamProject] = @project");
    expect(azure.queryByWiql.mock.calls[0][0].query).not.toContain("[System.State] NOT IN");
    const states = azure.queryByWiql.mock.calls[0][0].query.match(/\[System.State\] IN \(([^)]+)\)/)[1].match(/'([^']+)'/g);
    expect(states).toEqual(["'New'", "'Todo'", "'To Do'", "'To_Do'", "'Open'", "'Proposed'", "'Active'", "'In Progress'", "'In_Progress'", "'Doing'", "'Committed'"]);
  });

  it.each([
    { scope: "local assignment", status: "completed", nativeStatus: "Cancelled" },
    { scope: "provider assignment", status: "completed", nativeStatus: "Cancelled" },
    { scope: "visible row", status: "completed", nativeStatus: "Cancelled" },
    { scope: "state changed after discovery", status: "completed", nativeStatus: "Cancelled" },
    { scope: "provider assignment", status: "resolved", nativeStatus: "Custom QA Complete" },
    { scope: "local assignment", status: "completed", nativeStatus: "" },
  ])("preserves $status for an unknown provider state through $scope ($nativeStatus)", async ({ scope, status, nativeStatus }) => {
    const id = trackedItem(105, { status, assignedUser: scope === "local assignment" ? user : otherUser });
    const completedAt = status === "completed" ? "2026-09-25" : null;
    remoteItem(105, nativeStatus, scope !== "state changed after discovery");
    snapshots.get(105)!.fields!["System.Tags"] = "Updated metadata";
    // A returned ID may be selected by @Me, or its state may change before the snapshot arrives.
    azure.queryByWiql.mockResolvedValue({ workItems: [{ id: 105 }] });
    const response = scope === "visible row"
      ? await request({ taskIds: [id] })
      : await refresh();
    expect(response.status).toBe(200);
    expect(readItem(id)).toMatchObject({ status, completed_at: completedAt, tags: "Updated metadata" });
    expect(db.prepare("SELECT native_status FROM work_item_external_links WHERE work_item_id = ?").get(id))
      .toEqual({ native_status: nativeStatus || null });
    expect(azure.getWorkItems.mock.calls[0][0]).toEqual([105]);
  });

  it("refreshes hidden assigned and non-final items, including an item newly closed upstream", async () => {
    const assigned = trackedItem(102, { assignedUser: user });
    const open = trackedItem(103, { status: "in_progress" });
    const untouched = trackedItem(104);
    const before = readItem(untouched);
    remoteItem(102, "New");
    remoteItem(103, "Closed", false);
    expect((await refresh()).status).toBe(200);
    expect(readItem(assigned)).toMatchObject({ status: "new", completed_at: null });
    expect(readItem(open)).toMatchObject({ status: "completed", assigned_user_id: null, completed_at: "2026-09-25" });
    expect(readItem(untouched)).toEqual(before);
    expect(azure.getWorkItems.mock.calls[0][0].sort()).toEqual([102, 103]);
  });

  it("limits discovery to the user's tracked tasks and bugs in the active project", async () => {
    trackedItem(201, { membershipUser: otherUser });
    trackedItem(202, { projectId: otherProject });
    trackedItem(203, { membershipUser: null });
    trackedItem(204, { type: "user_story" });
    const before = db.prepare("SELECT * FROM work_items").all();
    expect((await refresh()).status).toBe(200);
    expect(azure.queryByWiql).not.toHaveBeenCalled();
    expect(azure.getWorkItems).not.toHaveBeenCalled();
    expect(db.prepare("SELECT * FROM work_items").all()).toEqual(before);
  });

  it("preserves explicit task and release scopes when discovery is not requested or a release is selected", async () => {
    const selected = trackedItem(301, { status: "new", assignedUser: user });
    const hidden = trackedItem(302, { status: "new", assignedUser: user });
    const before = readItem(hidden);
    remoteItem(301);
    expect((await request({ taskIds: [selected] })).status).toBe(200);
    expect(azure.getWorkItems.mock.calls[0][0]).toEqual([301]);
    expect(readItem(hidden)).toEqual(before);
    azure.getWorkItems.mockClear();
    expect((await request({ taskIds: [] })).status).toBe(200);
    expect(azure.getWorkItems).not.toHaveBeenCalled();

    const release = insert("INSERT INTO releases (user_id, project_id, name, start_date, end_date) VALUES (?, ?, 'October', '2026-10-01', '2026-10-31')", user, project);
    insert("INSERT INTO release_items (release_id, work_item_id) VALUES (?, ?)", release, selected);
    expect((await request({ releaseId: release, includeActiveItems: true })).status).toBe(200);
    expect(azure.getWorkItems.mock.calls[0][0]).toEqual([301]);
    expect(azure.queryByWiql).not.toHaveBeenCalled();
    expect(readItem(hidden)).toEqual(before);
  });

  it("batches historical discovery and snapshots, deduplicates visible rows, and omits unavailable items", async () => {
    for (let id = 1000; id < 1201; id++) {
      trackedItem(id);
      remoteItem(id);
    }
    const visible = trackedItem(1201, { status: "new", assignedUser: user });
    remoteItem(1201);
    snapshots.delete(1000);
    azure.queryByWiql
      .mockResolvedValueOnce({ workItems: Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i })) })
      .mockResolvedValueOnce({ workItems: [{ id: 1200 }] });
    const response = await refresh({ taskIds: [visible] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 201 });
    expect(azure.queryByWiql).toHaveBeenCalledTimes(2);
    const queries = azure.queryByWiql.mock.calls.map(([wiql]) => wiql.query.match(/\[System.Id\] IN \(([^)]+)\)/)[1].split(", "));
    expect(queries.map((ids: string[]) => ids.length)).toEqual([200, 1]);
    expect(azure.getWorkItems.mock.calls.map(([ids]) => ids.length)).toEqual([200, 2]);
    expect(new Set(azure.getWorkItems.mock.calls.flatMap(([ids]) => ids)).size).toBe(202);
    expect(azure.getWorkItems.mock.calls.every((call) => call[4] === WorkItemErrorPolicy.Omit)).toBe(true);
  });
});
