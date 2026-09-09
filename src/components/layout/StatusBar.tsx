import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isProcessRunning,
  startAntigravity,
  closeAntigravity,
} from "@/modules/antigravity-runtime/actions/process";
import {
  getRelayStatus,
  startRelay,
  stopRelay,
  getTunnelStatus,
  startTunnel,
  stopTunnel,
} from "@/modules/relay/actions/relay";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/ui/utils";
import {
  Activity,
  ChevronUp,
  Cloud,
  ExternalLink,
  Loader2,
  Play,
  Power,
  Server,
  Square,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StatusBarProps {
  isCollapsed?: boolean;
  defaultOpen?: boolean;
}

interface ManagedService {
  id: "classic" | "relay" | "tunnel";
  labelKey: string;
  icon: React.ElementType;
  isRunning: boolean;
  isLoading: boolean;
  isPending: boolean;
  toggle: () => void;
  url?: string | null;
  networkUrl?: string | null;
  isBinaryInstalled?: boolean;
}

function useClassicService() {
  const queryClient = useQueryClient();

  const { data: isRunning, isLoading } = useQuery({
    queryKey: ["process", "status", "classic"],
    queryFn: () => isProcessRunning("classic"),
    refetchInterval: 10000,
  });

  const startMutation = useMutation({
    mutationFn: () => startAntigravity("classic"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["process", "status", "classic"],
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => closeAntigravity("classic"),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["process", "status", "classic"],
      });
    },
  });

  const toggle = () => {
    if (isRunning) {
      stopMutation.mutate();
    } else {
      startMutation.mutate();
    }
  };

  return {
    isRunning: Boolean(isRunning),
    isLoading,
    isPending: startMutation.isPending || stopMutation.isPending,
    toggle,
  };
}

function useRelayService() {
  const queryClient = useQueryClient();

  const { data: relayStatus, isLoading } = useQuery({
    queryKey: ["relay", "status"],
    queryFn: getRelayStatus,
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: () => startRelay(),
    onSuccess: (data) => {
      queryClient.setQueryData(["relay", "status"], data);
      queryClient.invalidateQueries({ queryKey: ["relay"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopRelay(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relay"] });
    },
  });

  const isRunning = Boolean(relayStatus?.isRunning);

  const toggle = () => {
    if (isRunning) {
      stopMutation.mutate();
    } else {
      startMutation.mutate();
    }
  };

  const port = relayStatus?.port || 4040;
  const url = isRunning ? `http://127.0.0.1:${port}` : null;
  const networkUrl =
    isRunning && relayStatus?.localIp && relayStatus.localIp !== "127.0.0.1"
      ? `http://${relayStatus.localIp}:${port}`
      : relayStatus?.networkUrl || null;

  return {
    isRunning,
    isLoading,
    isPending: startMutation.isPending || stopMutation.isPending,
    toggle,
    url,
    networkUrl,
  };
}

function useTunnelService() {
  const queryClient = useQueryClient();

  const { data: tunnelStatus, isLoading } = useQuery({
    queryKey: ["tunnel", "status"],
    queryFn: getTunnelStatus,
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: () => startTunnel({ targetPort: 4040 }),
    onSuccess: (data) => {
      queryClient.setQueryData(["tunnel", "status"], data);
      queryClient.invalidateQueries({ queryKey: ["tunnel"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopTunnel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tunnel"] });
    },
  });

  const isBinaryInstalled = tunnelStatus?.isBinaryInstalled ?? true;
  const isRunning = tunnelStatus?.state === "connected";
  const isStartingOrReconnecting =
    tunnelStatus?.state === "starting" ||
    tunnelStatus?.state === "reconnecting";

  const toggle = () => {
    if (!isBinaryInstalled) {
      return;
    }
    if (isRunning || isStartingOrReconnecting) {
      stopMutation.mutate();
    } else {
      startMutation.mutate();
    }
  };

  const url = isRunning ? tunnelStatus?.publicUrl || null : null;

  return {
    isRunning,
    isLoading,
    isPending: startMutation.isPending || stopMutation.isPending,
    toggle,
    url,
    isBinaryInstalled,
  };
}

function ServiceRow({ service }: { service: ManagedService }) {
  const { t } = useTranslation();
  const Icon = service.icon;
  const isMissingBinary = service.isBinaryInstalled === false;
  const isBusy = service.isLoading || service.isPending || isMissingBinary;

  return (
    <div className="flex min-h-[48px] items-center justify-between gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent/60 transition-colors">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            isMissingBinary
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : service.isRunning
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground whitespace-nowrap">
            {t(service.labelKey)}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
            {service.isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isMissingBinary
                    ? "bg-amber-500"
                    : service.isRunning
                      ? "bg-emerald-500"
                      : "bg-red-500",
                )}
              />
            )}
            <span>
              {service.isLoading
                ? t("status.checking_short")
                : isMissingBinary
                  ? t("status.not_installed_short")
                  : service.isRunning
                    ? t("status.running_short")
                    : t("status.stopped_short")}
            </span>
          </div>
          {service.isRunning && (service.networkUrl || service.url) && (
            <div className="mt-1 flex flex-col gap-0.5">
              {service.networkUrl && (
                <div className="flex items-center gap-1.5">
                  <a
                    href={service.networkUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (window.electron?.openExternalUrl) {
                        e.preventDefault();
                        window.electron.openExternalUrl(service.networkUrl!);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline truncate max-w-[170px]"
                    title={`${t("status.wifi_network")}: ${service.networkUrl}`}
                  >
                    <span className="truncate">{service.networkUrl}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                  </a>
                  <span className="text-[9px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-1 py-0.5 rounded leading-none">
                    {t("status.wifi_network")}
                  </span>
                </div>
              )}
              {service.url &&
                (!service.networkUrl || service.networkUrl !== service.url) && (
                  <div className="flex items-center gap-1.5">
                    <a
                      href={service.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        if (window.electron?.openExternalUrl) {
                          e.preventDefault();
                          window.electron.openExternalUrl(service.url!);
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-mono hover:underline truncate max-w-[170px]",
                        service.networkUrl
                          ? "text-muted-foreground text-[10px]"
                          : "text-emerald-600 dark:text-emerald-400",
                      )}
                      title={
                        service.networkUrl
                          ? `${t("status.local_network")}: ${service.url}`
                          : service.url
                      }
                    >
                      <span className="truncate">{service.url}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                    </a>
                    {service.networkUrl && (
                      <span className="text-[9px] font-medium text-muted-foreground bg-muted px-1 py-0.5 rounded leading-none">
                        {t("status.local_network")}
                      </span>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={service.toggle}
        disabled={isBusy}
        aria-disabled={isMissingBinary ? "true" : undefined}
        title={
          isMissingBinary ? t("tunnel.binaryNotInstalledTooltip") : undefined
        }
        className={cn(
          "h-8 shrink-0 rounded-md border px-2.5 text-xs font-semibold min-w-[68px]",
          isMissingBinary
            ? "border-border text-muted-foreground opacity-50 cursor-not-allowed"
            : service.isRunning
              ? "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
              : "border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
        )}
      >
        {service.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : service.isRunning ? (
          <Square className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" />
        )}
        <span className="ml-1.5">
          {service.isRunning ? t("action.stop") : t("action.start")}
        </span>
      </Button>
    </div>
  );
}

export const StatusBar: React.FC<StatusBarProps> = ({
  isCollapsed = false,
  defaultOpen = false,
}) => {
  const { t } = useTranslation();
  const classic = useClassicService();
  const relay = useRelayService();
  const tunnel = useTunnelService();

  const services: ManagedService[] = [
    {
      id: "classic",
      labelKey: "status.antigravity",
      icon: Workflow,
      ...classic,
    },
    {
      id: "relay",
      labelKey: "status.relay",
      icon: Server,
      ...relay,
    },
    {
      id: "tunnel",
      labelKey: "status.tunnel",
      icon: Cloud,
      ...tunnel,
    },
  ];

  const runningCount = services.filter((service) => service.isRunning).length;
  const totalCount = services.length;
  const isChecking = services.some((service) => service.isLoading);
  const hasPendingAction = services.some((service) => service.isPending);
  const summary = isChecking
    ? t("status.checking_short")
    : runningCount === 0
      ? t("status.all_stopped")
      : runningCount === totalCount
        ? t("status.all_running")
        : t("status.partial_running", {
            running: runningCount,
            total: totalCount,
          });

  const triggerClassName = isCollapsed
    ? "mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background/80 text-foreground shadow-sm transition-colors hover:bg-accent"
    : "flex w-full min-h-[44px] items-center justify-between overflow-hidden rounded-lg border border-border bg-background/80 px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent/70";

  return (
    <DropdownMenu modal={false} defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          aria-label={t("status.open_dashboard")}
        >
          {isCollapsed ? (
            <div className="relative">
              {hasPendingAction ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Power className="h-5 w-5" />
              )}
              <span
                className={cn(
                  "border-background absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full border-2",
                  runningCount > 0 ? "bg-emerald-500" : "bg-red-500",
                )}
              />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-3">
                <div className="bg-muted text-muted-foreground relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
                  {hasPendingAction ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )}
                  <span
                    className={cn(
                      "border-background absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2",
                      runningCount > 0 ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                </div>
                <div className="min-w-0 text-left">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {t("status.services")}
                  </div>
                  <div className="truncate text-xs font-semibold text-foreground">
                    {summary}
                  </div>
                </div>
              </div>
              <ChevronUp className="text-muted-foreground ml-2 h-4 w-4 shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-84 p-2.5 rounded-lg border shadow-lg"
      >
        <div className="px-2 pb-2">
          <div className="text-sm font-semibold text-foreground">
            {t("status.dashboard_title")}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">{summary}</div>
        </div>
        <div className="space-y-1.5 pt-1.5">
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
