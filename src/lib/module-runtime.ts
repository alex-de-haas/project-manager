export const PROJECT_MANAGER_APP_ID = "com.haas.project-manager";

export const getAppId = () =>
  process.env.HOSTY_APP_ID?.trim() ||
  process.env.DOCKER_HOST_MODULE_ID?.trim() ||
  process.env.PROJECT_MANAGER_APP_ID?.trim() ||
  process.env.PROJECT_MANAGER_MODULE_ID?.trim() ||
  PROJECT_MANAGER_APP_ID;

export const getModuleId = getAppId;

export const getHostyInternalOrigin = () => {
  const value =
    process.env.HOSTY_INTERNAL_ORIGIN?.trim() ||
    process.env.DOCKER_HOST_INTERNAL_ORIGIN?.trim();
  return value ? value.replace(/\/+$/, "") : null;
};

export const getDockerHostInternalOrigin = getHostyInternalOrigin;
