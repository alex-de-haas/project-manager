import db from "@/lib/db";
import type { User } from "@/types";
import type { TrustedHostIdentity } from "@/lib/host-identity";
import type { HostDirectoryUser } from "@/lib/host-directory";

export type HostBackedUser = User & { host_user_id: string };

type HostUserIdentityInput = Pick<TrustedHostIdentity, "id" | "email" | "name">;

const HOST_BACKED_USER_COLUMNS =
  "id, name, app_display_name, email, is_admin, host_user_id, created_at";

const normalizeDisplayName = (identity: HostUserIdentityInput) => {
  const fromName = identity.name?.trim();
  if (fromName) return fromName;

  const fromEmail = identity.email?.split("@")[0]?.trim();
  if (fromEmail) return fromEmail;

  return identity.id;
};

const buildUniqueName = (name: string, currentUserId?: number) => {
  const baseName = name.slice(0, 120) || "Hosty User";
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

const selectHostBackedUserById = (userId: number) =>
  db
    .prepare(`SELECT ${HOST_BACKED_USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as HostBackedUser | undefined;

const isHostAdminRole = (hostRole: string | null | undefined) => hostRole === "host.admin";

export const listHostBackedUsers = (): HostBackedUser[] =>
  db
    .prepare(
      `
        SELECT ${HOST_BACKED_USER_COLUMNS}
        FROM users
        WHERE host_user_id IS NOT NULL
        ORDER BY created_at ASC, id ASC
      `
    )
    .all() as HostBackedUser[];

export const upsertHostDirectoryUsers = (directoryUsers: HostDirectoryUser[]): HostBackedUser[] => {
  const uniqueUsers = new Map<string, HostDirectoryUser>();
  for (const user of directoryUsers) {
    const id = user.id.trim();
    if (id) {
      uniqueUsers.set(id, { ...user, id });
    }
  }

  const syncUsers = db.transaction((users: HostDirectoryUser[]) =>
    users.map((user) => {
      const existing = db
        .prepare(`SELECT ${HOST_BACKED_USER_COLUMNS} FROM users WHERE host_user_id = ?`)
        .get(user.id) as HostBackedUser | undefined;
      const nextName = buildUniqueName(
        normalizeDisplayName({
          id: user.id,
          email: user.email ?? existing?.email ?? null,
          name: user.displayName ?? existing?.name ?? null,
        }),
        existing?.id
      );
      const nextEmail = user.email ?? existing?.email ?? null;
      const nextIsAdmin = isHostAdminRole(user.hostRole) ? 1 : 0;

      if (existing) {
        if (
          existing.name !== nextName ||
          existing.email !== nextEmail ||
          (existing.is_admin ?? 0) !== nextIsAdmin
        ) {
          db.prepare(
            `
              UPDATE users
              SET name = ?,
                  app_display_name = COALESCE(app_display_name, ?),
                  email = ?,
                  is_admin = ?
              WHERE host_user_id = ?
            `
          ).run(nextName, nextName, nextEmail, nextIsAdmin, user.id);
        }

        return {
          ...existing,
          name: nextName,
          email: nextEmail,
          is_admin: nextIsAdmin,
        };
      }

      const created = db
        .prepare(
          "INSERT INTO users (name, app_display_name, email, is_admin, host_user_id) VALUES (?, ?, ?, ?, ?)"
        )
        .run(nextName, nextName, nextEmail, nextIsAdmin, user.id);
      const userId = Number(created.lastInsertRowid);
      const row = selectHostBackedUserById(userId);
      if (!row) {
        throw new Error("Failed to create Host directory user");
      }
      return row;
    })
  );

  return syncUsers([...uniqueUsers.values()]);
};

export const ensureHostUser = (identity: TrustedHostIdentity): HostBackedUser => {
  const existing = db
    .prepare(`SELECT ${HOST_BACKED_USER_COLUMNS} FROM users WHERE host_user_id = ?`)
    .get(identity.id) as HostBackedUser | undefined;

  const shouldBeAdmin = isHostAdminRole(identity.hostRole);

  if (existing) {
    const nextName = buildUniqueName(normalizeDisplayName(identity), existing.id);
    const nextEmail = identity.email ?? null;
    const nextIsAdmin = shouldBeAdmin ? 1 : existing.is_admin ?? 0;

    if (
      existing.name !== nextName ||
      existing.email !== nextEmail ||
      (existing.is_admin ?? 0) !== nextIsAdmin
    ) {
      db.prepare(
        `
          UPDATE users
          SET name = ?,
              app_display_name = COALESCE(app_display_name, ?),
              email = ?,
              is_admin = ?
          WHERE id = ?
        `
      ).run(nextName, nextName, nextEmail, nextIsAdmin, existing.id);
    }

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
      .prepare(
        "INSERT INTO users (name, app_display_name, email, is_admin, host_user_id) VALUES (?, ?, ?, ?, ?)"
      )
      .run(name, name, email, shouldBeAdmin ? 1 : 0, identity.id);
    const userId = Number(result.lastInsertRowid);
    return db
      .prepare(`SELECT ${HOST_BACKED_USER_COLUMNS} FROM users WHERE id = ?`)
      .get(userId) as HostBackedUser;
  });

  return created();
};
