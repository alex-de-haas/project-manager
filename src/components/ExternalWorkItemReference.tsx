"use client";

import type { IntegrationProvider } from "@/types";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ExternalWorkItemReferenceProps {
  provider?: IntegrationProvider | null;
  externalId: string | number;
  className?: string;
  onClick?: () => void;
}

interface ProviderVisual {
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
}

const AzureDevOpsIcon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3.5 6.7 12.7 2.4v4.1L7.1 8.9v6.2l5.6 2.4v4.1l-9.2-4.3V6.7Z"
      fill="#0078D4"
    />
    <path
      d="M20.5 5.1v13.8l-7.8 2.7v-4.1l4.5-1.5V8l-4.5-1.5V2.4l7.8 2.7Z"
      fill="#50A8E8"
    />
    <path
      d="M8.7 9.4 13.9 7v10l-5.2-2.4V9.4Z"
      fill="#005A9E"
    />
  </svg>
);

const providerVisuals: Partial<Record<IntegrationProvider, ProviderVisual>> = {
  azure_devops: {
    label: "Azure DevOps",
    Icon: AzureDevOpsIcon,
  },
};

export const formatExternalWorkItemId = (externalId: string | number) => {
  const value = String(externalId).trim();
  const numericValue = Number(value);

  if (Number.isFinite(numericValue) && numericValue > 0) {
    return String(Math.floor(numericValue));
  }

  return value;
};

export function ExternalWorkItemReference({
  provider,
  externalId,
  className,
  onClick,
}: ExternalWorkItemReferenceProps) {
  const visual = provider ? providerVisuals[provider] : undefined;
  const displayId = formatExternalWorkItemId(externalId);
  const label = visual
    ? `${visual.label} work item ${displayId}`
    : `External work item ${displayId}`;
  const Icon = visual?.Icon;
  const content = (
    <>
      {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
      <span>{displayId}</span>
    </>
  );

  const baseClassName = cn(
    "inline-flex flex-shrink-0 items-center gap-1 font-mono text-xs font-semibold tracking-[0.01em] text-muted-foreground",
    onClick && "cursor-pointer border-0 bg-transparent p-0 transition-colors hover:text-foreground",
    className
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={baseClassName}
        title={label}
        aria-label={label}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={baseClassName} title={label} aria-label={label}>
      {content}
    </span>
  );
}
