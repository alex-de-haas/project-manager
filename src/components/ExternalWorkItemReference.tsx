"use client";

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
  brandColorClassName?: string;
}

const providerVisuals: Partial<Record<IntegrationProvider, ProviderVisual>> = {
  azure_devops: {
    label: "Azure DevOps",
    iconSrc: "/icons/azure-devops.svg",
    brandColorClassName: "bg-[#0078D4]",
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
            "h-4 w-4 flex-shrink-0",
            visual.brandColorClassName || "bg-muted-foreground",
            iconClassName
          )}
          style={{
            WebkitMaskImage: `url("${visual.iconSrc}")`,
            WebkitMaskPosition: "center",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskImage: `url("${visual.iconSrc}")`,
            maskPosition: "center",
            maskRepeat: "no-repeat",
            maskSize: "contain",
          }}
        />
      )}
      <span className="relative top-px">{displayId}</span>
    </>
  );

  const baseClassName = cn(
    "inline-flex flex-shrink-0 items-center gap-1 font-mono text-sm font-semibold tracking-[0.01em] text-muted-foreground",
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
