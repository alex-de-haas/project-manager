export interface ParsedAzureDevOpsProjectUrl {
  organization: string;
  project: string;
  projectUrl: string;
}

const DEV_AZURE_HOST = "dev.azure.com";
const VISUAL_STUDIO_HOST_SUFFIX = ".visualstudio.com";

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parsePathSegments = (url: URL) =>
  url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeURIComponent(segment).trim());

export const buildAzureDevOpsProjectUrl = (organization: string, project: string) =>
  `https://${DEV_AZURE_HOST}/${encodeURIComponent(organization.trim())}/${encodeURIComponent(
    project.trim()
  )}`;

export const parseAzureDevOpsProjectUrl = (
  value: string
): ParsedAzureDevOpsProjectUrl | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = parsePathSegments(url);
  let organization = "";
  let project = "";

  if (host === DEV_AZURE_HOST) {
    organization = segments[0] ?? "";
    project = segments[1] ?? "";
  } else if (host.endsWith(VISUAL_STUDIO_HOST_SUFFIX)) {
    organization = url.hostname.slice(0, -VISUAL_STUDIO_HOST_SUFFIX.length);
    project = segments[0] ?? "";
  }

  if (!organization || !project) return null;

  return {
    organization,
    project,
    projectUrl: buildAzureDevOpsProjectUrl(organization, project),
  };
};
