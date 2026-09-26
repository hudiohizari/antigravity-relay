import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActiveContextTelemetry } from "../hooks/useActiveContextTelemetry";
import { ContextDashboardTemplate } from "./templates/ContextDashboardTemplate";
import { ContextDashboardSkeleton } from "./templates/ContextDashboardSkeleton";
import { ActiveTelemetryCard } from "./organisms/ActiveTelemetryCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, RotateCw, Radio, AlertTriangle, Clock } from "lucide-react";
import type {
  ActiveChatTelemetrySnapshot,
  ConcurrentChatSummary,
} from "../ipc/router";

function resolveConcurrentModelName(maxTokens: number): string {
  if (maxTokens >= 2_000_000) return "Gemini 3.1 Pro";
  if (maxTokens >= 1_000_000) return "Gemini 3.8 Flash";
  if (maxTokens >= 200_000) return "Claude Sonnet";
  return "Antigravity Model";
}

function mapConcurrentChatToSnapshot(
  chat: ConcurrentChatSummary,
  defaultTitle: string,
): ActiveChatTelemetrySnapshot {
  if (chat.snapshot) {
    return chat.snapshot;
  }

  const model = chat.model ?? {
    id: "concurrent-model",
    displayName: resolveConcurrentModelName(chat.maxTokens),
    maxTokens: chat.maxTokens,
    isAuthoritative: true,
  };

  const tokens = chat.tokens ?? {
    usedTokens: chat.usedTokens,
    cachedTokens: 0,
    freshInputTokens: chat.usedTokens,
    completionTokens: 0,
    thinkingTokens: 0,
    outputTokens: 0,
    ratioPct: chat.ratioPct,
    pressureState: chat.pressureState,
    isEstimated: false,
  };

  return {
    conversationId: chat.conversationId,
    title: chat.title || defaultTitle,
    workspaceUris: chat.workspaceUris ?? [],
    status: chat.status ?? "running",
    isCompacting: Boolean(chat.isCompacting),
    lastModifiedTime: chat.lastModifiedTime ?? "",
    model,
    tokens,
    activeSubagents: chat.activeSubagents ?? [],
  };
}

export function ContextDashboard() {
  const { t } = useTranslation();
  const { data, isLoading, isError, isFetching, refetch } =
    useActiveContextTelemetry();

  const [dismissedCompactionTimestamp, setDismissedCompactionTimestamp] =
    useState<number | null>(null);

  // 1. Loading State (Shimmer Skeleton with CLS = 0)
  if (isLoading && !data) {
    return <ContextDashboardSkeleton />;
  }

  // Common Header Action Bar
  const renderHeader = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" aria-hidden="true" />
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("context.title")}
          </h2>
          {data?.isStale && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
              title={t("context.stale_warning")}
            >
              <Clock className="h-3 w-3" />
              <span>{t("context.stale_badge")}</span>
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
          {t("context.subtitle")}
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isFetching}
        className="gap-2 shrink-0 self-start sm:self-auto min-h-[36px]"
      >
        <RotateCw
          className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        <span>{t("action.retry")}</span>
      </Button>
    </div>
  );

  // 2. Inline Recoverable Error State
  if (isError) {
    return (
      <ContextDashboardTemplate header={renderHeader}>
        <Card className="rounded-xl border border-destructive/30 bg-destructive/5 text-card-foreground">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-4 min-h-[280px]">
            <div className="p-3 rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-8 w-8" aria-hidden="true" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="font-semibold text-lg text-foreground">
                {t("context.error_title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("context.error_desc")}
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => refetch()}
              className="gap-2"
            >
              <RotateCw className="h-4 w-4" />
              <span>{t("context.error_retry")}</span>
            </Button>
          </CardContent>
        </Card>
      </ContextDashboardTemplate>
    );
  }

  // 3. Empty State (No Active Conversation)
  const hasActive =
    data?.hasActiveChat &&
    data?.primaryChat !== null &&
    data?.runtimeState === "active";

  if (!hasActive || !data?.primaryChat) {
    return (
      <ContextDashboardTemplate header={renderHeader}>
        <Card className="rounded-xl border border-border bg-card/60">
          <CardContent className="flex flex-col items-center justify-center p-8 sm:p-12 text-center space-y-4 min-h-[320px]">
            <div className="p-4 rounded-full bg-muted text-muted-foreground">
              <Radio
                className="h-8 w-8 animate-pulse text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="font-semibold text-lg text-foreground">
                {t("context.empty_title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("context.empty_desc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-2 mt-2"
            >
              <RotateCw className="h-4 w-4" />
              <span>{t("action.retry")}</span>
            </Button>
          </CardContent>
        </Card>
      </ContextDashboardTemplate>
    );
  }

  // 4. Populated Active State: Render each active session directly as a card in a vertical stack
  const activeCompaction =
    data.recentCompactionEvent &&
    data.recentCompactionEvent.timestamp !== dismissedCompactionTimestamp
      ? data.recentCompactionEvent
      : null;

  const allSessions: ActiveChatTelemetrySnapshot[] = [
    data.primaryChat,
    ...(data.concurrentChats || []).map((chat) =>
      mapConcurrentChatToSnapshot(chat, t("context.active_session_title")),
    ),
  ];

  return (
    <ContextDashboardTemplate header={renderHeader}>
      <div className="space-y-6">
        {allSessions.map((chat) => (
          <ActiveTelemetryCard
            key={chat.conversationId}
            snapshot={chat}
            compactionEvent={
              activeCompaction?.conversationId === chat.conversationId
                ? activeCompaction
                : null
            }
            onDismissCompaction={() => {
              if (data.recentCompactionEvent) {
                setDismissedCompactionTimestamp(
                  data.recentCompactionEvent.timestamp,
                );
              }
            }}
          />
        ))}
      </div>
    </ContextDashboardTemplate>
  );
}
