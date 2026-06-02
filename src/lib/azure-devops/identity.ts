import type { AzureDevOpsAuthenticatedUser } from "@/lib/azure-devops/settings";
import db from "@/lib/db";

export interface AzureDevOpsIdentitySnapshot {
  id: string | null;
  displayName: string | null;
  uniqueName: string | null;
}

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const readIdentityField = (
  source: Record<string, unknown>,
  fieldName: string
): string | null => {
  const value = source[fieldName];
  const directValue = readString(value);
  if (directValue) return directValue;

  if (!value || typeof value !== "object") return null;

  const nested = value as Record<string, unknown>;
  return readString(nested.$value) || readString(nested.value);
};

const extractEmail = (value: string | null): string | null => {
  if (!value) return null;
  const bracketMatch = value.match(/<([^<>@\s]+@[^<>\s]+)>/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim().toLowerCase();

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch?.[0]?.trim().toLowerCase() ?? null;
};

const normalizeComparable = (value: string | null): string | null =>
  value?.trim().toLowerCase() || null;

const getAzureDevOpsIdentityCandidates = (
  identity: AzureDevOpsIdentitySnapshot | null
): string[] => {
  if (!identity) return [];

  return Array.from(
    new Set(
      [
        normalizeComparable(identity.id),
        normalizeComparable(identity.uniqueName),
        normalizeComparable(identity.displayName),
        extractEmail(identity.displayName),
        extractEmail(identity.uniqueName),
      ].filter(Boolean) as string[]
    )
  );
};

export const normalizeAzureDevOpsWorkItemIdentity = (
  value: unknown
): AzureDevOpsIdentitySnapshot | null => {
  const textValue = readString(value);
  if (textValue) {
    return {
      id: null,
      displayName: textValue,
      uniqueName: extractEmail(textValue),
    };
  }

  if (!value || typeof value !== "object") return null;

  const source = value as Record<string, unknown>;
  const displayName =
    readIdentityField(source, "displayName") ||
    readIdentityField(source, "providerDisplayName") ||
    readIdentityField(source, "customDisplayName") ||
    readIdentityField(source, "name");
  const uniqueName =
    readIdentityField(source, "uniqueName") ||
    readIdentityField(source, "mail") ||
    readIdentityField(source, "email") ||
    readIdentityField(source, "preferredEmailAddress") ||
    extractEmail(displayName);
  const id =
    readIdentityField(source, "id") ||
    readIdentityField(source, "descriptor") ||
    readIdentityField(source, "subjectDescriptor");

  if (!id && !displayName && !uniqueName) return null;

  return {
    id,
    displayName,
    uniqueName,
  };
};

export const isAzureDevOpsIdentityAssignedToUser = (
  assignedTo: AzureDevOpsIdentitySnapshot | null,
  authenticatedUser: AzureDevOpsAuthenticatedUser | null
): boolean | null => {
  if (!authenticatedUser) return null;
  if (!assignedTo) return false;

  const assignedCandidates = new Set(
    [
      normalizeComparable(assignedTo.id),
      normalizeComparable(assignedTo.uniqueName),
      normalizeComparable(assignedTo.displayName),
      extractEmail(assignedTo.displayName),
      extractEmail(assignedTo.uniqueName),
    ].filter(Boolean) as string[]
  );

  const currentUserCandidates = [
    normalizeComparable(authenticatedUser.id),
    normalizeComparable(authenticatedUser.descriptor ?? null),
    normalizeComparable(authenticatedUser.uniqueName),
    normalizeComparable(authenticatedUser.displayName),
    extractEmail(authenticatedUser.displayName),
    extractEmail(authenticatedUser.uniqueName),
  ].filter(Boolean) as string[];

  return currentUserCandidates.some((candidate) => assignedCandidates.has(candidate));
};

export const findMappedAzureDevOpsUserId = (
  projectId: number,
  assignedTo: AzureDevOpsIdentitySnapshot | null
): number | null => {
  const candidates = getAzureDevOpsIdentityCandidates(assignedTo);
  if (candidates.length === 0) return null;

  const placeholders = candidates.map(() => "?").join(", ");

  const row = db
    .prepare(
      `
        SELECT provider_user_identities.user_id
        FROM provider_user_identities
        INNER JOIN users ON users.id = provider_user_identities.user_id
        WHERE provider_user_identities.provider = 'azure_devops'
          AND provider_user_identities.project_id = ?
          AND (
            lower(COALESCE(provider_user_identities.email, '')) IN (${placeholders})
            OR lower(COALESCE(users.email, '')) IN (${placeholders})
            OR lower(COALESCE(provider_user_identities.external_user_id, '')) IN (${placeholders})
            OR lower(COALESCE(provider_user_identities.descriptor, '')) IN (${placeholders})
            OR lower(COALESCE(provider_user_identities.display_name, '')) IN (${placeholders})
          )
        LIMIT 1
      `
    )
    .get(
      projectId,
      ...candidates,
      ...candidates,
      ...candidates,
      ...candidates,
      ...candidates
    ) as { user_id: number } | undefined;

  return row?.user_id ?? null;
};

export const createAzureDevOpsUserMapper = (projectId: number) => {
  const cache = new Map<string, number | null>();

  return (assignedTo: AzureDevOpsIdentitySnapshot | null): number | null => {
    const candidates = getAzureDevOpsIdentityCandidates(assignedTo);
    if (candidates.length === 0) return null;

    const cacheKey = candidates.join("\u0000");
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, findMappedAzureDevOpsUserId(projectId, assignedTo));
    }

    return cache.get(cacheKey) ?? null;
  };
};
