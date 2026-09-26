import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import { Layers } from "lucide-react";
import type { ConcurrentChatSummary } from "../../ipc/router";

export interface ConcurrentSessionSelectorProps {
  concurrentChats: ConcurrentChatSummary[];
  activeSessionId?: string;
  onSelectSession: (id: string) => void;
  className?: string;
}

export function ConcurrentSessionSelector({
  concurrentChats,
  activeSessionId,
  onSelectSession,
  className,
}: ConcurrentSessionSelectorProps) {
  const { t } = useTranslation();

  if (!concurrentChats || concurrentChats.length === 0) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label={t("context.concurrent_title")}
      className={cn("flex flex-wrap items-center gap-2 min-w-0", className)}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mr-1 shrink-0">
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t("context.concurrent_title")}:</span>
      </div>

      {concurrentChats.map((chat) => {
        const isActive = chat.conversationId === activeSessionId;
        const formattedRatio = `${chat.ratioPct.toFixed(1)}%`;

        return (
          <button
            key={chat.conversationId}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => onSelectSession(chat.conversationId)}
            className={cn(
              "min-h-[44px] px-3.5 py-2 rounded-lg border text-xs font-medium transition-all flex items-center gap-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isActive
                ? "bg-primary/10 text-primary border-primary font-semibold shadow-xs"
                : "bg-card hover:bg-muted/50 text-foreground border-border",
            )}
          >
            <span
              className="truncate max-w-[140px] sm:max-w-[180px]"
              title={chat.title}
            >
              {chat.title || chat.conversationId}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60 shrink-0">
              {formattedRatio}
            </span>
          </button>
        );
      })}
    </div>
  );
}
