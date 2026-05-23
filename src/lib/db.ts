import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getBackupDirPath, getDataDirPath } from "@/lib/storage";

const dataDirPath = getDataDirPath();
const dbPath = path.join(dataDirPath, "time_tracker.db");
const backupDirPath = getBackupDirPath();
const backupAlias = "restore_source";

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_user_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      email TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
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

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'task',
      status TEXT,
      tags TEXT,
      external_id TEXT,
      external_source TEXT,
      display_order INTEGER DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      CHECK(type IN ('task', 'bug'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(task_id, date)
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

    CREATE TABLE IF NOT EXISTS day_offs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      is_half_day INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(user_id, project_id, date)
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

    CREATE TABLE IF NOT EXISTS release_work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      release_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      external_id TEXT,
      external_source TEXT,
      work_item_type TEXT,
      state TEXT,
      tags TEXT,
      notes TEXT,
      task_id INTEGER,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS release_work_item_children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_external_id INTEGER NOT NULL,
      child_external_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      work_item_type TEXT NOT NULL,
      state TEXT,
      assigned_to TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, child_external_id)
    );

    CREATE TABLE IF NOT EXISTS blockers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      comment TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      is_resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolution_comment TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      CHECK(severity IN ('low', 'medium', 'high', 'critical'))
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_host_user_id ON users(host_user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_project_settings_project_key ON project_settings(project_id, key);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_external_id ON tasks(external_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
    CREATE INDEX IF NOT EXISTS idx_time_entries_task_date ON time_entries(task_id, date);
    CREATE INDEX IF NOT EXISTS idx_settings_user_project_key ON settings(user_id, project_id, key);
    CREATE INDEX IF NOT EXISTS idx_dayoffs_user_date ON day_offs(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_dayoffs_user_project_date ON day_offs(user_id, project_id, date);
    CREATE INDEX IF NOT EXISTS idx_dayoffs_date ON day_offs(date);
    CREATE INDEX IF NOT EXISTS idx_releases_user_id ON releases(user_id);
    CREATE INDEX IF NOT EXISTS idx_releases_project_id ON releases(project_id);
    CREATE INDEX IF NOT EXISTS idx_releases_start_date ON releases(start_date);
    CREATE INDEX IF NOT EXISTS idx_releases_end_date ON releases(end_date);
    CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);
    CREATE INDEX IF NOT EXISTS idx_release_work_items_user_id ON release_work_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_release_work_items_project_id ON release_work_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_release_work_items_release_id ON release_work_items(release_id);
    CREATE INDEX IF NOT EXISTS idx_release_work_items_external_id ON release_work_items(external_id);
    CREATE INDEX IF NOT EXISTS idx_release_work_items_task_id ON release_work_items(task_id);
    CREATE INDEX IF NOT EXISTS idx_release_work_item_children_parent ON release_work_item_children(project_id, parent_external_id);
    CREATE INDEX IF NOT EXISTS idx_release_work_item_children_type ON release_work_item_children(project_id, work_item_type);
    CREATE INDEX IF NOT EXISTS idx_blockers_user_id ON blockers(user_id);
    CREATE INDEX IF NOT EXISTS idx_blockers_project_id ON blockers(project_id);
    CREATE INDEX IF NOT EXISTS idx_blockers_task_id ON blockers(task_id);
    CREATE INDEX IF NOT EXISTS idx_blockers_resolved ON blockers(is_resolved);
    CREATE INDEX IF NOT EXISTS idx_checklist_user_id ON checklist_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_project_id ON checklist_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_task_id ON checklist_items(task_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_order ON checklist_items(task_id, display_order);
  `);
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
