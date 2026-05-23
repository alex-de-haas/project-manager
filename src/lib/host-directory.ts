import { getDockerHostInternalOrigin, getModuleId } from "@/lib/module-runtime";

export type HostDirectoryStatus =
  | "not-configured"
  | "ok"
  | "unavailable"
  | "forbidden"
  | "error";

export interface HostDirectoryUser {
  id: string;
  displayName: string | null;
  email: string | null;
  hostRole: string | null;
}

export interface HostDirectorySnapshot {
  status: HostDirectoryStatus;
  endpoint: string | null;
  serviceTokenConfigured: boolean;
  users: HostDirectoryUser[];
  updatedAt: string | null;
  error: {
    status: number | null;
    code: string;
    message: string;
  } | null;
}

const DIRECTORY_TIMEOUT_MS = 1500;

export const getHostDirectorySnapshot = async (): Promise<HostDirectorySnapshot> => {
  const endpoint = buildDirectoryEndpoint();
  const serviceToken = process.env.DOCKER_HOST_MODULE_SERVICE_TOKEN?.trim();

  if (!endpoint || !serviceToken) {
    return {
      status: "not-configured",
      endpoint,
      serviceTokenConfigured: Boolean(serviceToken),
      users: [],
      updatedAt: null,
      error: {
        status: null,
        code: "module_directory_not_configured",
        message: endpoint
          ? "DOCKER_HOST_MODULE_SERVICE_TOKEN is not configured."
          : "DOCKER_HOST_INTERNAL_ORIGIN is not configured or is not a valid URL.",
      },
    };
  }

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      return {
        status: response.status === 403 ? "forbidden" : "error",
        endpoint,
        serviceTokenConfigured: true,
        users: [],
        updatedAt: null,
        error: readApiError(payload, response.status),
      };
    }

    return {
      status: "ok",
      endpoint,
      serviceTokenConfigured: true,
      users: normalizeDirectoryUsers(payload),
      updatedAt: readString((payload as Record<string, unknown>).updatedAt),
      error: null,
    };
  } catch (error) {
    return {
      status: "unavailable",
      endpoint,
      serviceTokenConfigured: true,
      users: [],
      updatedAt: null,
      error: {
        status: null,
        code: "module_directory_unavailable",
        message: sanitizeError(error),
      },
    };
  }
};

const buildDirectoryEndpoint = () => {
  const internalOrigin = getDockerHostInternalOrigin();
  if (!internalOrigin) return null;

  try {
    return new URL(
      `/api/internal/modules/${encodeURIComponent(getModuleId())}/directory/users`,
      internalOrigin
    ).toString();
  } catch {
    return null;
  }
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const readApiError = (
  payload: unknown,
  status: number
): NonNullable<HostDirectorySnapshot["error"]> => {
  if (!payload || typeof payload !== "object") {
    return {
      status,
      code: "module_directory_error",
      message: `Module directory returned HTTP ${status}.`,
    };
  }

  const error = (payload as Record<string, unknown>).error;
  if (typeof error === "string" && error.trim()) {
    return {
      status,
      code: "module_directory_error",
      message: error.trim(),
    };
  }

  if (!error || typeof error !== "object") {
    return {
      status,
      code: "module_directory_error",
      message: `Module directory returned HTTP ${status}.`,
    };
  }

  const errorRecord = error as Record<string, unknown>;
  return {
    status,
    code: readString(errorRecord.code) || "module_directory_error",
    message: readString(errorRecord.message) || `Module directory returned HTTP ${status}.`,
  };
};

const normalizeDirectoryUsers = (payload: unknown): HostDirectoryUser[] => {
  if (!payload || typeof payload !== "object") return [];

  const users = (payload as Record<string, unknown>).users;
  if (!Array.isArray(users)) return [];

  return users
    .map((user) => {
      if (!user || typeof user !== "object") return null;

      const record = user as Record<string, unknown>;
      const id = readString(record.id);
      if (!id) return null;

      return {
        id,
        displayName: readString(record.displayName),
        email: readString(record.email),
        hostRole: readString(record.hostRole),
      };
    })
    .filter((user): user is HostDirectoryUser => user !== null);
};

const readString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const sanitizeError = (error: unknown) => {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Request timed out.";
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "Request was aborted.";
  }

  return error instanceof Error ? error.message : "Unknown error.";
};
