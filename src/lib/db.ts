import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getBackupDirPath, getDataDirPath } from "@/lib/storage";

const dataDirPath = getDataDirPath();
const dbPath = path.join(dataDirPath, "project_manager.db");
const backupDirPath = getBackupDirPath();
const backupAlias = "restore_source";
const schemaVersion = "domain-model-v3";

const ensureDataDirectory = () => {
  if (!fs.existsSync(dataDirPath)) {
    fs.mkdirSync(dataDirPath, { recursive: true });
  }
};

let dbAvailable = true;

const createUnavailableDb = (error: unknown) =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `Database unavailable: better-sqlite3 native bindings could not be loaded. Tried to access "${String(prop)}". Original error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      },
    }
  );

ensureDataDirectory();

const db: any = (() => {
  try {
    return new Database(dbPath);
  } catch (error) {
    dbAvailable = false;
    console.error("Database initialization error:", error);
    return createUnavailableDb(error);
  }
})();

const initDb = () => {
  db.pragma("foreign_keys = ON");

  const moduleSettingsExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'module_settings'"
    )
    .get() as { name: string } | undefined;
  const currentSchemaVersion = moduleSettingsExists
    ? ((db
        .prepare("SELECT value FROM module_settings WHERE key = 'schema_version'")
        .get() as { value: string } | undefined)?.value ?? null)
    : null;
  const tableCount = (db
    .prepare(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .get() as { count: number }).count;

  if (tableCount > 0 && currentSchemaVersion !== schemaVersion) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      DROP TABLE IF EXISTS checklist_items;
      DROP TABLE IF EXISTS blockers;
      DROP TABLE IF EXISTS time_entries;
      DROP TABLE IF EXISTS release_items;
      DROP TABLE IF EXISTS releases;
      DROP TABLE IF EXISTS work_item_external_links;
      DROP TABLE IF EXISTS provider_user_identities;
      DROP TABLE IF EXISTS work_items;
      DROP TABLE IF EXISTS day_offs;
      DROP TABLE IF EXISTS settings;
      DROP TABLE IF EXISTS project_settings;
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS user_credentials;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS module_settings;
    `);
    db.pragma("foreign_keys = ON");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_user_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      app_display_name TEXT,
      email TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      integration_provider TEXT NOT NULL DEFAULT 'none',
      integration_enabled INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(name),
      CHECK(integration_provider IN ('none', 'azure_devops'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      added_by_user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, key)
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      tags TEXT,
      assigned_user_id INTEGER,
      parent_work_item_id INTEGER,
      display_order INTEGER DEFAULT 0,
      completed_at DATETIME,
      sync_state TEXT NOT NULL DEFAULT 'synced',
      created_by_user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CHECK(type IN ('user_story', 'task', 'bug')),
      CHECK(status IN ('new', 'in_progress', 'resolved', 'completed')),
      CHECK(sync_state IN ('synced', 'sync_failed', 'not_synced'))
    );

    CREATE TABLE IF NOT EXISTS work_item_external_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_url TEXT,
      native_type TEXT,
      native_status TEXT,
      native_assignee_id TEXT,
      native_assignee_name TEXT,
      native_assignee_unique_name TEXT,
      native_assignee_is_current_user INTEGER,
      provider_changed_at DATETIME,
      provider_revision TEXT,
      payload_hash TEXT,
      sanitized_snapshot TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      sync_status TEXT NOT NULL DEFAULT 'synced',
      last_sync_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, provider, external_id),
      UNIQUE(work_item_id, provider)
    );

    CREATE TABLE IF NOT EXISTS provider_user_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      external_user_id TEXT,
      descriptor TEXT,
      display_name TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(project_id, user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(work_item_id, user_id, date)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(user_id, project_id, key)
    );

    CREATE TABLE IF NOT EXISTS user_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, project_id, key)
    );

    CREATE TABLE IF NOT EXISTS module_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS day_offs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      is_half_day INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, date)
    );

    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      display_order INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS release_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      notes TEXT,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      UNIQUE(release_id, work_item_id)
    );

    CREATE TABLE IF NOT EXISTS blockers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id INTEGER NOT NULL,
      comment TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      is_resolved INTEGER DEFAULT 0,
      created_by_user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by_user_id INTEGER,
      resolution_comment TEXT,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CHECK(severity IN ('low', 'medium', 'high', 'critical'))
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      created_by_user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      locked_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_host_user_id ON users(host_user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_integration_provider ON projects(integration_provider);
    CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_project_settings_project_key ON project_settings(project_id, key);
    CREATE INDEX IF NOT EXISTS idx_work_items_assigned_user_id ON work_items(assigned_user_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_type ON work_items(type);
    CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
    CREATE INDEX IF NOT EXISTS idx_work_items_parent_work_item_id ON work_items(parent_work_item_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_created_at ON work_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_work_item_external_links_work_item_id ON work_item_external_links(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_work_item_external_links_provider_external ON work_item_external_links(provider, external_id);
    CREATE INDEX IF NOT EXISTS idx_provider_user_identities_project_provider ON provider_user_identities(project_id, provider);
    CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
    CREATE INDEX IF NOT EXISTS idx_time_entries_work_item_date ON time_entries(work_item_id, user_id, date);
    CREATE INDEX IF NOT EXISTS idx_settings_user_project_key ON settings(user_id, project_id, key);
    CREATE INDEX IF NOT EXISTS idx_user_credentials_user_project_key ON user_credentials(user_id, project_id, key);
    CREATE INDEX IF NOT EXISTS idx_module_settings_key ON module_settings(key);
    CREATE INDEX IF NOT EXISTS idx_dayoffs_user_date ON day_offs(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_dayoffs_date ON day_offs(date);
    CREATE INDEX IF NOT EXISTS idx_releases_user_id ON releases(user_id);
    CREATE INDEX IF NOT EXISTS idx_releases_project_id ON releases(project_id);
    CREATE INDEX IF NOT EXISTS idx_releases_start_date ON releases(start_date);
    CREATE INDEX IF NOT EXISTS idx_releases_end_date ON releases(end_date);
    CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);
    CREATE INDEX IF NOT EXISTS idx_release_items_release_id ON release_items(release_id);
    CREATE INDEX IF NOT EXISTS idx_release_items_work_item_id ON release_items(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_blockers_work_item_id ON blockers(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_blockers_resolved ON blockers(is_resolved);
    CREATE INDEX IF NOT EXISTS idx_checklist_user_id ON checklist_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_work_item_id ON checklist_items(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_order ON checklist_items(work_item_id, user_id, display_order);
  `);

  const userColumns = db
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "app_display_name")) {
    db.prepare("ALTER TABLE users ADD COLUMN app_display_name TEXT").run();
  }
  db.prepare(
    `
      UPDATE users
      SET app_display_name = COALESCE(app_display_name, name)
      WHERE app_display_name IS NULL
    `
  ).run();
  db.prepare(`
    INSERT INTO module_settings (key, value, updated_at)
    VALUES ('schema_version', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(schemaVersion);
};

if (dbAvailable) {
  initDb();
}

interface BackupFileInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

const ensureBackupDirectory = () => {
  if (!fs.existsSync(backupDirPath)) {
    fs.mkdirSync(backupDirPath, { recursive: true });
  }
};

const sanitizeBackupFileName = (fileName: string) => {
  if (!/^[a-zA-Z0-9._-]+\.db$/.test(fileName)) {
    throw new Error("Invalid backup file name");
  }
  return fileName;
};

const resolveBackupPath = (fileName: string) => {
  const safeFileName = sanitizeBackupFileName(fileName);
  const fullPath = path.resolve(backupDirPath, safeFileName);

  if (!fullPath.startsWith(`${backupDirPath}${path.sep}`)) {
    throw new Error("Invalid backup path");
  }

  return fullPath;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const generateBackupFileName = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  const hh = `${now.getHours()}`.padStart(2, "0");
  const min = `${now.getMinutes()}`.padStart(2, "0");
  const sec = `${now.getSeconds()}`.padStart(2, "0");

  return `time_tracker_backup_${yyyy}${mm}${dd}_${hh}${min}${sec}.db`;
};

export const createDatabaseBackup = async (
  requestedFileName?: string
): Promise<BackupFileInfo> => {
  ensureBackupDirectory();

  const fileName = requestedFileName
    ? sanitizeBackupFileName(requestedFileName)
    : generateBackupFileName();
  const backupPath = resolveBackupPath(fileName);

  if (fs.existsSync(backupPath)) {
    throw new Error("A backup file with this name already exists");
  }

  await db.backup(backupPath);
  const stats = fs.statSync(backupPath);

  return {
    fileName,
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
  };
};

export const listDatabaseBackups = (): BackupFileInfo[] => {
  ensureBackupDirectory();

  return fs
    .readdirSync(backupDirPath)
    .filter((entry) => entry.endsWith(".db"))
    .map((fileName) => {
      const fullPath = resolveBackupPath(fileName);
      const stats = fs.statSync(fullPath);

      return {
        fileName,
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const deleteDatabaseBackup = (fileName: string) => {
  ensureBackupDirectory();
  const backupPath = resolveBackupPath(fileName);

  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file not found");
  }

  fs.unlinkSync(backupPath);
};

export const restoreDatabaseFromBackup = (fileName: string) => {
  ensureBackupDirectory();
  const backupPath = resolveBackupPath(fileName);

  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file not found");
  }

  const escapedPath = backupPath.replace(/'/g, "''");

  db.exec("PRAGMA foreign_keys = OFF");
  let attached = false;
  let transactionStarted = false;

  try {
    db.exec(`ATTACH DATABASE '${escapedPath}' AS ${backupAlias}`);
    attached = true;

    const mainTables = db
      .prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const sourceTables = db
      .prepare(
        `SELECT name FROM ${backupAlias}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as Array<{ name: string }>;

    const sourceTableSet = new Set(sourceTables.map((table) => table.name));
    const tablesToRestore = mainTables
      .map((table) => table.name)
      .filter((tableName) => sourceTableSet.has(tableName));

    if (tablesToRestore.length === 0) {
      throw new Error("Backup does not contain compatible tables");
    }

    db.exec("BEGIN");
    transactionStarted = true;

    for (const tableName of tablesToRestore) {
      const quotedName = quoteIdentifier(tableName);
      db.exec(`DELETE FROM main.${quotedName}`);
      db.exec(`INSERT INTO main.${quotedName} SELECT * FROM ${backupAlias}.${quotedName}`);
    }

    const mainHasSqliteSequence = db
      .prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
      .get() as { name: string } | undefined;
    const backupHasSqliteSequence = db
      .prepare(
        `SELECT name FROM ${backupAlias}.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`
      )
      .get() as { name: string } | undefined;

    if (mainHasSqliteSequence && backupHasSqliteSequence) {
      db.exec("DELETE FROM main.sqlite_sequence");
      db.exec(`INSERT INTO main.sqlite_sequence SELECT * FROM ${backupAlias}.sqlite_sequence`);
    }

    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    if (attached) {
      db.exec(`DETACH DATABASE ${backupAlias}`);
    }
    db.exec("PRAGMA foreign_keys = ON");
  }
};

export default db;
