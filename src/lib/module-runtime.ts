export const PROJECT_MANAGER_APP_ID = "com.haas.project-manager";

export const getAppId = () =>
  process.env.HOSTY_APP_ID?.trim() ||
  process.env.PROJECT_MANAGER_APP_ID?.trim() ||
  PROJECT_MANAGER_APP_ID;

export const getModuleId = getAppId;

export const getHostyCoreOrigin = () => {
  const value =
    process.env.HOSTY_CORE_ORIGIN?.trim() ||
    process.env.HOST_CORE_PUBLIC_ORIGIN?.trim();
  return value ? value.replace(/\/+$/, "") : null;
};

export const getHostyInternalOrigin = getHostyCoreOrigin;
export const getDockerHostInternalOrigin = getHostyInternalOrigin;
