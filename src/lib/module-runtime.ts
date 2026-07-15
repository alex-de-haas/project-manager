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

// Browser-reachable Core origin, used for client-side session recovery redirects
// (`/api/apps/{appId}/open`). Never send the browser to the server-internal
// HOSTY_CORE_ORIGIN; fall back to it only when the public origin is not injected.
export const getHostyCorePublicOrigin = () => {
  const value =
    process.env.HOSTY_CORE_PUBLIC_ORIGIN?.trim() ||
    process.env.HOST_CORE_PUBLIC_ORIGIN?.trim();
  return value ? value.replace(/\/+$/, "") : getHostyCoreOrigin();
};

export const getHostyInternalOrigin = getHostyCoreOrigin;
export const getDockerHostInternalOrigin = getHostyInternalOrigin;
