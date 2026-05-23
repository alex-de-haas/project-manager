import path from "path";

export const getDataDirPath = () => {
  const configured = process.env.PROJECT_MANAGER_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "data");
};

export const getBackupDirPath = () => path.join(getDataDirPath(), "backups");
