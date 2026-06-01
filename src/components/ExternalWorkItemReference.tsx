"use client";

import Image from "next/image";
import type { IntegrationProvider } from "@/types";
import { cn } from "@/lib/utils";

interface ExternalWorkItemReferenceProps {
  provider?: IntegrationProvider | null;
  externalId: string | number;
  className?: string;
  iconClassName?: string;
  onClick?: () => void;
}

interface ProviderVisual {
  label: string;
  iconSrc?: string;
}

const providerVisuals: Partial<Record<IntegrationProvider, ProviderVisual>> = {
  azure_devops: {
    label: "Azure DevOps",
    iconSrc: "/icons/azure-devops.svg",
  },
};

export const formatExternalWorkItemId = (externalId: string | number) => {
  const value = String(externalId).trim();

  if (
    typeof externalId === "number" &&
    Number.isSafeInteger(externalId) &&
    externalId > 0
  ) {
    return String(externalId);
  }

  return value;
};

export function ExternalWorkItemReference({
  provider,
  externalId,
  className,
  iconClassName,
  onClick,
}: ExternalWorkItemReferenceProps) {
  const visual = provider ? providerVisuals[provider] : undefined;
  const displayId = formatExternalWorkItemId(externalId);
  const label = visual
    ? `${visual.label} work item ${displayId}`
    : `External work item ${displayId}`;
  const content = (
    <>
      {visual?.iconSrc && (
        <span
          aria-hidden="true"
          className={cn(
            "relative block h-4 w-4 flex-shrink-0",
            iconClassName
          )}
        >
          <Image
            className="object-contain"
            src={visual.iconSrc}
            alt=""
            fill
            sizes="1em"
          />
        </span>
      )}
      <span className="flex h-5 items-center leading-none">{displayId}</span>
    </>
  );

  const baseClassName = cn(
    "inline-flex h-5 flex-shrink-0 items-center gap-1 align-middle font-mono text-sm font-normal leading-none tabular-nums text-muted-foreground",
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
