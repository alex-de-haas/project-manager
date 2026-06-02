import type { WorkItemStatus } from "@/types";

export const IMPORT_STATUS_FILTER_OPTIONS = [
  "New",
  "Active",
  "Resolved",
  "Closed",
] as const;

export type ImportStatusFilter = (typeof IMPORT_STATUS_FILTER_OPTIONS)[number];

export const DEFAULT_IMPORT_STATUS_FILTERS: ImportStatusFilter[] = [
  "New",
  "Active",
];

export const AZURE_STATES_BY_IMPORT_STATUS: Record<ImportStatusFilter, string[]> = {
  New: ["New"],
  Active: ["Active"],
  Resolved: ["Resolved"],
  Closed: ["Closed"],
};

export const LOCAL_STATUS_BY_IMPORT_FILTER: Record<
  ImportStatusFilter,
  WorkItemStatus
> = {
  New: "new",
  Active: "in_progress",
  Resolved: "resolved",
  Closed: "completed",
};

export const parseImportStatusFilters = (
  value: string | null,
  fallback: readonly ImportStatusFilter[] = DEFAULT_IMPORT_STATUS_FILTERS
): ImportStatusFilter[] => {
  if (value === null) return [...fallback];
  if (!value.trim()) return [];

  const allowed = new Set<string>(IMPORT_STATUS_FILTER_OPTIONS);
  return Array.from(
    new Set(
      value
        .split(",")
        .map((status) => status.trim())
        .filter((status): status is ImportStatusFilter => allowed.has(status))
    )
  );
};
