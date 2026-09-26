import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import { ContextPressureBadge } from "../atoms/ContextPressureBadge";
import type { ContextPressureState } from "../../ipc/router";

export interface TokenRatioDisplayProps {
  usedTokens: number;
  maxTokens: number;
  ratioPct: number;
  pressureState: ContextPressureState;
  showBadge?: boolean;
  className?: string;
}

export function TokenRatioDisplay({
  usedTokens,
  maxTokens,
  ratioPct,
  pressureState,
  showBadge = true,
  className,
}: TokenRatioDisplayProps) {
  const { t } = useTranslation();

  const formattedUsed = new Intl.NumberFormat().format(
    Number.isFinite(usedTokens) ? usedTokens : 0,
  );
  const formattedMax = new Intl.NumberFormat().format(
    Number.isFinite(maxTokens) ? maxTokens : 0,
  );
  const formattedRatio = `${(Number.isFinite(ratioPct) ? ratioPct : 0).toFixed(1)}%`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 min-w-0 break-words",
        className,
      )}
    >
      <span className="font-mono text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground">
        {formattedUsed}
      </span>
      <span className="font-mono text-sm sm:text-base text-muted-foreground">
        / {formattedMax} {t("context.tokens_unit")}
      </span>
      <span
        className="text-muted-foreground/50 hidden sm:inline select-none"
        aria-hidden="true"
      >
        •
      </span>
      {showBadge ? (
        <ContextPressureBadge
          pressureState={pressureState}
          label={`${formattedRatio} ${
            pressureState === "critical_risk"
              ? t("context.status_critical")
              : pressureState === "high_pressure"
                ? t("context.status_high_pressure")
                : t("context.status_normal")
          }`}
          size="sm"
        />
      ) : (
        <span className="font-mono font-semibold text-xs sm:text-sm text-foreground">
          {formattedRatio}
        </span>
      )}
    </div>
  );
}
