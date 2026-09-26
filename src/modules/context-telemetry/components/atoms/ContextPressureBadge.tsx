import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import type { ContextPressureState } from "../../ipc/router";

export interface ContextPressureBadgeProps {
  pressureState: ContextPressureState;
  label?: string;
  size?: "sm" | "md";
  showDot?: boolean;
  className?: string;
}

export function ContextPressureBadge({
  pressureState,
  label,
  size = "md",
  showDot = true,
  className,
}: ContextPressureBadgeProps) {
  const { t } = useTranslation();

  const defaultLabel =
    pressureState === "critical_risk"
      ? t("context.status_critical")
      : pressureState === "high_pressure"
        ? t("context.status_high_pressure")
        : t("context.status_normal");

  const displayLabel = label ?? defaultLabel;

  const styleConfig = {
    normal: {
      container:
        "bg-context-normal-bg border-context-normal-border text-context-normal-text",
      dot: "bg-context-normal-dot",
    },
    high_pressure: {
      container:
        "bg-context-warning-bg border-context-warning-border text-context-warning-text",
      dot: "bg-context-warning-dot animate-pulse",
    },
    critical_risk: {
      container:
        "bg-context-critical-bg border-context-critical-border text-context-critical-text",
      dot: "bg-context-critical-dot animate-ping",
    },
  }[pressureState];

  const sizeClasses =
    size === "sm"
      ? "text-[11px] px-2 py-0.5 gap-1 font-medium"
      : "text-xs px-2.5 py-1 gap-1.5 font-semibold";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border whitespace-nowrap transition-colors",
        sizeClasses,
        styleConfig.container,
        className,
      )}
    >
      {showDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0", styleConfig.dot)}
          aria-hidden="true"
        />
      )}
      <span>{displayLabel}</span>
    </span>
  );
}
