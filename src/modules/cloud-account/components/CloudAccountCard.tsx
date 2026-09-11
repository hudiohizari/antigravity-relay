import {
  CloudAccount,
  CloudQuotaModelInfo,
} from "@/modules/cloud-account/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/shared/ui/utils";

import {
  MoreVertical,
  Trash,
  RefreshCw,
  Box,
  Power,
  Fingerprint,
  Eye,
  EyeOff,
  ExternalLink,
  Layers,
  ChevronDown,
  Check,
  Loader2,
  Workflow,
  Code,
  Terminal,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getProcessStatus } from "@/modules/antigravity-runtime/actions/process";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "@/modules/config/hooks/useAppConfig";
import { useProviderGrouping } from "@/modules/cloud-account/hooks/useProviderGrouping";
import { ProviderGroup } from "@/modules/cloud-account/components/ProviderGroup";
import {
  clampQuotaPercentage,
  formatAiCreditsAmount,
  formatResetTimeLabel,
  formatResetTimeTitle,
  getQuotaStatus,
} from "@/modules/cloud-account/utils/quota-display";
import { useState } from "react";
import { useSetAccountProxy } from "@/modules/cloud-account/hooks/useCloudAccounts";
import { isValidProxyUrl } from "@/shared/utils/url";
import { getCloudAccountBlockedStatusLabel } from "@/modules/cloud-account/utils/accountValidationStatus";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { AccountTierBadge } from "@/modules/cloud-account/components/AccountTierBadge";
import { aggregateVisibleQuotaModelFamilies } from "@/modules/cloud-account/utils/quota-model-families";
import {
  selectWeeklyQuotaItems,
  type QuotaWindow,
} from "@/modules/cloud-account/utils/quota-groups";
import { WeeklyQuotaDisplay } from "@/modules/cloud-account/components/WeeklyQuotaDisplay";
import { DetailedQuotaDisplay } from "@/modules/cloud-account/components/DetailedQuotaDisplay";
import {
  QUOTA_TEXT_COLOR_CLASS_BY_STATUS,
  QUOTA_BAR_COLOR_CLASS_BY_STATUS,
} from "./quota-colors";
import { isWeeklyQuotaBucket } from "@/modules/cloud-account/utils/quota-groups";
import { openAccountValidationLink } from "@/modules/cloud-account/actions/cloud";

type ModelQuotaEntry = [string, CloudQuotaModelInfo];

const GEMINI_LEGACY_MODEL_PATTERN = /gemini-[12](\.|$|-)/i;
const GEMINI_PRO_COMBINED_MODEL_ID = "gemini-3.1-pro-low/high";

const MODEL_DISPLAY_REPLACEMENTS: Array<[string, string]> = [
  [GEMINI_PRO_COMBINED_MODEL_ID, "Gemini 3.1 Pro (Low/High)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"],
  ["gemini-3-pro-image", "Gemini 3 Pro Image"],
  ["gemini-3.1-pro", "Gemini 3.1 Pro"],
  ["gemini-3-pro", "Gemini 3 Pro"],
  ["gemini-3-flash", "Gemini 3 Flash"],
  ["claude-sonnet-4-6-thinking", "Claude 4.6 Sonnet (Thinking)"],
  ["claude-sonnet-4-6", "Claude 4.6 Sonnet"],
  ["claude-sonnet-4-5-thinking", "Claude 4.5 Sonnet (Thinking)"],
  ["claude-sonnet-4-5", "Claude 4.5 Sonnet"],
  ["claude-opus-4-6-thinking", "Claude 4.6 Opus (Thinking)"],
  ["claude-opus-4-5-thinking", "Claude 4.5 Opus (Thinking)"],
  ["claude-3-5-sonnet", "Claude 3.5 Sonnet"],
];

function formatCreditsExpiry(expiryDate: string): string {
  if (!expiryDate) {
    return "";
  }

  try {
    const date = new Date(expiryDate);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return expiryDate;
  }
}

function formatModelDisplayName(modelName: string): string {
  let displayName = modelName.replace("models/", "");
  for (const [source, target] of MODEL_DISPLAY_REPLACEMENTS) {
    displayName = displayName.replace(source, target);
  }

  return displayName
    .replace(/-/g, " ")
    .split(" ")
    .map((word) =>
      word.length > 2 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

export function useInstalledTargets() {
  const { data: appStatus } = useQuery({
    queryKey: ["process", "status", "app"],
    queryFn: () => getProcessStatus("app"),
    staleTime: 30000,
  });
  const { data: ideStatus } = useQuery({
    queryKey: ["process", "status", "ide"],
    queryFn: () => getProcessStatus("ide"),
    staleTime: 30000,
  });
  const { data: cliStatus } = useQuery({
    queryKey: ["process", "status", "cli"],
    queryFn: () => getProcessStatus("cli"),
    staleTime: 30000,
  });

  const appInstalled = appStatus?.isBinaryInstalled ?? true;
  const ideInstalled = ideStatus?.isBinaryInstalled ?? true;
  const cliInstalled = cliStatus?.isBinaryInstalled ?? true;

  return {
    app: appInstalled,
    ide: ideInstalled,
    cli: cliInstalled,
    classic: appInstalled,
    agy: cliInstalled,
  };
}

interface CloudAccountCardProps {
  account: CloudAccount;
  quotaWindow?: QuotaWindow;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSwitch: (id: string, appTarget?: AntigravityAppTarget | "all") => void;
  onManageIdentity: (id: string) => void;
  isSelected?: boolean;
  onToggleSelection?: (id: string, selected: boolean) => void;
  isRefreshing?: boolean;
  isDeleting?: boolean;
  isSwitching?: boolean;
  switchingTarget?: AntigravityAppTarget | "all";
}

export function CloudAccountCard({
  account,
  quotaWindow = "5h",
  onRefresh,
  onDelete,
  onSwitch,
  onManageIdentity,
  isSelected = false,
  onToggleSelection,
  isRefreshing,
  isDeleting,
  isSwitching,
  switchingTarget,
}: CloudAccountCardProps) {
  const { t } = useTranslation();
  const { config, saveConfig } = useAppConfig();
  const {
    enabled: providerGroupingsEnabled,
    getAccountStats,
    isProviderCollapsed,
    toggleProviderCollapse,
  } = useProviderGrouping();
  const setAccountProxy = useSetAccountProxy();
  const [proxyUrl, setProxyUrl] = useState(account.proxy_url || "");
  const [proxySaved, setProxySaved] = useState(false);
  const installedTargets = useInstalledTargets();
  const isCliActive = Boolean(account.is_active_cli || account.is_active_agy);
  const isAppActive = Boolean(
    account.is_active_app ||
    account.is_active_classic ||
    (!account.is_active_ide && !isCliActive && account.is_active),
  );
  const isAllActive = Boolean(
    isAppActive && account.is_active_ide && isCliActive,
  );

  const getQuotaTextColorClass = (percentage: number) => {
    const quotaStatus = getQuotaStatus(percentage);
    return QUOTA_TEXT_COLOR_CLASS_BY_STATUS[quotaStatus];
  };

  const getQuotaBarColorClass = (percentage: number) => {
    const quotaStatus = getQuotaStatus(percentage);
    return QUOTA_BAR_COLOR_CLASS_BY_STATUS[quotaStatus];
  };

  const formatQuotaLabel = (percentage: number) => {
    if (percentage === 0) {
      return t("cloud.card.rateLimitedQuota");
    }
    return `${percentage}%`;
  };

  const formatResetTimeLabelText = (resetTime?: string) => {
    return formatResetTimeLabel(resetTime, {
      prefix: t("cloud.card.resetPrefix"),
      unknown: t("cloud.card.resetUnknown"),
    });
  };

  const formatResetTimeTitleText = (resetTime?: string) => {
    return formatResetTimeTitle(resetTime, t("cloud.card.resetTime"));
  };

  const allModelEntries = Object.entries(
    account.quota?.models || {},
  ) as ModelQuotaEntry[];

  const mergedModelQuotas = aggregateVisibleQuotaModelFamilies(
    account.quota?.models || {},
    config?.model_visibility || {},
  );

  const geminiModels = Object.entries(mergedModelQuotas)
    .filter(
      ([name]) =>
        name.includes("gemini") && !GEMINI_LEGACY_MODEL_PATTERN.test(name),
    )
    .sort((a, b) => b[1].percentage - a[1].percentage);

  const claudeModels = Object.entries(mergedModelQuotas)
    .filter(([name]) => name.includes("claude"))
    .sort((a, b) => b[1].percentage - a[1].percentage);

  const hasVisibleQuotaModels =
    geminiModels.length > 0 || claudeModels.length > 0;
  const weeklyQuotaItems = selectWeeklyQuotaItems(account.quota?.quota_groups);
  const detailedGroups = account.quota?.quota_groups ?? [];
  const hasDetailedQuota = detailedGroups.some((group) =>
    group.buckets.some((bucket) => !isWeeklyQuotaBucket(bucket)),
  );

  const renderQuotaModelGroup = (title: string, models: ModelQuotaEntry[]) => {
    if (models.length === 0) return null;
    return (
      <div key={title} className="space-y-1">
        <div className="flex items-center gap-1.5 px-2 py-1">
          <span className="text-muted-foreground/70 text-[10px] font-bold tracking-wider uppercase">
            {title}
          </span>
          <div className="bg-border/50 h-px flex-1" />
        </div>
        {models.map(([modelName, info]) => {
          return (
            <div
              key={modelName}
              className="group/item hover:bg-muted/60 hover:border-border/60 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-sm transition-all duration-150"
              title={`${formatModelDisplayName(modelName)} · ${formatResetTimeTitleText(info.resetTime)}`}
            >
              <div className="min-w-0">
                <span className="text-muted-foreground group-hover/item:text-foreground flex min-w-0 items-center truncate font-semibold transition-colors">
                  <span className="truncate">
                    {formatModelDisplayName(modelName)}
                  </span>
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span
                  className="text-muted-foreground text-[9px] leading-none opacity-80 select-none"
                  title={formatResetTimeTitleText(info.resetTime)}
                >
                  {formatResetTimeLabelText(info.resetTime)}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-xs leading-none font-bold tabular-nums",
                      getQuotaTextColorClass(info.percentage),
                    )}
                  >
                    {info.percentage}%
                  </span>
                  <div
                    className="bg-muted/70 border-border/20 h-1.5 w-16 overflow-hidden rounded-full border shadow-inner"
                    role="progressbar"
                    aria-valuenow={info.percentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${formatModelDisplayName(modelName)} quota remaining`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        getQuotaBarColorClass(info.percentage),
                      )}
                      style={{
                        width: `${clampQuotaPercentage(info.percentage)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const emptyQuotaState = (
    <div className="text-muted-foreground flex flex-col items-center justify-center py-4">
      <Box className="mb-2 h-8 w-8 opacity-20" />
      <span className="text-xs">{t("cloud.card.noQuota")}</span>
    </div>
  );

  const providerStats = providerGroupingsEnabled
    ? getAccountStats(account)
    : null;
  const providerGroupedQuotaSection =
    providerStats && providerStats.visibleModels > 0 ? (
      <>
        <div className="bg-muted/40 flex items-center justify-between rounded-lg px-3 py-1.5 text-xs">
          <span className="font-medium">
            {t("settings.providerGroupings.overall")}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`font-mono font-bold ${getQuotaTextColorClass(providerStats.overallPercentage)}`}
            >
              {formatQuotaLabel(providerStats.overallPercentage)}
            </span>
            <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getQuotaBarColorClass(providerStats.overallPercentage)}`}
                style={{
                  width: `${clampQuotaPercentage(providerStats.overallPercentage)}%`,
                }}
              />
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {providerStats.providers.map((group) => (
            <ProviderGroup
              key={group.providerKey}
              stats={group}
              isCollapsed={isProviderCollapsed(account.id, group.providerKey)}
              onToggleCollapse={() =>
                toggleProviderCollapse(account.id, group.providerKey)
              }
              getQuotaTextColorClass={getQuotaTextColorClass}
              getQuotaBarColorClass={getQuotaBarColorClass}
              formatQuotaLabel={formatQuotaLabel}
              formatResetTimeLabel={formatResetTimeLabelText}
              formatResetTimeTitle={formatResetTimeTitleText}
              leftLabel={t("cloud.card.left")}
            />
          ))}
        </div>
      </>
    ) : (
      emptyQuotaState
    );

  const aiCredits = account.quota?.ai_credits;
  const shouldShowAiCredits =
    !!aiCredits && Number.isFinite(aiCredits.credits) && aiCredits.credits >= 0;

  const validationBlockedStatusLabel = getCloudAccountBlockedStatusLabel(
    account,
    t,
  );

  return (
    <Card
      className={`group bg-card hover:border-primary/30 border-border/80 relative flex h-full flex-col overflow-hidden rounded-xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.06),0_4px_12px_-2px_rgba(0,0,0,0.03)] ${isSelected ? "ring-primary border-primary/50 ring-2" : ""}`}
    >
      <CardHeader className="relative flex flex-row items-center gap-4 space-y-0 pb-2">
        {onToggleSelection && (
          <div
            className={`absolute top-2 left-2 z-10 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"} bg-background/90 rounded-full p-2 transition-opacity`}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) =>
                onToggleSelection(account.id, checked as boolean)
              }
              className="h-5 w-5 border-2"
            />
          </div>
        )}

        <Avatar className="h-10 w-10 border">
          <AvatarImage
            src={account.avatar_url || undefined}
            alt={account.name || ""}
            referrerPolicy="no-referrer"
          />
          <AvatarFallback className="bg-primary/10 text-primary font-bold">
            {account.name?.[0]?.toUpperCase() || "A"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 overflow-hidden">
          <CardTitle className="truncate text-base font-semibold">
            {account.name || t("cloud.card.unknown")}
          </CardTitle>
          <CardDescription className="text-muted-foreground truncate text-xs">
            {account.email}
          </CardDescription>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isAppActive && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="status"
                      aria-label={`${t("cloud.target.app")}: ${t("cloud.switch.activeBadge")}`}
                      className="inline-flex items-center gap-1 rounded border border-green-500/25 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none cursor-default"
                    >
                      <span
                        className="relative flex h-1.5 w-1.5"
                        aria-hidden="true"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                      </span>
                      <span>{t("cloud.target.appShort")}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    {t("cloud.target.app")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {account.is_active_ide && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="status"
                      aria-label={`${t("cloud.target.ide")}: ${t("cloud.switch.activeBadge")}`}
                      className="inline-flex items-center gap-1 rounded border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none cursor-default"
                    >
                      <span
                        className="relative flex h-1.5 w-1.5"
                        aria-hidden="true"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      </span>
                      <span>{t("cloud.target.ideShort")}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    {t("cloud.target.ide")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {isCliActive && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="status"
                      aria-label={`${t("cloud.target.cli")}: ${t("cloud.switch.activeBadge")}`}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-tight text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none cursor-default"
                    >
                      <span
                        className="relative flex h-1.5 w-1.5"
                        aria-hidden="true"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <span>{t("cloud.target.cliShort")}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    {t("cloud.target.cli")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {shouldShowAiCredits && aiCredits && (
            <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-blue-500">
              <span>
                {t("cloud.card.aiCreditsValue", {
                  amount: formatAiCreditsAmount(aiCredits.credits),
                })}
              </span>
              {aiCredits.expiryDate && (
                <span className="text-muted-foreground opacity-70">
                  ·{" "}
                  {t("cloud.card.creditsExpiry", {
                    date: formatCreditsExpiry(aiCredits.expiryDate),
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {allModelEntries.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted h-8 w-8 cursor-pointer rounded-full"
              >
                {(() => {
                  const hiddenCount = allModelEntries.filter(
                    ([modelName]) =>
                      config?.model_visibility?.[modelName] === false,
                  ).length;
                  return hiddenCount > 0 ? (
                    <EyeOff className="text-muted-foreground h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  );
                })()}
                <span className="sr-only">
                  {t("cloud.card.modelVisibility")}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end">
              <DropdownMenuLabel>
                {t("cloud.card.modelVisibility")}
              </DropdownMenuLabel>
              <div className="max-h-64 overflow-auto px-2 py-1">
                {allModelEntries.map(([modelName]) => {
                  const isVisible =
                    config?.model_visibility?.[modelName] !== false;
                  return (
                    <DropdownMenuItem
                      key={modelName}
                      onSelect={(e) => e.preventDefault()}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <Checkbox
                        checked={isVisible}
                        onCheckedChange={(checked) => {
                          if (config) {
                            const newVisibility = {
                              ...config.model_visibility,
                            };
                            newVisibility[modelName] = checked as boolean;
                            saveConfig({
                              ...config,
                              model_visibility: newVisibility,
                            });
                          }
                        }}
                      />
                      <span className="truncate text-xs" title={modelName}>
                        {formatModelDisplayName(modelName)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>

      <CardContent className="flex-1 pb-4">
        <div className="mb-3.5 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={
                account.status === "rate_limited" ||
                account.status === "expired"
                  ? "destructive"
                  : "outline"
              }
              className="px-2 py-0.5 text-[10px] font-bold tracking-wide"
            >
              {account.provider.toUpperCase()}
            </Badge>
            <AccountTierBadge
              account={account}
              unknownLabel={t("cloud.tierFilter.unknown")}
            />

            {validationBlockedStatusLabel && (
              <span className="text-destructive bg-destructive/10 border-destructive/20 rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                {validationBlockedStatusLabel}
              </span>
            )}
            {account.health?.validation?.verification_url && (
              <Button
                variant="destructive"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() =>
                  openAccountValidationLink({ accountId: account.id })
                }
              >
                <ExternalLink className="h-3 w-3" />
                {t("cloud.card.completeValidation")}
              </Button>
            )}
          </div>

          <div className="relative shrink-0">
            <DropdownMenu>
              <div className="inline-flex items-center rounded-lg border border-border bg-background shadow-sm">
                {/* Primary 1-Click Action: Switch All Environments */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSwitching || isAllActive}
                  onClick={() => onSwitch(account.id, "all")}
                  className={cn(
                    "h-8 rounded-l-lg rounded-r-none border-r border-border px-2.5 text-xs font-semibold transition-colors",
                    isAllActive
                      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 cursor-default"
                      : "hover:bg-accent text-foreground",
                  )}
                >
                  {isSwitching &&
                  (switchingTarget === "all" || !switchingTarget) ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : isAllActive ? (
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Layers className="mr-1.5 h-3.5 w-3.5 text-primary" />
                  )}
                  <span>
                    {isAllActive
                      ? t("cloud.switch.activeAll")
                      : t("cloud.switch.targetAllShort")}
                  </span>
                </Button>

                {/* Target Selection Trigger */}
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isSwitching}
                    aria-label={t("cloud.switch.triggerAria", {
                      email: account.email,
                    })}
                    className="h-8 w-7 rounded-l-none rounded-r-lg px-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
              </div>

              <DropdownMenuContent
                align="end"
                className="w-64 min-w-[16rem] max-w-[calc(100vw-2rem)] p-1.5"
              >
                {/* Global Action Item */}
                <DropdownMenuItem
                  disabled={isSwitching || isAllActive}
                  onSelect={() => onSwitch(account.id, "all")}
                  className="flex items-center justify-between font-medium cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span>{t("cloud.switch.targetAll")}</span>
                  </span>
                  {isAllActive && (
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                </DropdownMenuItem>

                <DropdownMenuSeparator className="my-1" />

                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("cloud.switch.menuTitle")}
                </DropdownMenuLabel>

                {/* Target 1: Antigravity App */}
                <DropdownMenuItem
                  disabled={isSwitching || isAppActive || !installedTargets.app}
                  onSelect={() => onSwitch(account.id, "app")}
                  className={cn(
                    "flex items-center justify-between cursor-pointer",
                    (!installedTargets.app || isAppActive) &&
                      "cursor-not-allowed opacity-60",
                  )}
                  title={
                    !installedTargets.app
                      ? t("status.tooltips.appNotInstalled")
                      : undefined
                  }
                >
                  <span className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-green-600" />
                    <span>{t("cloud.target.app")}</span>
                    {!installedTargets.app && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                        title={t("status.tooltips.appNotInstalled")}
                      />
                    )}
                  </span>
                  {isSwitching &&
                  (switchingTarget === "app" ||
                    switchingTarget === "classic") ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isAppActive ? (
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : null}
                </DropdownMenuItem>

                {/* Target 2: Antigravity IDE */}
                <DropdownMenuItem
                  disabled={
                    isSwitching ||
                    account.is_active_ide ||
                    !installedTargets.ide
                  }
                  onSelect={() => onSwitch(account.id, "ide")}
                  className={cn(
                    "flex items-center justify-between cursor-pointer",
                    (!installedTargets.ide || account.is_active_ide) &&
                      "cursor-not-allowed opacity-60",
                  )}
                  title={
                    !installedTargets.ide
                      ? t("status.tooltips.ideNotInstalled")
                      : undefined
                  }
                >
                  <span className="flex items-center gap-2">
                    <Code className="h-4 w-4 text-indigo-600" />
                    <span>{t("cloud.target.ide")}</span>
                    {!installedTargets.ide && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                        title={t("status.tooltips.ideNotInstalled")}
                      />
                    )}
                  </span>
                  {isSwitching && switchingTarget === "ide" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : account.is_active_ide ? (
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : null}
                </DropdownMenuItem>

                {/* Target 3: Antigravity CLI */}
                <DropdownMenuItem
                  disabled={isSwitching || isCliActive || !installedTargets.cli}
                  onSelect={() => onSwitch(account.id, "cli")}
                  className={cn(
                    "flex items-center justify-between cursor-pointer min-h-[44px]",
                    (!installedTargets.cli || isCliActive) &&
                      "cursor-not-allowed opacity-60",
                  )}
                  title={
                    !installedTargets.cli
                      ? t("status.tooltips.cliNotInstalled")
                      : t("cloud.switch.cliHint")
                  }
                >
                  <span className="flex items-start gap-2">
                    <Terminal className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5 font-mono text-sm leading-tight">
                        <span>{t("cloud.target.cli")}</span>
                        {!installedTargets.cli && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                            title={t("status.tooltips.cliNotInstalled")}
                          />
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground leading-normal font-sans">
                        {t("cloud.switch.cliHint")}
                      </span>
                    </div>
                  </span>
                  {isSwitching &&
                  (switchingTarget === "cli" || switchingTarget === "agy") ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : isCliActive ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-2">
          {quotaWindow === "weekly" ? (
            <WeeklyQuotaDisplay
              items={weeklyQuotaItems}
              hasQuotaSummary={account.quota?.quota_groups !== undefined}
            />
          ) : providerGroupingsEnabled ? (
            <>
              {providerGroupedQuotaSection}
              {!providerGroupedQuotaSection && !hasDetailedQuota
                ? emptyQuotaState
                : null}
            </>
          ) : hasVisibleQuotaModels ? (
            <div className="space-y-3">
              {renderQuotaModelGroup(
                t("cloud.card.groupGoogleGemini"),
                geminiModels,
              )}
              <div className="pt-1" />
              {renderQuotaModelGroup(
                t("cloud.card.groupAnthropicClaude"),
                claudeModels,
              )}
            </div>
          ) : hasDetailedQuota ? null : (
            emptyQuotaState
          )}
          {quotaWindow === "5h" && (
            <DetailedQuotaDisplay groups={detailedGroups} />
          )}
        </div>
      </CardContent>

      <CardFooter className="bg-muted/10 relative mt-auto flex h-11 shrink-0 items-center justify-between overflow-hidden border-t p-2 px-4">
        {/* Idle State / Used Time Indicator & Proxy Badge */}
        <div className="flex w-full items-center justify-between transition-all duration-300 group-hover:pointer-events-none group-hover:opacity-0">
          <span className="text-muted-foreground truncate text-[11px]">
            {t("cloud.card.used")}{" "}
            {formatDistanceToNow(account.last_used * 1000, { addSuffix: true })}
          </span>
          {account.proxy_url && (
            <span
              className="text-primary bg-primary/10 border-primary/20 origin-right scale-90 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide select-none"
              title={account.proxy_url}
            >
              {t("cloud.card.proxy")}
            </span>
          )}
        </div>

        {/* Hover State Container (Action Buttons + Outbound Proxy Input) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between gap-3 p-2 px-4 opacity-0 transition-all duration-300 ease-in-out group-hover:pointer-events-auto group-hover:opacity-100">
          {/* Action Icons group with Tooltips */}
          <div className="flex shrink-0 items-center gap-1">
            <TooltipProvider>
              {/* Refresh Button */}
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent border-border/50 h-7 w-7 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => onRefresh(account.id)}
                    disabled={isRefreshing}
                    aria-label={t("cloud.card.refresh")}
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        isRefreshing && "animate-spin",
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {t("cloud.card.refresh")}
                </TooltipContent>
              </Tooltip>

              {/* Profile Button */}
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent border-border/50 h-7 w-7 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => onManageIdentity(account.id)}
                    aria-label={t("cloud.card.identityProfile")}
                  >
                    <Fingerprint className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {t("cloud.card.identityProfile")}
                </TooltipContent>
              </Tooltip>

              {/* Delete Button */}
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 border-border/50 h-7 w-7 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-destructive"
                    onClick={() => onDelete(account.id)}
                    disabled={isDeleting}
                    aria-label={t("cloud.card.delete")}
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {t("cloud.card.delete")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Proxy Setting Input */}
          <div className="relative min-w-0 flex-1">
            <Input
              value={proxyUrl}
              onChange={(e) => {
                setProxyUrl(e.target.value);
                setProxySaved(false);
              }}
              onBlur={() => {
                const trimmed = proxyUrl.trim();
                if (trimmed && !isValidProxyUrl(trimmed)) {
                  setProxyUrl(account.proxy_url || "");
                  return;
                }
                if (trimmed !== (account.proxy_url || "")) {
                  setAccountProxy.mutate({
                    accountId: account.id,
                    proxyUrl: trimmed || null,
                  });
                  setProxySaved(true);
                  setTimeout(() => setProxySaved(false), 2000);
                }
              }}
              aria-label={t("cloud.card.proxy")}
              placeholder={t("cloud.card.proxyPlaceholder")}
              className="bg-muted/20 border-border/40 focus-visible:bg-background focus-visible:ring-primary/30 h-7 w-full rounded-md text-[11px] transition-all focus-visible:ring-1 pr-14"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
            />
            {proxySaved && (
              <span
                className="bg-background absolute top-1/2 right-2 -translate-y-1/2 rounded px-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 shadow-sm animate-in fade-in zoom-in-95 duration-150 select-none"
                role="status"
                aria-live="polite"
              >
                {t("cloud.card.proxySaved")}
              </span>
            )}
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

interface CompactCloudAccountCardProps {
  account: CloudAccount;
  quotaWindow?: QuotaWindow;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSwitch: (id: string, appTarget?: AntigravityAppTarget | "all") => void;
  onManageIdentity: (id: string) => void;
  isRefreshing?: boolean;
  isDeleting?: boolean;
  isSwitching?: boolean;
  switchingTarget?: AntigravityAppTarget | "all";
}

export function CompactCloudAccountCard({
  account,
  quotaWindow = "5h",
  onRefresh,
  onDelete,
  onSwitch,
  onManageIdentity,
  isRefreshing,
  isDeleting,
  isSwitching,
  switchingTarget,
}: CompactCloudAccountCardProps) {
  const { t } = useTranslation();
  const { config } = useAppConfig();
  const installedTargets = useInstalledTargets();
  const isCliActive = Boolean(account.is_active_cli || account.is_active_agy);
  const isAppActive = Boolean(
    account.is_active_app ||
    account.is_active_classic ||
    (!account.is_active_ide && !isCliActive && account.is_active),
  );
  const isAllActive = Boolean(
    isAppActive && account.is_active_ide && isCliActive,
  );

  const getQuotaBarColorClass = (percentage: number) => {
    const quotaStatus = getQuotaStatus(percentage);
    return QUOTA_BAR_COLOR_CLASS_BY_STATUS[quotaStatus];
  };

  const mergedModelQuotas = aggregateVisibleQuotaModelFamilies(
    account.quota?.models || {},
    config?.model_visibility || {},
  );

  const compactModels = Object.entries(mergedModelQuotas).sort(
    (a, b) => b[1].percentage - a[1].percentage,
  );
  const weeklyQuotaItems = selectWeeklyQuotaItems(account.quota?.quota_groups);

  const aiCredits = account.quota?.ai_credits;
  const shouldShowAiCredits =
    !!aiCredits && Number.isFinite(aiCredits.credits) && aiCredits.credits >= 0;

  const validationBlockedStatusLabel = getCloudAccountBlockedStatusLabel(
    account,
    t,
  );

  return (
    <div className="group bg-card hover:border-primary/40 flex items-center gap-3 rounded-lg border px-3 py-2 transition-all duration-200">
      <Avatar className="h-7 w-7 border">
        <AvatarImage
          src={account.avatar_url || undefined}
          alt={account.name || ""}
          referrerPolicy="no-referrer"
        />
        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
          {account.name?.[0]?.toUpperCase() || "A"}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {account.name || t("cloud.card.unknown")}
          </span>
          <Badge
            variant={
              account.status === "rate_limited" || account.status === "expired"
                ? "destructive"
                : "outline"
            }
            className="shrink-0 text-[10px]"
          >
            {account.provider.toUpperCase()}
          </Badge>
          <AccountTierBadge
            account={account}
            unknownLabel={t("cloud.tierFilter.unknown")}
            className="h-4 max-w-24 px-1 text-[9px]"
          />
        </div>

        <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <span className="truncate max-w-[140px]">{account.email}</span>
          <div className="flex flex-wrap items-center gap-1">
            {isAppActive && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="status"
                      aria-label={`${t("cloud.target.app")}: ${t("cloud.switch.activeBadge")}`}
                      className="rounded border border-green-500/25 bg-green-500/10 px-1 py-0.5 text-[9px] font-bold text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none cursor-default"
                    >
                      {t("cloud.target.appShort")}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    {t("cloud.target.app")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {account.is_active_ide && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="status"
                      aria-label={`${t("cloud.target.ide")}: ${t("cloud.switch.activeBadge")}`}
                      className="rounded border border-indigo-500/25 bg-indigo-500/10 px-1 py-0.5 text-[9px] font-bold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none cursor-default"
                    >
                      {t("cloud.target.ideShort")}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    {t("cloud.target.ide")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isCliActive && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="status"
                      aria-label={`${t("cloud.target.cli")}: ${t("cloud.switch.activeBadge")}`}
                      className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1 py-0.5 font-mono text-[9px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none cursor-default"
                    >
                      {t("cloud.target.cliShort")}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    {t("cloud.target.cli")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {validationBlockedStatusLabel && (
            <span className="text-destructive shrink-0 font-medium">
              {validationBlockedStatusLabel}
            </span>
          )}
          {account.health?.validation?.verification_url && (
            <button
              type="button"
              className="text-destructive inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
              onClick={() =>
                openAccountValidationLink({ accountId: account.id })
              }
            >
              <ExternalLink className="h-3 w-3" />
              {t("cloud.card.completeValidation")}
            </button>
          )}

          {shouldShowAiCredits && aiCredits && (
            <span className="shrink-0 text-blue-500">
              {t("cloud.card.aiCreditsValue", {
                amount: formatAiCreditsAmount(aiCredits.credits),
              })}
              {aiCredits.expiryDate && (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {t("cloud.card.creditsExpiry", {
                    date: formatCreditsExpiry(aiCredits.expiryDate),
                  })}
                </span>
              )}
            </span>
          )}
        </div>

        {quotaWindow === "weekly" ? (
          <WeeklyQuotaDisplay
            items={weeklyQuotaItems}
            hasQuotaSummary={account.quota?.quota_groups !== undefined}
            variant="compact"
          />
        ) : compactModels.length > 0 ? (
          <div className="mt-1 flex items-center gap-1">
            {compactModels.map(([modelName, info]) => (
              <TooltipProvider key={modelName}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-muted h-1.5 w-12 overflow-hidden rounded-full">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${getQuotaBarColorClass(info.percentage)}`}
                        style={{
                          width: `${clampQuotaPercentage(info.percentage)}%`,
                        }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {formatModelDisplayName(modelName)}: {info.percentage}%
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <div className="relative">
          <DropdownMenu>
            <div className="inline-flex items-center rounded-lg border border-border bg-background shadow-sm">
              {/* Primary 1-Click Action: Switch All Environments */}
              <Button
                variant="ghost"
                size="sm"
                disabled={isSwitching || isAllActive}
                onClick={() => onSwitch(account.id, "all")}
                className={cn(
                  "h-7 rounded-l-lg rounded-r-none border-r border-border px-2 text-[11px] font-semibold transition-colors",
                  isAllActive
                    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 cursor-default"
                    : "hover:bg-accent text-foreground",
                )}
              >
                {isSwitching &&
                (switchingTarget === "all" || !switchingTarget) ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : isAllActive ? (
                  <Check className="mr-1 h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Layers className="mr-1 h-3 w-3 text-primary" />
                )}
                <span>
                  {isAllActive
                    ? t("cloud.switch.activeAll")
                    : t("cloud.switch.targetAllShort")}
                </span>
              </Button>

              {/* Target Selection Trigger */}
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSwitching}
                  aria-label={t("cloud.switch.triggerAria", {
                    email: account.email,
                  })}
                  className="h-7 w-6 rounded-l-none rounded-r-lg px-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </div>

            <DropdownMenuContent
              align="end"
              className="w-64 min-w-[16rem] max-w-[calc(100vw-2rem)] p-1.5"
            >
              {/* Global Action Item */}
              <DropdownMenuItem
                disabled={isSwitching || isAllActive}
                onSelect={() => onSwitch(account.id, "all")}
                className="flex items-center justify-between font-medium cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <span>{t("cloud.switch.targetAll")}</span>
                </span>
                {isAllActive && (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                )}
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              <DropdownMenuLabel className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("cloud.switch.menuTitle")}
              </DropdownMenuLabel>

              {/* Target 1: Antigravity App */}
              <DropdownMenuItem
                disabled={isSwitching || isAppActive || !installedTargets.app}
                onSelect={() => onSwitch(account.id, "app")}
                className={cn(
                  "flex items-center justify-between cursor-pointer",
                  (!installedTargets.app || isAppActive) &&
                    "cursor-not-allowed opacity-60",
                )}
                title={
                  !installedTargets.app
                    ? t("status.tooltips.appNotInstalled")
                    : undefined
                }
              >
                <span className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-green-600" />
                  <span>{t("cloud.target.app")}</span>
                  {!installedTargets.app && (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                      title={t("status.tooltips.appNotInstalled")}
                    />
                  )}
                </span>
                {isSwitching &&
                (switchingTarget === "app" || switchingTarget === "classic") ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isAppActive ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : null}
              </DropdownMenuItem>

              {/* Target 2: Antigravity IDE */}
              <DropdownMenuItem
                disabled={
                  isSwitching || account.is_active_ide || !installedTargets.ide
                }
                onSelect={() => onSwitch(account.id, "ide")}
                className={cn(
                  "flex items-center justify-between cursor-pointer",
                  (!installedTargets.ide || account.is_active_ide) &&
                    "cursor-not-allowed opacity-60",
                )}
                title={
                  !installedTargets.ide
                    ? t("status.tooltips.ideNotInstalled")
                    : undefined
                }
              >
                <span className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-indigo-600" />
                  <span>{t("cloud.target.ide")}</span>
                  {!installedTargets.ide && (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                      title={t("status.tooltips.ideNotInstalled")}
                    />
                  )}
                </span>
                {isSwitching && switchingTarget === "ide" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : account.is_active_ide ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : null}
              </DropdownMenuItem>

              {/* Target 3: Antigravity CLI */}
              <DropdownMenuItem
                disabled={isSwitching || isCliActive || !installedTargets.cli}
                onSelect={() => onSwitch(account.id, "cli")}
                className={cn(
                  "flex items-center justify-between cursor-pointer min-h-[44px]",
                  (!installedTargets.cli || isCliActive) &&
                    "cursor-not-allowed opacity-60",
                )}
                title={
                  !installedTargets.cli
                    ? t("status.tooltips.cliNotInstalled")
                    : t("cloud.switch.cliHint")
                }
              >
                <span className="flex items-start gap-2">
                  <Terminal className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 font-mono text-sm leading-tight">
                      <span>{t("cloud.target.cli")}</span>
                      {!installedTargets.cli && (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                          title={t("status.tooltips.cliNotInstalled")}
                        />
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-normal font-sans">
                      {t("cloud.switch.cliHint")}
                    </span>
                  </div>
                </span>
                {isSwitching &&
                (switchingTarget === "cli" || switchingTarget === "agy") ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : isCliActive ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-pointer rounded-full"
            >
              <MoreVertical className="h-3.5 w-3.5" />
              <span className="sr-only">Menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("cloud.card.actions")}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onRefresh(account.id)}
              disabled={isRefreshing}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("cloud.card.refresh")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onManageIdentity(account.id)}>
              <Fingerprint className="mr-2 h-4 w-4" />
              {t("cloud.card.identityProfile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(account.id)}
              className="text-destructive focus:text-destructive"
              disabled={isDeleting}
            >
              <Trash className="mr-2 h-4 w-4" />
              {t("cloud.card.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
