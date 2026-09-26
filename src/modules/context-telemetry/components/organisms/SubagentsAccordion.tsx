import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import { SubagentRow } from "../molecules/SubagentRow";
import { Workflow, ChevronDown } from "lucide-react";
import type { ActiveSubagentTelemetry } from "../../ipc/router";

export interface SubagentsAccordionProps {
  subagents: ActiveSubagentTelemetry[];
  className?: string;
}

export function SubagentsAccordion({
  subagents,
  className,
}: SubagentsAccordionProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  if (!subagents || subagents.length === 0) {
    return null;
  }

  const totalTokens = subagents.reduce(
    (sum, sub) => sum + (Number.isFinite(sub.usedTokens) ? sub.usedTokens : 0),
    0,
  );
  const formattedTotal = new Intl.NumberFormat().format(totalTokens);

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-card/40 overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls="subagents-panel"
        aria-label={t("context.subagents_toggle_aria")}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Workflow
            className="h-4 w-4 text-primary shrink-0"
            aria-hidden="true"
          />
          <span className="font-semibold text-xs sm:text-sm text-foreground">
            {t("context.subagents_title")}
          </span>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
            {t("context.subagents_active_count", { count: subagents.length })}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-muted-foreground hidden sm:inline">
            Σ {t("context.subagents_total_tokens", { count: formattedTotal })}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              isOpen && "transform rotate-180",
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {isOpen && (
        <div
          id="subagents-panel"
          className="p-3 pt-1 space-y-2 border-t border-border/40 bg-muted/10 animate-in fade-in-50 duration-200"
        >
          {subagents.map((subagent) => (
            <SubagentRow
              key={subagent.conversationId}
              conversationId={subagent.conversationId}
              agentName={subagent.agentName}
              usedTokens={subagent.usedTokens}
              status={subagent.status}
            />
          ))}
        </div>
      )}
    </div>
  );
}
