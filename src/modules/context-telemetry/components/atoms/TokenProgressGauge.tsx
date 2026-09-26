import React from "react";
import { cn } from "@/shared/ui/utils";
import type { ContextPressureState } from "../../ipc/router";

export interface TokenProgressGaugeProps {
  percentage: number;
  pressureState: ContextPressureState;
  ariaLabel?: string;
  ariaValueText?: string;
  className?: string;
}

export function TokenProgressGauge({
  percentage,
  pressureState,
  ariaLabel,
  ariaValueText,
  className,
}: TokenProgressGaugeProps) {
  const clamped = Math.min(
    100,
    Math.max(0, Number.isFinite(percentage) ? percentage : 0),
  );

  const barColor =
    pressureState === "critical_risk"
      ? "bg-context-critical-bar"
      : pressureState === "high_pressure"
        ? "bg-context-warning-bar"
        : "bg-context-normal-bar";

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? "Context window utilization"}
      aria-valuetext={ariaValueText ?? `${clamped.toFixed(1)}%`}
      tabIndex={0}
      className={cn(
        "h-2 w-full rounded-full overflow-hidden bg-context-gauge-track border border-context-gauge-track-border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300 ease-out",
          barColor,
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
