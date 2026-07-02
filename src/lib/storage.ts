import path from "path";

export const getDataDirPath = () => {
  // Hosty injects HOSTY_APP_DATA_DIR (the managed per-app data dir) for every runtime —
  // docker and dev/localCommand alike — so it is the single source of truth for where
  // persistent state lives. The cwd fallback only applies when running the app outside
  // Hosty (e.g. `next start` locally); under Hosty everything stays in the managed dir.
  const configured = process.env.HOSTY_APP_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "data");
};

export const getBackupDirPath = () => path.join(getDataDirPath(), "backups");
