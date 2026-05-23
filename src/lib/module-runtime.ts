export const PROJECT_MANAGER_MODULE_ID = "com.haas.project-manager";

export const getModuleId = () =>
  process.env.DOCKER_HOST_MODULE_ID?.trim() ||
  process.env.PROJECT_MANAGER_MODULE_ID?.trim() ||
  PROJECT_MANAGER_MODULE_ID;

export const getDockerHostInternalOrigin = () => {
  const value = process.env.DOCKER_HOST_INTERNAL_ORIGIN?.trim();
  return value ? value.replace(/\/+$/, "") : null;
};
