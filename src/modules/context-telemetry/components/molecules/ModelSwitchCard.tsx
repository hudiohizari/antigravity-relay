import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import { TokenProgressGauge } from "../atoms/TokenProgressGauge";
import { ContextPressureBadge } from "../atoms/ContextPressureBadge";
import { Check, ShieldAlert, AlertTriangle } from "lucide-react";
import type { ContextPressureState } from "../../ipc/router";

export interface ModelSwitchCardProps {
  modelId: string;
  displayName: string;
  maxTokens: number;
  currentTokens: number;
  isCurrentModel?: boolean;
  isAuthoritative?: boolean;
  className?: string;
}

export function ModelSwitchCard({
  displayName,
  maxTokens,
  currentTokens,
  isCurrentModel = false,
  isAuthoritative = true,
  className,
}: ModelSwitchCardProps) {
  const { t } = useTranslation();

  const safeCurrent = Number.isFinite(currentTokens) ? currentTokens : 0;
  const safeMax =
    Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 128000;
  const ratioPct = (safeCurrent / safeMax) * 100;
  const overflowTokens = safeCurrent - safeMax;

  let pressureState: ContextPressureState = "normal";
  if (ratioPct >= 90) {
    pressureState = "critical_risk";
  } else if (ratioPct >= 70) {
    pressureState = "high_pressure";
  }

  const formattedMax = new Intl.NumberFormat().format(safeMax);
  const formattedOverflow = new Intl.NumberFormat().format(
    Math.max(0, overflowTokens),
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/60 p-3.5 flex flex-col justify-between gap-3 min-w-0 transition-colors hover:border-border/80",
        isCurrentModel && "ring-1 ring-primary/30 border-primary/40 bg-card/90",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h4
              className="font-semibold text-sm truncate text-foreground"
              title={displayName}
            >
              {displayName}
            </h4>
            {!isAuthoritative && (
              <span
                className="text-[10px] text-muted-foreground italic shrink-0"
                title={t("context.model_limit_estimated")}
              >
                *
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
            {formattedMax} {t("context.tokens_unit")}
          </div>
        </div>

        {isCurrentModel && (
          <span className="shrink-0 bg-primary/10 text-primary border border-primary/20 text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap">
            {t("context.current_model")}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted-foreground text-[11px]">
            {ratioPct.toFixed(1)}%
          </span>
          <ContextPressureBadge
            pressureState={pressureState}
            size="sm"
            showDot={false}
          />
        </div>
        <TokenProgressGauge
          percentage={ratioPct}
          pressureState={pressureState}
          ariaLabel={`${displayName} context switch compatibility`}
        />
      </div>

      <div className="pt-1 border-t border-border/40 text-xs">
        {overflowTokens > 0 ? (
          <div className="flex items-center gap-1.5 text-context-critical-text font-medium min-w-0">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {t("context.switch_overflow", { count: formattedOverflow })}
            </span>
          </div>
        ) : ratioPct >= 70 ? (
          <div className="flex items-center gap-1.5 text-context-warning-text font-medium min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {t("context.switch_high_pressure")}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-context-normal-text font-medium min-w-0">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("context.switch_fits")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
