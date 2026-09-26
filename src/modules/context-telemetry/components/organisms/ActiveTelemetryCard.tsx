import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/ui/utils";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { TokenRatioDisplay } from "../molecules/TokenRatioDisplay";
import { TokenProgressGauge } from "../atoms/TokenProgressGauge";
import { CompactionPill } from "../molecules/CompactionPill";
import { SubagentsAccordion } from "./SubagentsAccordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  Bot,
  Copy,
  Check,
  FolderGit2,
  Database,
  Brain,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import type {
  ActiveChatTelemetrySnapshot,
  CompactionEvent,
} from "../../ipc/router";

export interface ActiveTelemetryCardProps {
  snapshot: ActiveChatTelemetrySnapshot;
  compactionEvent?: CompactionEvent | null;
  onDismissCompaction?: () => void;
  className?: string;
}

export function ActiveTelemetryCard({
  snapshot,
  compactionEvent,
  onDismissCompaction,
  className,
}: ActiveTelemetryCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState(false);

  const isRunning = snapshot.status === "running";
  const primaryWorkspace = snapshot.workspaceUris?.[0] ?? "";
  const isZeroEstimated =
    snapshot.tokens.usedTokens === 0 && Boolean(snapshot.tokens.isEstimated);

  const handleCopySessionId = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(snapshot.conversationId);
      }
      setCopiedId(true);
      toast({
        title: t("context.session_id_label"),
        description: t("context.session_id_copied"),
      });
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Ignore clipboard write failures in restricted environments
    }
  };

  const shortSessionId =
    snapshot.conversationId.length > 16
      ? `${snapshot.conversationId.slice(0, 8)}...${snapshot.conversationId.slice(-4)}`
      : snapshot.conversationId;

  return (
    <Card
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm transition-all overflow-hidden",
        className,
      )}
    >
      <CardHeader className="p-4 sm:p-5 pb-3 sm:pb-4 space-y-3 border-b border-border/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className="text-base sm:text-lg font-bold tracking-tight text-foreground truncate max-w-md"
                  title={snapshot.title}
                >
                  {snapshot.title || t("context.active_session_title")}
                </h3>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold",
                    isRunning
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isRunning
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  {isRunning
                    ? t("context.badge_live")
                    : t("context.badge_idle")}
                </span>
                {snapshot.isCompacting && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse"
                    role="status"
                    title={t("context.compacting_badge")}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping"
                      aria-hidden="true"
                    />
                    <span>{t("context.compacting_badge")}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                {primaryWorkspace && (
                  <span
                    className="inline-flex items-center gap-1 truncate max-w-[220px] font-mono text-[11px]"
                    title={primaryWorkspace}
                  >
                    <FolderGit2
                      className="h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{primaryWorkspace}</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopySessionId}
                  className="inline-flex items-center gap-1 font-mono text-[11px] hover:text-foreground transition-colors"
                  title={t("context.copy_session_id")}
                >
                  <span>{shortSessionId}</span>
                  {copiedId ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground/70" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="font-semibold text-xs px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground border border-border/50">
              {snapshot.model.displayName}
            </span>
            {compactionEvent && (
              <CompactionPill
                tokenDelta={compactionEvent.tokenDelta}
                timestamp={compactionEvent.timestamp}
                onDismiss={onDismissCompaction}
              />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent
        className={cn(
          "p-4 sm:p-5 space-y-5 transition-opacity duration-300",
          snapshot.isCompacting && "opacity-60",
        )}
      >
        <div className="space-y-3">
          {isZeroEstimated ? (
            <div className="flex items-center gap-2 py-1">
              <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-muted-foreground animate-pulse">
                {t("context.refreshing_label")}
              </span>
            </div>
          ) : (
            <TokenRatioDisplay
              usedTokens={snapshot.tokens.usedTokens}
              maxTokens={snapshot.model.maxTokens}
              ratioPct={snapshot.tokens.ratioPct}
              pressureState={snapshot.tokens.pressureState}
            />
          )}

          {isZeroEstimated ? (
            <Skeleton
              className="h-2 w-full rounded-full"
              aria-label={t("context.refreshing_label")}
            />
          ) : (
            <TokenProgressGauge
              percentage={snapshot.tokens.ratioPct}
              pressureState={snapshot.tokens.pressureState}
              ariaLabel={t("context.metric_ratio")}
            />
          )}
        </div>

        {/* Supplementary Protobuf Telemetry Strip (4 Columns) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 pt-2">
          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Database
                className="h-3 w-3 text-primary shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{t("context.cached_tokens")}</span>
            </div>
            <div className="font-mono text-xs sm:text-sm font-semibold text-foreground">
              {isZeroEstimated
                ? "—"
                : new Intl.NumberFormat().format(snapshot.tokens.cachedTokens)}
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <MessageSquare
                className="h-3 w-3 text-sky-500 shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">
                {t("context.fresh_input_tokens")}
              </span>
            </div>
            <div className="font-mono text-xs sm:text-sm font-semibold text-foreground">
              {isZeroEstimated
                ? "—"
                : new Intl.NumberFormat().format(
                    snapshot.tokens.freshInputTokens,
                  )}
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Brain
                className="h-3 w-3 text-purple-500 shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{t("context.thinking_tokens")}</span>
            </div>
            <div className="font-mono text-xs sm:text-sm font-semibold text-foreground">
              {isZeroEstimated
                ? "—"
                : new Intl.NumberFormat().format(
                    snapshot.tokens.thinkingTokens,
                  )}
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-border/40 bg-muted/20 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkles
                className="h-3 w-3 text-amber-500 shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{t("context.output_tokens")}</span>
            </div>
            <div className="font-mono text-xs sm:text-sm font-semibold text-foreground">
              {isZeroEstimated
                ? "—"
                : new Intl.NumberFormat().format(snapshot.tokens.outputTokens)}
            </div>
          </div>
        </div>
      </CardContent>

      {snapshot.activeSubagents && snapshot.activeSubagents.length > 0 && (
        <CardFooter className="p-4 sm:p-5 pt-0">
          <SubagentsAccordion
            subagents={snapshot.activeSubagents}
            className="w-full"
          />
        </CardFooter>
      )}
    </Card>
  );
}
