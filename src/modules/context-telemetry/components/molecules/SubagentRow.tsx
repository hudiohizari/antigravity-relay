import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";

export interface SubagentRowProps {
  conversationId: string;
  agentName: string;
  usedTokens: number;
  status: string;
  className?: string;
}

export function SubagentRow({
  conversationId,
  agentName,
  usedTokens,
  status,
  className,
}: SubagentRowProps) {
  const { t } = useTranslation();
  const isRunning =
    status === "running" || status === "CASCADE_RUN_STATUS_RUNNING";
  const formattedTokens = new Intl.NumberFormat().format(
    Number.isFinite(usedTokens) ? usedTokens : 0,
  );

  const shortId =
    conversationId.length > 12
      ? `${conversationId.slice(0, 6)}...${conversationId.slice(-4)}`
      : conversationId;

  return (
    <div
      className={cn(
        "flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/40 transition-colors gap-3 min-w-0",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            isRunning
              ? "bg-emerald-500 animate-pulse"
              : "bg-muted-foreground/40",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
          <span
            className="text-xs font-medium text-foreground truncate"
            title={agentName}
          >
            {agentName}
          </span>
          <span
            className="text-[11px] font-mono text-muted-foreground shrink-0"
            title={conversationId}
          >
            {shortId}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <span className="text-xs font-mono font-semibold text-foreground">
          {t("context.subagent_tokens", { count: formattedTokens })}
        </span>
      </div>
    </div>
  );
}
