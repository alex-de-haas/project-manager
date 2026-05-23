import db from "@/lib/db";
import type { User } from "@/types";
import type { TrustedHostIdentity } from "@/lib/host-identity";

type HostBackedUser = User & { host_user_id?: string | null };

const DEFAULT_PROJECT_NAME = "Default";

const normalizeDisplayName = (identity: TrustedHostIdentity) => {
  const fromName = identity.name?.trim();
  if (fromName) return fromName;

  const fromEmail = identity.email?.split("@")[0]?.trim();
  if (fromEmail) return fromEmail;

  return identity.id;
};

const buildUniqueName = (name: string, currentUserId?: number) => {
  const baseName = name.slice(0, 120) || "Docker Host User";
  const existing = db.prepare("SELECT id FROM users WHERE LOWER(name) = LOWER(?)");

  const isAvailable = (candidate: string) => {
    const row = existing.get(candidate) as { id: number } | undefined;
    return !row || row.id === currentUserId;
  };

  if (isAvailable(baseName)) return baseName;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (isAvailable(candidate)) return candidate;
  }

  return `${baseName} ${Date.now()}`;
};

const ensureDefaultProjectForUser = (userId: number) => {
  const existing = db
    .prepare(
      `
      SELECT p.id
      FROM projects p
      INNER JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ?
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT 1
    `
    )
    .get(userId) as { id: number } | undefined;

  if (existing) return existing.id;

  const project = db
    .prepare("INSERT INTO projects (user_id, name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
    .run(userId, DEFAULT_PROJECT_NAME);
  const projectId = Number(project.lastInsertRowid);

  db.prepare(
    "INSERT OR IGNORE INTO project_members (project_id, user_id, added_by_user_id) VALUES (?, ?, ?)"
  ).run(projectId, userId, userId);
  db.prepare("INSERT OR IGNORE INTO settings (user_id, project_id, key, value) VALUES (?, ?, ?, ?)")
    .run(userId, projectId, "default_day_length", "8");

  return projectId;
};

export const ensureHostUser = (identity: TrustedHostIdentity): HostBackedUser => {
  const existing = db
    .prepare("SELECT id, name, email, is_admin, host_user_id, created_at FROM users WHERE host_user_id = ?")
    .get(identity.id) as HostBackedUser | undefined;

  const firstHostUser = !(
    db
      .prepare("SELECT id FROM users WHERE host_user_id IS NOT NULL LIMIT 1")
      .get() as { id: number } | undefined
  );
  const shouldBeAdmin = firstHostUser || identity.hostRole === "host.admin";

  if (existing) {
    const nextName = buildUniqueName(normalizeDisplayName(identity), existing.id);
    const nextEmail = identity.email ?? null;
    const nextIsAdmin = shouldBeAdmin ? 1 : existing.is_admin ?? 0;

    if (
      existing.name !== nextName ||
      existing.email !== nextEmail ||
      (existing.is_admin ?? 0) !== nextIsAdmin
    ) {
      db.prepare("UPDATE users SET name = ?, email = ?, is_admin = ? WHERE id = ?").run(
        nextName,
        nextEmail,
        nextIsAdmin,
        existing.id
      );
    }

    ensureDefaultProjectForUser(existing.id);
    return {
      ...existing,
      name: nextName,
      email: nextEmail,
      is_admin: nextIsAdmin,
    };
  }

  const name = buildUniqueName(normalizeDisplayName(identity));
  const email = identity.email ?? null;
  const created = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO users (name, email, is_admin, host_user_id) VALUES (?, ?, ?, ?)")
      .run(name, email, shouldBeAdmin ? 1 : 0, identity.id);
    const userId = Number(result.lastInsertRowid);
    ensureDefaultProjectForUser(userId);
    return db
      .prepare("SELECT id, name, email, is_admin, host_user_id, created_at FROM users WHERE id = ?")
      .get(userId) as HostBackedUser;
  });

  return created();
};
