import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import { Scissors, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CompactionPillProps {
  tokenDelta: number;
  timestamp: number;
  onDismiss?: () => void;
  className?: string;
}

export function CompactionPill({
  tokenDelta,
  timestamp,
  onDismiss,
  className,
}: CompactionPillProps) {
  const { t } = useTranslation();

  const formattedDelta = new Intl.NumberFormat().format(Math.abs(tokenDelta));
  const formattedTime = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));

  const pill = (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono font-semibold transition-colors",
        "bg-context-compaction-pill-bg border-context-compaction-pill-border text-context-compaction-pill-text",
        className,
      )}
    >
      <Scissors className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t("context.compaction_delta_pill", { count: formattedDelta })}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="ml-1 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t("context.compaction_dismiss")}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div>{pill}</div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-semibold">
            {t("context.compaction_detected_title")}
          </p>
          <p className="text-muted-foreground mt-0.5">
            {t("context.compaction_detected_desc", {
              count: formattedDelta,
              time: formattedTime,
            })}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
