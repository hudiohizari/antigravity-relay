import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getProcessStatus,
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
  Code,
  ExternalLink,
  Loader2,
  Play,
  Power,
  Server,
  Square,
  Terminal,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

interface StatusBarProps {
  isCollapsed?: boolean;
  defaultOpen?: boolean;
}

interface ManagedService {
  id: "relay" | "tunnel" | "app" | "ide" | "cli";
  type: "service" | "app";
  labelKey: string;
  icon: React.ElementType;
  isRunning: boolean;
  isLoading: boolean;
  isPending: boolean;
  toggle: () => void;
  url?: string | null;
  networkUrl?: string | null;
  isBinaryInstalled?: boolean;
  uninstalledTooltipKey?: string;
  idleTooltipKey?: string;
  canStart?: boolean;
}

function useTargetProcessService(target: AntigravityAppTarget) {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["process", "status", target],
    queryFn: () => getProcessStatus(target),
    refetchInterval: 10000,
    staleTime: 10000,
  });

  const startMutation = useMutation({
    mutationFn: () => startAntigravity(target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["process", "status", target],
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => closeAntigravity(target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["process", "status", target],
      });
    },
  });

  const isRunning = Boolean(status?.isRunning);
  const isBinaryInstalled = status?.isBinaryInstalled ?? true;

  const toggle = () => {
    if (!isBinaryInstalled) {
      return;
    }
    if (isRunning) {
      stopMutation.mutate();
    } else if (target !== "cli" && (target as string) !== "agy") {
      startMutation.mutate();
    }
  };

  return {
    isRunning,
    isLoading,
    isPending: startMutation.isPending || stopMutation.isPending,
    toggle,
    isBinaryInstalled,
  };
}

function useRelayService() {
  const queryClient = useQueryClient();

  const { data: relayStatus, isLoading } = useQuery({
    queryKey: ["relay", "status"],
    queryFn: getRelayStatus,
    refetchInterval: 3000,
    staleTime: 3000,
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
  const networkUrl =
    isRunning && relayStatus?.localIp && relayStatus.localIp !== "127.0.0.1"
      ? `http://${relayStatus.localIp}:${port}`
      : relayStatus?.networkUrl || null;
  const url = isRunning ? networkUrl || `http://127.0.0.1:${port}` : null;

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
    staleTime: 3000,
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
  const isStartDisabled =
    !service.isRunning && (isMissingBinary || service.canStart === false);
  const isBusy = service.isLoading || service.isPending || isStartDisabled;

  const tooltipMessage = isMissingBinary
    ? service.uninstalledTooltipKey
      ? t(service.uninstalledTooltipKey)
      : t("status.tooltips.appNotInstalled")
    : !service.isRunning && service.canStart === false
      ? service.idleTooltipKey
        ? t(service.idleTooltipKey)
        : t("status.tooltips.cliIdleGuidance")
      : undefined;

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
          <div
            className="text-sm font-medium text-foreground truncate max-w-[140px] sm:max-w-[180px]"
            title={t(service.labelKey)}
          >
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
          {service.isRunning && service.url && (
            <div className="mt-0.5 flex items-center">
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
                className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline truncate max-w-[130px] sm:max-w-[180px]"
                title={service.url}
              >
                <span className="truncate">{service.url}</span>
                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
              </a>
            </div>
          )}
        </div>
      </div>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex shrink-0 rounded-md",
                isStartDisabled &&
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
              tabIndex={isStartDisabled ? 0 : undefined}
              role={isStartDisabled ? "button" : undefined}
              aria-disabled={isStartDisabled ? "true" : undefined}
              aria-label={
                isStartDisabled && tooltipMessage
                  ? `${t(service.labelKey)}: ${tooltipMessage}`
                  : undefined
              }
              title={tooltipMessage}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={service.toggle}
                disabled={isBusy}
                aria-disabled={isBusy ? "true" : undefined}
                title={tooltipMessage}
                className={cn(
                  "h-8 shrink-0 rounded-md border px-2.5 text-xs font-semibold min-w-[68px]",
                  isStartDisabled
                    ? "border-border text-muted-foreground opacity-50 cursor-not-allowed pointer-events-none"
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
            </span>
          </TooltipTrigger>
          {tooltipMessage && (
            <TooltipContent side="top" className="max-w-[240px] text-xs">
              {tooltipMessage}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export const StatusBar: React.FC<StatusBarProps> = ({
  isCollapsed = false,
  defaultOpen = false,
}) => {
  const { t } = useTranslation();
  const relay = useRelayService();
  const tunnel = useTunnelService();
  const app = useTargetProcessService("app");
  const ide = useTargetProcessService("ide");
  const cli = useTargetProcessService("cli");

  const services: ManagedService[] = [
    {
      id: "relay",
      type: "service",
      labelKey: "status.service_relay",
      icon: Server,
      ...relay,
      canStart: true,
    },
    {
      id: "tunnel",
      type: "service",
      labelKey: "status.service_tunnel",
      icon: Cloud,
      ...tunnel,
      uninstalledTooltipKey: "status.tooltips.tunnelNotInstalled",
      canStart: tunnel.isBinaryInstalled !== false,
    },
    {
      id: "app",
      type: "app",
      labelKey: "status.service_app",
      icon: Workflow,
      ...app,
      uninstalledTooltipKey: "status.tooltips.appNotInstalled",
      canStart: app.isBinaryInstalled !== false,
    },
    {
      id: "ide",
      type: "app",
      labelKey: "status.service_ide",
      icon: Code,
      ...ide,
      uninstalledTooltipKey: "status.tooltips.ideNotInstalled",
      canStart: ide.isBinaryInstalled !== false,
    },
    {
      id: "cli",
      type: "app",
      labelKey: "status.service_cli",
      icon: Terminal,
      ...cli,
      uninstalledTooltipKey: "status.tooltips.cliNotInstalled",
      idleTooltipKey: "status.tooltips.cliIdleGuidance",
      canStart: false,
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
        className="w-[calc(100vw-24px)] max-w-sm sm:w-96 p-2.5 rounded-lg border shadow-lg max-h-[min(460px,85vh)] overflow-y-auto"
      >
        <div className="px-2 pb-2">
          <div className="text-sm font-semibold text-foreground">
            {t("status.dashboard_title")}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">{summary}</div>
        </div>

        <DropdownMenuSeparator className="my-1.5 bg-border/60" />

        <div className="space-y-1 pt-0.5">
          <DropdownMenuLabel className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("status.services")}
          </DropdownMenuLabel>
          <div className="space-y-1">
            {services
              .filter((service) => service.type === "service")
              .map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
          </div>

          <DropdownMenuSeparator className="my-2 bg-border/60" />

          <DropdownMenuLabel className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("status.apps")}
          </DropdownMenuLabel>
          <div className="space-y-1">
            {services
              .filter((service) => service.type === "app")
              .map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
