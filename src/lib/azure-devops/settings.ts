import * as azdev from "azure-devops-node-api";
import { WorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import type { Identity } from "azure-devops-node-api/interfaces/IdentitiesInterfaces";
import db from "@/lib/db";
import {
  buildAzureDevOpsProjectUrl,
  parseAzureDevOpsProjectUrl,
} from "@/lib/azure-devops/project-url";
import type { AzureDevOpsSettings, Settings } from "@/types";

export const AZURE_DEVOPS_SETTINGS_KEY = "azure_devops";
export const AZURE_DEVOPS_PAT_CREDENTIAL_KEY = "azure_devops_pat";

export interface AzureDevOpsPublicSettings {
  organization: string;
  project: string;
  projectUrl: string;
  hasPat: boolean;
  identity: {
    displayName: string | null;
    email: string | null;
  } | null;
}

export interface AzureDevOpsProjectSettings {
  organization: string;
  project: string;
  projectUrl: string;
}

export interface AzureDevOpsConnectionContext {
  settings: AzureDevOpsSettings;
  orgUrl: string;
  connection: azdev.WebApi;
  witApi: WorkItemTrackingApi;
}

export interface AzureDevOpsAuthenticatedUser {
  id: string | null;
  descriptor?: string | null;
  displayName: string | null;
  uniqueName: string | null;
}

export type AzureDevOpsConfigStatus =
  | "missing_project_settings"
  | "invalid_project_settings"
  | "incomplete_project_settings"
  | "missing_personal_pat";

export interface AzureDevOpsConfigProblem {
  status: AzureDevOpsConfigStatus;
  message: string;
}

const parseSettings = (value: string): Partial<AzureDevOpsSettings> | null => {
  try {
    const parsed = JSON.parse(value) as Partial<AzureDevOpsSettings>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const readProjectSettingsRow = (projectId: number): Settings | undefined =>
  db
    .prepare(
      "SELECT id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?"
    )
    .get(AZURE_DEVOPS_SETTINGS_KEY, projectId) as Settings | undefined;

const getLocalUserDisplayName = (userId: number): string | null => {
  const row = db
    .prepare("SELECT name AS display_name FROM users WHERE id = ?")
    .get(userId) as { display_name: string | null } | undefined;

  return row?.display_name?.trim() || null;
};

export const normalizeAzureDevOpsProjectSettings = (
  settings: Partial<AzureDevOpsSettings>
): AzureDevOpsProjectSettings | null => {
  const projectUrl = settings.projectUrl?.trim() ?? "";
  if (projectUrl) {
    return parseAzureDevOpsProjectUrl(projectUrl);
  }

  const organization = settings.organization?.trim() ?? "";
  const project = settings.project?.trim() ?? "";
  if (!organization || !project) return null;

  return {
    organization,
    project,
    projectUrl: buildAzureDevOpsProjectUrl(organization, project),
  };
};

export const getAzureDevOpsProjectSettings = (
  projectId: number
): AzureDevOpsProjectSettings | null => {
  const row = readProjectSettingsRow(projectId);
  if (!row) return null;

  const settings = parseSettings(row.value);
  if (!settings) return null;

  const projectSettings = normalizeAzureDevOpsProjectSettings(settings);
  if (!projectSettings) return null;

  if (
    Object.prototype.hasOwnProperty.call(settings, "pat") ||
    settings.organization !== projectSettings.organization ||
    settings.project !== projectSettings.project ||
    settings.projectUrl !== projectSettings.projectUrl
  ) {
    upsertAzureDevOpsProjectSettings(projectId, projectSettings);
  }

  return projectSettings;
};

export const getAzureDevOpsUserPat = (
  userId: number,
  projectId: number
): string | null => {
  const row = db
    .prepare(
      "SELECT value FROM user_credentials WHERE user_id = ? AND project_id = ? AND key = ?"
    )
    .get(userId, projectId, AZURE_DEVOPS_PAT_CREDENTIAL_KEY) as
    | { value: string }
    | undefined;
  const pat = row?.value.trim();
  return pat || null;
};

export const hasAzureDevOpsUserPat = (
  userId: number,
  projectId: number
): boolean => Boolean(getAzureDevOpsUserPat(userId, projectId));

export const upsertAzureDevOpsProjectSettings = (
  projectId: number,
  settings: AzureDevOpsProjectSettings
) => {
  db.prepare(`
    INSERT INTO project_settings (project_id, key, value, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    projectId,
    AZURE_DEVOPS_SETTINGS_KEY,
    JSON.stringify({
      organization: settings.organization.trim(),
      project: settings.project.trim(),
      projectUrl: settings.projectUrl.trim(),
    })
  );
};

export const upsertAzureDevOpsUserPat = (
  userId: number,
  projectId: number,
  pat: string
) => {
  const trimmed = pat.trim();
  if (!trimmed) return;

  db.prepare(`
    INSERT INTO user_credentials (user_id, project_id, key, value, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, project_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, projectId, AZURE_DEVOPS_PAT_CREDENTIAL_KEY, trimmed);
};

export const deleteAzureDevOpsUserPat = (userId: number, projectId: number) => {
  db.prepare(
    "DELETE FROM user_credentials WHERE user_id = ? AND project_id = ? AND key = ?"
  ).run(userId, projectId, AZURE_DEVOPS_PAT_CREDENTIAL_KEY);
};

export const getStoredAzureDevOpsUserIdentity = (
  userId: number,
  projectId: number
): AzureDevOpsAuthenticatedUser | null => {
  const row = db
    .prepare(
      `
        SELECT
          identity.external_user_id,
          identity.descriptor,
          identity.display_name,
          identity.email
        FROM provider_user_identities identity
        WHERE identity.user_id = ?
          AND identity.project_id = ?
          AND identity.provider = 'azure_devops'
        LIMIT 1
      `
    )
    .get(userId, projectId) as
    | {
        external_user_id: string | null;
        descriptor: string | null;
        display_name: string | null;
        email: string | null;
      }
    | undefined;

  if (!row) return null;

  const identity = {
    id: row.external_user_id?.trim() || null,
    descriptor: row.descriptor?.trim() || null,
    displayName: row.display_name?.trim() || null,
    uniqueName: row.email?.trim() || null,
  };

  if (!identity.id && !identity.descriptor && !identity.displayName && !identity.uniqueName) {
    return null;
  }

  return identity;
};

export const upsertAzureDevOpsUserIdentity = (
  userId: number,
  projectId: number,
  identity: AzureDevOpsAuthenticatedUser
) => {
  const providerDisplayName = identity.displayName?.trim() || null;
  db.prepare(
    `
      INSERT INTO provider_user_identities (
        project_id,
        user_id,
        provider,
        external_user_id,
        descriptor,
        display_name,
        email,
        updated_at
      )
      VALUES (?, ?, 'azure_devops', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id, user_id, provider) DO UPDATE SET
        external_user_id = excluded.external_user_id,
        descriptor = excluded.descriptor,
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(
    projectId,
    userId,
    identity.id,
    identity.descriptor ?? identity.id,
    providerDisplayName,
    identity.uniqueName && identity.uniqueName.includes("@") ? identity.uniqueName : null
  );
};

export const getAzureDevOpsPublicSettings = (
  userId: number,
  projectId: number
): AzureDevOpsPublicSettings | null => {
  const projectSettings = getAzureDevOpsProjectSettings(projectId);
  if (!projectSettings) return null;
  const hasPat = hasAzureDevOpsUserPat(userId, projectId);
  const identity = hasPat ? getStoredAzureDevOpsUserIdentity(userId, projectId) : null;

  return {
    ...projectSettings,
    hasPat,
    identity: identity
      ? {
          displayName: identity.displayName ?? getLocalUserDisplayName(userId),
          email: identity.uniqueName,
        }
      : null,
  };
};

export const getAzureDevOpsSettingsProblem = (
  userId: number,
  projectId: number
): AzureDevOpsConfigProblem | null => {
  const row = readProjectSettingsRow(projectId);
  if (!row) {
    return {
      status: "missing_project_settings",
      message: "Azure DevOps settings not configured. Please configure organization and project.",
    };
  }

  const settings = parseSettings(row.value);
  if (!settings) {
    return {
      status: "invalid_project_settings",
      message: "Invalid Azure DevOps settings format.",
    };
  }

  const projectSettings = normalizeAzureDevOpsProjectSettings(settings);
  if (!projectSettings) {
    return {
      status: "incomplete_project_settings",
      message: "Azure DevOps settings incomplete. Please check the project URL.",
    };
  }

  if (Object.prototype.hasOwnProperty.call(settings, "pat")) {
    upsertAzureDevOpsProjectSettings(projectId, projectSettings);
  }

  if (!getAzureDevOpsUserPat(userId, projectId)) {
    return {
      status: "missing_personal_pat",
      message:
        "Azure DevOps account link is not configured for the current user in this project.",
    };
  }

  return null;
};

export const getAzureDevOpsSettingsForUser = (
  userId: number,
  projectId: number
): AzureDevOpsSettings | AzureDevOpsConfigProblem => {
  const problem = getAzureDevOpsSettingsProblem(userId, projectId);
  if (problem) return problem;

  const projectSettings = getAzureDevOpsProjectSettings(projectId);
  const pat = getAzureDevOpsUserPat(userId, projectId);
  if (!projectSettings || !pat) {
    return {
      status: "incomplete_project_settings",
      message: "Azure DevOps settings incomplete.",
    };
  }

  return {
    ...projectSettings,
    pat,
  };
};

export const isAzureDevOpsConfigProblem = (
  value: AzureDevOpsSettings | AzureDevOpsConfigProblem
): value is AzureDevOpsConfigProblem => "status" in value;

const readIdentityProperty = (
  identity: Identity,
  propertyName: string
): string | null => {
  if (!identity.properties || typeof identity.properties !== "object") {
    return null;
  }

  const properties = identity.properties as Record<string, unknown>;
  const property = properties[propertyName];

  if (typeof property === "string") {
    return property.trim() || null;
  }

  if (!property || typeof property !== "object") {
    return null;
  }

  const propertyObject = property as Record<string, unknown>;
  const value = propertyObject.$value ?? propertyObject.value;

  return typeof value === "string" ? value.trim() || null : null;
};

const isEmailLike = (value: string): boolean =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

const normalizeAzureDevOpsDisplayName = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const displayName = value?.trim();
    if (displayName && !isEmailLike(displayName)) return displayName;
  }

  return null;
};

const normalizeAzureDevOpsIdentity = (
  identity?: Identity
): AzureDevOpsAuthenticatedUser | null => {
  if (!identity) return null;
  const descriptorIdentity = identity as Identity & {
    descriptor?: string;
    subjectDescriptor?: string;
  };

  const displayName = normalizeAzureDevOpsDisplayName(
    identity.providerDisplayName,
    identity.customDisplayName,
    readIdentityProperty(identity, "DisplayName")
  );
  const uniqueName =
    readIdentityProperty(identity, "Account") ||
    readIdentityProperty(identity, "Mail") ||
    readIdentityProperty(identity, "PreferredEmailAddress") ||
    identity.socialDescriptor?.trim() ||
    null;

  return {
    id: identity.id?.trim() || null,
    descriptor:
      descriptorIdentity.descriptor?.trim() ||
      descriptorIdentity.subjectDescriptor?.trim() ||
      identity.id?.trim() ||
      null,
    displayName,
    uniqueName,
  };
};

export const getAzureDevOpsAuthenticatedUser = async (
  connection: azdev.WebApi
): Promise<AzureDevOpsAuthenticatedUser | null> => {
  const connectionData = await connection.connect();
  return normalizeAzureDevOpsIdentity(
    connectionData.authenticatedUser ?? connectionData.authorizedUser
  );
};

export const getOrResolveAzureDevOpsUserIdentity = async (
  userId: number,
  projectId: number,
  connection: azdev.WebApi
): Promise<AzureDevOpsAuthenticatedUser | null> => {
  const storedIdentity = getStoredAzureDevOpsUserIdentity(userId, projectId);
  if (storedIdentity) return storedIdentity;

  const resolvedIdentity = await getAzureDevOpsAuthenticatedUser(connection);
  if (resolvedIdentity) {
    upsertAzureDevOpsUserIdentity(userId, projectId, resolvedIdentity);
  }

  return resolvedIdentity;
};

export const createAzureDevOpsConnectionContext = async (
  settings: AzureDevOpsSettings
): Promise<AzureDevOpsConnectionContext> => {
  const orgUrl = `https://dev.azure.com/${settings.organization}`;
  const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat);
  const connection = new azdev.WebApi(orgUrl, authHandler);
  const witApi: WorkItemTrackingApi = await connection.getWorkItemTrackingApi();

  return {
    settings,
    orgUrl,
    connection,
    witApi,
  };
};
