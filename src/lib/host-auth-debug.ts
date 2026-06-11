export const HOST_AUTH_LOG_PREFIX = "[project-manager host-auth]";

export function describeOpaqueValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "missing";
  }

  return `present length=${trimmed.length}`;
}

export function describeUrlForAuth(value: string | URL) {
  try {
    const url = typeof value === "string" ? new URL(value, "http://project-manager.local") : value;
    return {
      path: url.pathname,
      searchKeys: Array.from(url.searchParams.keys()),
      hash: url.hash ? "present" : "missing",
    };
  } catch {
    return {
      path: "unparseable",
      searchKeys: [],
      hash: "unknown",
    };
  }
}

export function describeEndpointOrigin(value: string | null | undefined) {
  if (!value) {
    return "missing";
  }

  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return "invalid";
  }
}
