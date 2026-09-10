import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/shared/ui/utils";
import { QRCode } from "./QRCode";
import {
  getRelayStatus,
  startRelay,
  stopRelay,
  getRelaySessions,
  revokeRelaySession,
  getTunnelStatus,
  startTunnel,
  restartTunnel,
  stopTunnel,
  getTunnelUrl,
  checkTunnelBinary,
  regeneratePairingKey,
} from "../actions/relay";
import { ipc } from "@/ipc/manager";
import type { Session } from "../types";
import {
  Radio,
  Server,
  Cloud,
  QrCode,
  Smartphone,
  Trash2,
  Copy,
  Check,
  RotateCw,
  AlertTriangle,
  ExternalLink,
  Shield,
  Loader2,
  Wifi,
  PowerOff,
  Play,
  Square,
  Fingerprint,
} from "lucide-react";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatRelativeTime(
  ms: number,
  t: (key: string, params?: Record<string, any>) => string,
): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return t("sessions.relativeJustNow");
  if (seconds < 60) return t("sessions.relativeSecondsAgo", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("sessions.relativeMinutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t("sessions.relativeHoursAgo", { count: hours });
}

function shortenDeviceId(deviceId: string): string {
  if (!deviceId) return "";
  if (deviceId.length <= 16) return deviceId;
  return `${deviceId.slice(0, 8)}...${deviceId.slice(-4)}`;
}

function parseDeviceUserAgent(
  ua: string,
  t: (key: string, params?: Record<string, any>) => string,
): { device: string; browser: string } {
  if (!ua || ua.trim().length === 0) {
    return {
      device: t("sessions.unknownDevice"),
      browser: t("sessions.unknownBrowser"),
    };
  }
  let device = t("sessions.unknownDevice");
  if (/iPhone/i.test(ua)) device = t("sessions.deviceIPhone");
  else if (/iPad/i.test(ua)) device = t("sessions.deviceIPad");
  else if (/Android/i.test(ua)) device = t("sessions.deviceAndroid");
  else if (/Macintosh|Mac OS/i.test(ua)) device = t("sessions.deviceMac");
  else if (/Windows/i.test(ua)) device = t("sessions.deviceWindows");
  else if (/Linux/i.test(ua)) device = t("sessions.deviceLinux");

  let browser = t("sessions.unknownBrowser");
  if (/Chrome/i.test(ua) && !/Edge|Edg/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Edge|Edg/i.test(ua)) browser = "Edge";

  return { device, browser };
}

function generatePairingToken(): string {
  if (typeof crypto !== "undefined") {
    if (crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export const RelayDashboard: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pairingToken, setPairingToken] = useState<string>(() =>
    generatePairingToken(),
  );
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [isCheckingBinary, setIsCheckingBinary] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<Session | null>(null);

  // Live clock ticker for durations
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Relay Server Status Query
  const {
    data: relayStatus,
    isLoading: isRelayLoading,
    refetch: refetchRelay,
  } = useQuery({
    queryKey: ["relay", "status"],
    queryFn: getRelayStatus,
    refetchInterval: 3000,
  });

  // 2. Tunnel Status Query
  const {
    data: tunnelStatus,
    isLoading: isTunnelLoading,
    refetch: refetchTunnel,
  } = useQuery({
    queryKey: ["tunnel", "status"],
    queryFn: getTunnelStatus,
    refetchInterval: 3000,
  });

  // 3. Tunnel URL Query
  const { data: publicUrl = null } = useQuery({
    queryKey: ["tunnel", "url"],
    queryFn: getTunnelUrl,
    refetchInterval: 3000,
  });

  // 4. Relay Active Sessions Query
  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ["relay", "sessions"],
    queryFn: getRelaySessions,
    refetchInterval: 3000,
    enabled: !!relayStatus?.isRunning,
  });

  // 5. System Local IPs Query
  const { data: localIps } = useQuery({
    queryKey: ["system", "localIps"],
    queryFn: async () => {
      try {
        const ips = await ipc.client.system.get_local_ips();
        return ips as {
          address: string;
          name: string;
          isRecommended: boolean;
        }[];
      } catch {
        return [
          { address: "127.0.0.1", name: "localhost", isRecommended: false },
        ];
      }
    },
    staleTime: Infinity,
  });

  const recommendedIp = useMemo(() => {
    if (!localIps || localIps.length === 0) return "127.0.0.1";
    const recommended = localIps.find((ip) => ip.isRecommended);
    return recommended?.address || localIps[0].address;
  }, [localIps]);

  const [showAutoRegenBanner, setShowAutoRegenBanner] = useState(false);
  const prevServerPairingKeyRef = React.useRef<string | undefined>(undefined);

  const serverPairingKey = relayStatus?.pairingKey;
  useEffect(() => {
    if (serverPairingKey) {
      if (
        prevServerPairingKeyRef.current !== undefined &&
        prevServerPairingKeyRef.current !== serverPairingKey
      ) {
        setShowAutoRegenBanner(true);
        const timer = setTimeout(() => setShowAutoRegenBanner(false), 4000);
        setPairingToken(serverPairingKey);
        prevServerPairingKeyRef.current = serverPairingKey;
        return () => clearTimeout(timer);
      }
      prevServerPairingKeyRef.current = serverPairingKey;
      setPairingToken(serverPairingKey);
    }
  }, [serverPairingKey]);

  const regenerateKeyMutation = useMutation({
    mutationFn: regeneratePairingKey,
    onSuccess: (newKey) => {
      prevServerPairingKeyRef.current = newKey;
      setPairingToken(newKey);
      queryClient.invalidateQueries({ queryKey: ["relay", "status"] });
    },
  });

  // Mutations
  const startRelayMutation = useMutation({
    mutationFn: (params?: { port?: number; host?: string }) =>
      startRelay(params),
    onSuccess: (data) => {
      queryClient.setQueryData(["relay", "status"], data);
      queryClient.invalidateQueries({ queryKey: ["relay"] });
    },
    onError: (err: Error) => {
      toast({
        title: t("common.error"),
        description: t("relay.startFailed", { error: err.message }),
        variant: "destructive",
      });
    },
  });

  const stopRelayMutation = useMutation({
    mutationFn: stopRelay,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relay"] });
    },
    onError: (err: Error) => {
      toast({
        title: t("common.error"),
        description: t("relay.stopFailed", { error: err.message }),
        variant: "destructive",
      });
    },
  });

  const startTunnelMutation = useMutation({
    mutationFn: (params?: { targetPort?: number }) => startTunnel(params),
    onSuccess: (data) => {
      queryClient.setQueryData(["tunnel", "status"], data);
      queryClient.invalidateQueries({ queryKey: ["tunnel"] });
    },
    onError: (err: Error) => {
      toast({
        title: t("common.error"),
        description: t("tunnel.startFailed", { error: err.message }),
        variant: "destructive",
      });
    },
  });

  const stopTunnelMutation = useMutation({
    mutationFn: stopTunnel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tunnel"] });
    },
    onError: (err: Error) => {
      toast({
        title: t("common.error"),
        description: t("tunnel.stopFailed", { error: err.message }),
        variant: "destructive",
      });
    },
  });

  const restartTunnelMutation = useMutation({
    mutationFn: (params?: { targetPort?: number }) => restartTunnel(params),
    onSuccess: (data) => {
      queryClient.setQueryData(["tunnel", "status"], data);
      queryClient.invalidateQueries({ queryKey: ["tunnel"] });
    },
    onError: (err: Error) => {
      toast({
        title: t("common.error"),
        description: t("tunnel.restartFailed", { error: err.message }),
        variant: "destructive",
      });
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => revokeRelaySession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.setQueryData<Session[]>(["relay", "sessions"], (old = []) =>
        old.filter((s) => s.sessionId !== sessionId),
      );
      toast({
        title: t("sessions.title"),
        description: t("sessions.revokedToast", { device: "Session" }),
      });
    },
    onError: (err: Error) => {
      toast({
        title: t("common.error"),
        description: t("sessions.revokeFailed", { error: err.message }),
        variant: "destructive",
      });
    },
  });

  const isRelayRunning = Boolean(relayStatus?.isRunning);
  const isTunnelConnected =
    tunnelStatus?.state === "connected" &&
    typeof publicUrl === "string" &&
    publicUrl.trim().length > 0;

  // Pairing URL construction
  const pairingUrl = useMemo(() => {
    if (isTunnelConnected && publicUrl) {
      const base = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;
      return `${base}/?pair=${pairingToken}&useWebSocket=true`;
    }
    const port = relayStatus?.port || 4040;
    return `http://${recommendedIp}:${port}/?pair=${pairingToken}&useWebSocket=true`;
  }, [
    isTunnelConnected,
    publicUrl,
    relayStatus?.port,
    recommendedIp,
    pairingToken,
  ]);

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(pairingUrl);
    setCopiedLink(true);
    toast({
      title: t("pairing.title"),
      description: t("pairing.linkCopied"),
    });
    setTimeout(() => setCopiedLink(false), 2000);
  }, [pairingUrl, t, toast]);

  const handleCopyUrl = useCallback(async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopiedUrl(true);
    toast({
      title: t("tunnel.title"),
      description: t("tunnel.urlCopied"),
    });
    setTimeout(() => setCopiedUrl(false), 2000);
  }, [publicUrl, t, toast]);

  const handleCopyToken = useCallback(async () => {
    await navigator.clipboard.writeText(pairingToken);
    setCopiedToken(true);
    toast({
      title: t("pairing.title"),
      description: t("pairing.tokenCopied"),
    });
    setTimeout(() => setCopiedToken(false), 2000);
  }, [pairingToken, t, toast]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([refetchRelay(), refetchTunnel(), refetchSessions()]);
  }, [refetchRelay, refetchTunnel, refetchSessions]);

  const handleToggleRelay = useCallback(() => {
    if (relayStatus?.isRunning) {
      stopRelayMutation.mutate();
    } else {
      startRelayMutation.mutate();
    }
  }, [relayStatus?.isRunning, startRelayMutation, stopRelayMutation]);

  const isStarting = startTunnelMutation.isPending;
  const isRestarting = restartTunnelMutation.isPending;
  const isStopping = stopTunnelMutation.isPending;

  const installCommand = useMemo(() => {
    const platform =
      tunnelStatus?.platform ||
      (typeof navigator !== "undefined"
        ? /Macintosh|Mac OS/i.test(navigator.userAgent)
          ? "darwin"
          : /Windows/i.test(navigator.userAgent)
            ? "win32"
            : /Linux/i.test(navigator.userAgent)
              ? "linux"
              : undefined
        : undefined);
    if (platform === "darwin") return "brew install cloudflared";
    if (platform === "win32")
      return "winget install --id Cloudflare.cloudflared";
    if (platform === "linux") return "sudo apt install cloudflared";
    return "brew install cloudflared";
  }, [tunnelStatus?.platform]);

  const handleCopyInstallCommand = useCallback(async () => {
    await navigator.clipboard.writeText(installCommand);
    setCopiedCommand(true);
    toast({
      title: t("tunnel.title"),
      description: t("tunnel.commandCopied"),
    });
    setTimeout(() => setCopiedCommand(false), 2000);
  }, [installCommand, t, toast]);

  const handleCheckAgain = useCallback(async () => {
    setIsCheckingBinary(true);
    try {
      const result = await checkTunnelBinary(true);
      await Promise.all([
        refetchTunnel(),
        queryClient.invalidateQueries({ queryKey: ["tunnel"] }),
      ]);
      if (result.isInstalled) {
        toast({
          title: t("tunnel.title"),
          description: t("tunnel.binaryDetectedSuccess", {
            path: result.binaryPath || "",
          }),
        });
      } else {
        toast({
          title: t("tunnel.title"),
          description: t("tunnel.binaryStillMissing"),
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: t("common.error"),
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIsCheckingBinary(false);
    }
  }, [queryClient, refetchTunnel, t, toast]);

  const handleStartTunnel = useCallback(() => {
    if (tunnelStatus?.isBinaryInstalled === false) return;
    startTunnelMutation.mutate({ targetPort: relayStatus?.port || 4040 });
  }, [relayStatus?.port, startTunnelMutation, tunnelStatus?.isBinaryInstalled]);

  const handleRestartTunnel = useCallback(() => {
    restartTunnelMutation.mutate({ targetPort: relayStatus?.port || 4040 });
  }, [relayStatus?.port, restartTunnelMutation]);

  const handleStopTunnel = useCallback(() => {
    stopTunnelMutation.mutate();
  }, [stopTunnelMutation]);

  const handleConfirmRevoke = useCallback(() => {
    if (!sessionToRevoke) return;
    const sid = sessionToRevoke.sessionId;
    setSessionToRevoke(null);
    revokeSessionMutation.mutate(sid);
  }, [sessionToRevoke, revokeSessionMutation]);

  const handleCopyDeviceId = useCallback(
    async (deviceId: string) => {
      await navigator.clipboard.writeText(deviceId);
      toast({
        title: t("sessions.title"),
        description: t("sessions.deviceIdCopied"),
      });
    },
    [t, toast],
  );

  // Upstream status pill info
  const upstreamInfo = useMemo(() => {
    if (relayStatus?.isBuffering) {
      return {
        label: t("relay.upstreamBuffering"),
        color:
          "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400 dark:border-purple-800",
        dot: "bg-purple-500 animate-pulse",
      };
    }
    const state = relayStatus?.upstream?.state;
    if (state === "connected") {
      return {
        label: t("relay.upstreamConnected"),
        color:
          "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800",
        dot: "bg-emerald-500",
      };
    }
    if (state === "reconnecting") {
      return {
        label: t("relay.upstreamReconnecting"),
        color:
          "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-800",
        dot: "bg-amber-500 animate-pulse",
      };
    }
    return {
      label: t("relay.upstreamOffline"),
      color:
        "bg-zinc-500/15 text-zinc-600 border-zinc-300 dark:text-zinc-400 dark:border-zinc-800",
      dot: "bg-zinc-400",
    };
  }, [relayStatus?.isBuffering, relayStatus?.upstream?.state, t]);

  // Tunnel state info
  const tunnelStateInfo = useMemo(() => {
    if (tunnelStatus?.isBinaryInstalled === false) {
      return {
        label: t("tunnel.notInstalledBadge"),
        color:
          "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-800",
        dot: "bg-amber-500",
      };
    }
    const s = tunnelStatus?.state;
    if (s === "connected") {
      return {
        label: t("tunnel.statusConnected"),
        color:
          "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800",
        dot: "bg-emerald-500 animate-pulse",
      };
    }
    if (s === "starting") {
      return {
        label: t("tunnel.statusStarting"),
        color:
          "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-800",
        dot: "bg-amber-500 animate-ping",
      };
    }
    if (s === "reconnecting") {
      return {
        label: t("tunnel.statusReconnecting"),
        color:
          "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-800",
        dot: "bg-amber-500 animate-pulse",
      };
    }
    if (s === "error") {
      return {
        label: t("tunnel.statusError"),
        color:
          "bg-red-500/15 text-red-600 border-red-300 dark:text-red-400 dark:border-red-800",
        dot: "bg-red-500",
      };
    }
    return {
      label: t("tunnel.statusStopped"),
      color:
        "bg-zinc-500/15 text-zinc-600 border-zinc-300 dark:text-zinc-400 dark:border-zinc-800",
      dot: "bg-zinc-400",
    };
  }, [tunnelStatus?.isBinaryInstalled, tunnelStatus?.state, t]);

  const bufferCount = relayStatus?.upstream?.bufferedCommandCount || 0;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Radio className="h-7 w-7 text-primary" />
            <h2 className="text-3xl font-bold tracking-tight">
              {t("remote.title")}
            </h2>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("remote.subtitle")}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshAll}
          disabled={isRelayLoading || isTunnelLoading}
          className="gap-2"
        >
          <RotateCw
            className={`h-4 w-4 ${isRelayLoading || isTunnelLoading ? "animate-spin" : ""}`}
          />
          <span>{t("action.retry")}</span>
        </Button>
      </div>

      {/* Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Relay Server & Tunnel Supervisor */}
        <div className="space-y-6">
          {/* Card 1: Fastify Relay Server */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Server className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-lg">
                      {t("relay.title")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t("relay.subtitle")}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      relayStatus?.isRunning
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-zinc-400"
                    }`}
                  />
                  <span className="text-xs font-semibold">
                    {relayStatus?.isRunning
                      ? t("relay.statusActive")
                      : t("relay.statusInactive")}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("relay.port", { port: relayStatus?.port || 4040 })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {relayStatus?.isRunning
                      ? `${relayStatus.activeSessions} active sessions`
                      : "Server stopped"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={relayStatus?.isRunning ? "destructive" : "default"}
                  disabled={
                    startRelayMutation.isPending || stopRelayMutation.isPending
                  }
                  onClick={handleToggleRelay}
                  className="w-full sm:w-auto gap-2"
                >
                  {(startRelayMutation.isPending ||
                    stopRelayMutation.isPending) && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {relayStatus?.isRunning
                    ? t("relay.toggleStop")
                    : t("relay.toggleStart")}
                </Button>
              </div>

              {/* Upstream Daemon Bridge Status */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                <div className="space-y-1">
                  <div className="text-xs font-semibold">
                    {t("relay.upstreamTitle")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bufferCount > 0
                      ? t("relay.bufferCount", { count: bufferCount })
                      : t("relay.bufferEmpty")}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 whitespace-nowrap gap-1.5 px-2.5 py-0.5 text-xs font-medium ${upstreamInfo.color}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${upstreamInfo.dot}`}
                  />
                  {upstreamInfo.label}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Cloudflare Quick Tunnel */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 shrink-0">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-lg">
                      {t("tunnel.title")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t("tunnel.subtitle")}
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`gap-1.5 px-2.5 py-1 text-xs font-medium shrink-0 ${tunnelStateInfo.color}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${tunnelStateInfo.dot}`}
                  />
                  {tunnelStateInfo.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Public Tunnel URL */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("tunnel.urlLabel")}
                  </label>
                  {tunnelStatus?.pid && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {t("tunnel.pid", { pid: tunnelStatus.pid })}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={publicUrl || ""}
                    placeholder={t("tunnel.urlPlaceholder")}
                    className="font-mono text-xs select-all bg-muted/30 min-w-0 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!publicUrl}
                    onClick={handleCopyUrl}
                    title={t("tunnel.copyUrl")}
                    className="shrink-0"
                  >
                    {copiedUrl ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  {publicUrl && (
                    <Button
                      variant="outline"
                      size="icon"
                      asChild
                      title="Open Tunnel in Browser"
                      className="shrink-0"
                    >
                      <a href={publicUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {/* Missing Binary Guidance Alert */}
              {tunnelStatus?.isBinaryInstalled === false && (
                <div
                  role="region"
                  aria-labelledby="tunnel-missing-title"
                  aria-describedby="cf-binary-missing-notice"
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-3 dark:border-amber-500/30 dark:bg-amber-500/10"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
                      aria-hidden="true"
                    />
                    <h4
                      id="tunnel-missing-title"
                      className="text-xs sm:text-sm font-semibold text-amber-950 dark:text-amber-100"
                    >
                      {t("tunnel.missingBannerTitle")}
                    </h4>
                  </div>
                  <p
                    id="cf-binary-missing-notice"
                    className="text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed"
                  >
                    {t("tunnel.missingBannerDesc")}
                  </p>

                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-medium text-amber-950 dark:text-amber-100">
                      {tunnelStatus?.platform
                        ? t("tunnel.installCommandLabel", {
                            platform:
                              tunnelStatus.platform === "darwin"
                                ? "macOS (Homebrew)"
                                : tunnelStatus.platform === "win32"
                                  ? "Windows (Winget)"
                                  : "Linux (APT / Snap)",
                          })
                        : t("tunnel.installCommandLabelGeneric")}
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 rounded-md bg-muted/60 dark:bg-muted/30 border border-border">
                      <div className="min-w-0 flex-1 overflow-x-auto py-1 px-2 font-mono text-xs select-all text-foreground">
                        <code>{installCommand}</code>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleCopyInstallCommand}
                        className="min-h-[44px] sm:min-h-[36px] min-w-[44px] sm:min-w-auto shrink-0 gap-1.5 px-3"
                      >
                        {copiedCommand ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        <span className="text-xs">
                          {copiedCommand
                            ? t("tunnel.copied")
                            : t("tunnel.copyCommand")}
                        </span>
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isCheckingBinary}
                      onClick={handleCheckAgain}
                      aria-busy={isCheckingBinary}
                      className="min-h-[44px] sm:min-h-[36px] gap-2 px-3 border-amber-400/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/10 dark:border-amber-500/30"
                    >
                      <RotateCw
                        className={cn(
                          "h-4 w-4",
                          isCheckingBinary && "animate-spin",
                        )}
                      />
                      <span>
                        {isCheckingBinary
                          ? t("tunnel.checking")
                          : t("tunnel.checkAgain")}
                      </span>
                    </Button>

                    <a
                      href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        if (window.electron?.openExternalUrl) {
                          e.preventDefault();
                          window.electron.openExternalUrl(
                            "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
                          );
                        }
                      }}
                      className="inline-flex items-center justify-center sm:justify-start gap-1.5 min-h-[44px] sm:min-h-[36px] px-2 text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                    >
                      <span>{t("tunnel.officialDocs")}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    </a>
                  </div>
                </div>
              )}

              {/* Tunnel Control Buttons */}
              {tunnelStatus?.state === "connected" ||
              tunnelStatus?.state === "starting" ||
              tunnelStatus?.state === "reconnecting" ? (
                <div className="flex flex-wrap sm:flex-nowrap gap-2 justify-end pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      tunnelStatus.state !== "connected" ||
                      isRestarting ||
                      isStopping
                    }
                    onClick={handleRestartTunnel}
                    className="w-full sm:w-auto min-h-[40px] px-3.5 gap-2 border-border text-foreground hover:bg-accent"
                  >
                    <RotateCw
                      className={cn("h-4 w-4", isRestarting && "animate-spin")}
                    />
                    <span>
                      {isRestarting
                        ? t("tunnel.restarting")
                        : t("tunnel.restartTunnel")}
                    </span>
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isStopping || isRestarting}
                    onClick={handleStopTunnel}
                    className="w-full sm:w-auto min-h-[40px] px-3.5 gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isStopping ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4 fill-current" />
                    )}
                    <span>
                      {isStopping ? t("tunnel.stopping") : t("tunnel.stop")}
                    </span>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap sm:flex-nowrap gap-2 justify-end pt-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={
                      isStarting || tunnelStatus?.isBinaryInstalled === false
                    }
                    aria-disabled={
                      tunnelStatus?.isBinaryInstalled === false
                        ? "true"
                        : undefined
                    }
                    aria-describedby={
                      tunnelStatus?.isBinaryInstalled === false
                        ? "cf-binary-missing-notice"
                        : undefined
                    }
                    title={
                      tunnelStatus?.isBinaryInstalled === false
                        ? t("tunnel.startDisabledReason")
                        : undefined
                    }
                    onClick={handleStartTunnel}
                    className={cn(
                      "w-full sm:w-auto min-h-[40px] px-4 gap-2",
                      tunnelStatus?.isBinaryInstalled === false &&
                        "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {isStarting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
                    <span>
                      {isStarting ? t("tunnel.starting") : t("tunnel.start")}
                    </span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Mobile Pairing & QR Access */}
        <div className="space-y-6">
          <Card
            className={
              !isRelayRunning
                ? "opacity-80 transition-opacity"
                : "transition-opacity"
            }
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0 mt-0.5">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-lg">
                      {t("pairing.title")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t("pairing.subtitle")}
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 whitespace-nowrap gap-1.5 px-2.5 py-1 text-xs font-medium ${
                    !isRelayRunning
                      ? "bg-zinc-500/15 text-zinc-600 border-zinc-300 dark:text-zinc-400 dark:border-zinc-800"
                      : isTunnelConnected
                        ? "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800"
                        : "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-800"
                  }`}
                >
                  {!isRelayRunning ? (
                    <PowerOff className="h-3.5 w-3.5" />
                  ) : isTunnelConnected ? (
                    <Cloud className="h-3.5 w-3.5" />
                  ) : (
                    <Wifi className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {!isRelayRunning
                      ? t("pairing.serverInactive")
                      : isTunnelConnected
                        ? t("pairing.modeTunnel")
                        : t("pairing.modeWifi")}
                  </span>
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-5">
              {/* Transient Auto-Regen Indicator Banner */}
              {showAutoRegenBanner && (
                <div
                  role="status"
                  aria-live="polite"
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium transition-all duration-300"
                >
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span>{t("pairing.autoRegeneratedNotice")}</span>
                </div>
              )}

              {/* QR Code */}
              <div className="relative p-4 rounded-xl border bg-white dark:bg-zinc-950 shadow-sm overflow-hidden">
                <div
                  className={`transition-all duration-200 ${
                    !isRelayRunning
                      ? "filter grayscale blur-[1px] opacity-20 pointer-events-none select-none"
                      : ""
                  }`}
                >
                  <QRCode
                    value={pairingUrl}
                    size={190}
                    title={t("pairing.title")}
                    description={t("pairing.scanInstructions")}
                    ariaLabel={t("pairing.qrAlt")}
                  />
                </div>
                {!isRelayRunning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-background/80 backdrop-blur-[2px] text-center select-none">
                    <div className="p-2.5 rounded-full bg-muted text-muted-foreground mb-2">
                      <PowerOff className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-semibold text-foreground">
                      {t("pairing.serverInactive")}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-1 max-w-[170px] leading-tight">
                      {t("pairing.startServerToPair")}
                    </span>
                  </div>
                )}
              </div>

              <div className="text-center space-y-1 max-w-sm">
                <p
                  className={`text-xs font-semibold ${
                    !isRelayRunning
                      ? "text-muted-foreground"
                      : "text-foreground"
                  }`}
                >
                  {t("pairing.scanInstructions")}
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t("pairing.scanTip")}
                </p>
              </div>

              {isRelayRunning && !isTunnelConnected && (
                <div
                  role="status"
                  className="w-full flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs"
                >
                  <Wifi className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-medium">
                      {t("pairing.wifiAdvisory")}
                    </span>{" "}
                    <span className="font-mono text-[11px] opacity-90">
                      ({recommendedIp})
                    </span>
                  </div>
                </div>
              )}

              {/* Plain Pairing URL */}
              <div
                className={`w-full space-y-2 pt-2 border-t ${
                  !isRelayRunning ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="pairing-url-input"
                    className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-primary" />
                    <span>{t("pairing.copyLink")}</span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="pairing-url-input"
                    readOnly
                    disabled={!isRelayRunning}
                    value={pairingUrl}
                    aria-label={t("pairing.copyLink")}
                    className="font-mono text-xs select-all bg-muted/30 min-w-0 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isRelayRunning}
                    onClick={handleCopyLink}
                    className="gap-1.5 shrink-0"
                  >
                    {copiedLink ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{t("pairing.copyLink")}</span>
                  </Button>
                </div>
              </div>

              {/* Ephemeral Pairing Token */}
              <div
                className={`w-full space-y-2 pt-2 border-t ${
                  !isRelayRunning ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
                      <Shield className="h-3.5 w-3.5 text-primary" />
                      {t("pairing.tokenLabel")}
                    </label>
                    <Badge
                      variant="outline"
                      className="gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800 shrink-0"
                    >
                      <Shield className="h-3 w-3" />
                      <span>{t("pairing.keySingleUseBadge")}</span>
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      !isRelayRunning || regenerateKeyMutation.isPending
                    }
                    className="h-7 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => regenerateKeyMutation.mutate()}
                  >
                    <RotateCw
                      className={cn(
                        "h-3 w-3 mr-1",
                        regenerateKeyMutation.isPending && "animate-spin",
                      )}
                    />
                    {t("pairing.regenerateToken")}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    disabled={!isRelayRunning}
                    value={pairingToken}
                    type="password"
                    aria-label={t("pairing.tokenLabel")}
                    className={cn(
                      "font-mono text-xs select-all bg-muted/30 min-w-0 flex-1 transition-all duration-300",
                      showAutoRegenBanner &&
                        "ring-2 ring-emerald-500/50 border-emerald-500",
                    )}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isRelayRunning}
                    onClick={handleCopyToken}
                    className="gap-1.5 shrink-0"
                  >
                    {copiedToken ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{t("pairing.copyToken")}</span>
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("pairing.securityNotice")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Full Width Bottom: Connected Phone Sessions Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg">{t("sessions.title")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("sessions.subtitle")}
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="secondary"
              className="font-mono text-xs shrink-0"
              role="status"
              aria-label={t("sessions.countAria", { count: sessions.length })}
            >
              {sessions.length === 1
                ? t("sessions.countSingular", { count: sessions.length })
                : t("sessions.countPlural", { count: sessions.length })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed bg-muted/10 space-y-2">
              <Smartphone className="h-8 w-8 text-muted-foreground/60" />
              <div className="text-sm font-semibold">
                {t("sessions.emptyTitle")}
              </div>
              <div className="text-xs text-muted-foreground max-w-sm">
                {t("sessions.emptyDescription")}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto w-full">
                <table
                  className="w-full min-w-[540px] text-left text-xs"
                  aria-label={t("sessions.title")}
                >
                  <thead className="bg-muted/50 border-b text-muted-foreground font-semibold">
                    <tr>
                      <th
                        scope="col"
                        className="py-3 px-4 uppercase tracking-wider"
                      >
                        {t("sessions.colDevice")}
                      </th>
                      <th
                        scope="col"
                        className="py-3 px-4 uppercase tracking-wider"
                      >
                        {t("sessions.colIp")}
                      </th>
                      <th
                        scope="col"
                        className="py-3 px-4 uppercase tracking-wider"
                      >
                        {t("sessions.colDuration")}
                      </th>
                      <th
                        scope="col"
                        className="py-3 px-4 uppercase tracking-wider"
                      >
                        {t("sessions.colLastActive")}
                      </th>
                      <th
                        scope="col"
                        className="py-3 px-4 uppercase tracking-wider text-right"
                      >
                        {t("sessions.colActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sessions.map((sess) => {
                      const parsed = parseDeviceUserAgent(sess.userAgent, t);
                      const durationStr = formatDuration(
                        now - sess.connectedAt,
                      );
                      const lastActiveStr = formatRelativeTime(
                        now - sess.lastActiveAt,
                        t,
                      );
                      const isRevoking =
                        revokeSessionMutation.isPending &&
                        revokeSessionMutation.variables === sess.sessionId;

                      return (
                        <tr
                          key={sess.sessionId}
                          className="hover:bg-muted/40 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-foreground truncate">
                                    {parsed.device}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-[11px] text-muted-foreground truncate">
                                    {parsed.browser}
                                  </span>
                                  {sess.deviceId && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCopyDeviceId(sess.deviceId!)
                                      }
                                      className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground/80 hover:text-foreground bg-muted/60 hover:bg-muted px-1.5 py-0.5 rounded border border-border/40 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-w-[130px] sm:max-w-[160px] truncate group"
                                      title={t("sessions.deviceIdTooltip", {
                                        id: sess.deviceId,
                                      })}
                                      aria-label={t(
                                        "sessions.copyDeviceIdAria",
                                        {
                                          id: sess.deviceId,
                                        },
                                      )}
                                    >
                                      <Fingerprint
                                        className="h-3 w-3 text-muted-foreground/60 group-hover:text-foreground shrink-0"
                                        aria-hidden="true"
                                      />
                                      <span className="truncate">
                                        {shortenDeviceId(sess.deviceId)}
                                      </span>
                                      <Copy
                                        className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-0.5"
                                        aria-hidden="true"
                                      />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-muted-foreground">
                            {sess.clientIp || "127.0.0.1"}
                          </td>
                          <td className="py-3 px-4 font-mono text-muted-foreground">
                            {durationStr}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {lastActiveStr}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isRevoking}
                              onClick={() => setSessionToRevoke(sess)}
                              title={t("sessions.revokeTooltip")}
                              aria-label={t("sessions.revokeAriaLabel", {
                                device: parsed.device,
                                ip: sess.clientIp || "127.0.0.1",
                              })}
                              className="text-red-500 hover:text-red-600 hover:bg-red-500/10 gap-1.5 h-8 px-2.5"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>
                                {isRevoking
                                  ? t("sessions.revoking")
                                  : t("sessions.revoke")}
                              </span>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Session Revocation */}
      <Dialog
        open={!!sessionToRevoke}
        onOpenChange={(open) => {
          if (!open) setSessionToRevoke(null);
        }}
      >
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <DialogTitle className="text-base font-semibold leading-snug">
                {t("sessions.confirmRevokeTitle")}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground pt-2 leading-relaxed">
              {sessionToRevoke &&
                t("sessions.confirmRevokeMessage", {
                  device: parseDeviceUserAgent(sessionToRevoke.userAgent, t)
                    .device,
                  ip: sessionToRevoke.clientIp || "127.0.0.1",
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSessionToRevoke(null)}
              disabled={revokeSessionMutation.isPending}
              className="min-h-[40px] sm:min-h-[36px]"
            >
              {t("action.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmRevoke}
              disabled={revokeSessionMutation.isPending}
              className="min-h-[40px] sm:min-h-[36px] gap-1.5"
            >
              {revokeSessionMutation.isPending ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>{t("sessions.revoking")}</span>
                </>
              ) : (
                <span>{t("sessions.confirmRevokeAction")}</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
