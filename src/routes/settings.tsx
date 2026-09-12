import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";
import { useTheme } from "@/components/shared/theme-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CommitOnBlurNumberInput, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import {
  checkForUpdates,
  getAppVersion,
  getPlatform,
} from "@/modules/app-shell/actions/app";
import { useTranslation } from "react-i18next";
import { setAppLanguage } from "@/modules/app-shell/actions/language";
import { useAppConfig } from "@/modules/config/hooks/useAppConfig";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen, RefreshCw, Zap } from "lucide-react";
import { ModelVisibilitySettings } from "@/modules/config/components/ModelVisibilitySettings";
import { AutoSwitchModelSettings } from "@/modules/cloud-account/components/AutoSwitchModelSettings";
import { WeeklyWarmupSettings } from "@/modules/cloud-account/components/WeeklyWarmupSettings";
import { useEffect, useState } from "react";
import { openLogDirectory } from "@/modules/antigravity-runtime/actions/system";
import { AntigravityClientCacheSettings } from "@/modules/antigravity-runtime/components/AntigravityClientCacheSettings";
import { RuntimeTargetSettings } from "@/modules/antigravity-runtime/components/RuntimeTargetSettings";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const { config, isLoading, saveConfig, isSaving } = useAppConfig();
  const { toast } = useToast();

  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  const { data: appVersion } = useQuery({
    queryKey: ["app", "version"],
    queryFn: getAppVersion,
  });

  const { data: platform } = useQuery({
    queryKey: ["app", "platform"],
    queryFn: getPlatform,
  });

  const isAutoStartSupported =
    platform === "win32" || platform === "darwin" || platform === "linux";
  const isMac = platform === "darwin";
  const supportsManualUpdateCheck =
    platform === "win32" || platform === "darwin" || platform === "linux";

  const handleLanguageChange = (value: string) => {
    setAppLanguage(value, i18n);
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      const result = await checkForUpdates();
      if (result.status === "up-to-date") {
        toast({
          title: t("update.upToDate"),
        });
      } else if (result.status === "unsupported") {
        toast({
          title: t("update.unsupported"),
        });
      } else if (result.status === "error") {
        toast({
          title: t("update.checkFailed"),
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: t("update.checkFailed"),
        description:
          error instanceof Error ? error.message : t("common.unknown"),
        variant: "destructive",
      });
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  if (isLoading || !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          {t("settings.title")}
        </h2>
        <p className="text-muted-foreground mt-1">
          {t("settings.description")}
        </p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="general">{t("settings.general")}</TabsTrigger>
          <TabsTrigger value="models">{t("settings.models")}</TabsTrigger>
        </TabsList>

        {/* --- GENERAL TAB --- */}
        <TabsContent value="general" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.appearance.title")}</CardTitle>
              <CardDescription>
                {t("settings.appearance.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1">
                  <Label htmlFor="dark-mode">{t("settings.darkMode")}</Label>
                  <p className="text-muted-foreground text-sm">
                    {t("settings.darkModeDescription")}
                  </p>
                </div>
                <Switch
                  id="dark-mode"
                  checked={theme === "dark"}
                  onCheckedChange={(checked) =>
                    setTheme(checked ? "dark" : "light")
                  }
                />
              </div>

              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1">
                  <Label htmlFor="language">
                    {t("settings.language.title")}
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    {t("settings.language.description")}
                  </p>
                </div>
                <Select
                  value={i18n.language}
                  onValueChange={handleLanguageChange}
                  key={i18n.language}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t("settings.language.title")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">
                      {t("settings.language.english")}
                    </SelectItem>
                    <SelectItem value="id">
                      {t("settings.language.indonesian")}
                    </SelectItem>
                    <SelectItem value="zh-CN">
                      {t("settings.language.chinese")}
                    </SelectItem>
                    <SelectItem value="ru">
                      {t("settings.language.russian")}
                    </SelectItem>
                    <SelectItem value="vi">
                      {t("settings.language.vietnamese")}
                    </SelectItem>
                    <SelectItem value="tr">
                      {t("settings.language.turkish")}
                    </SelectItem>
                    <SelectItem value="fr">
                      {t("settings.language.french")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Account Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.account.title")}</CardTitle>
              <CardDescription>
                {t("settings.account.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto Refresh Quota */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <Label>{t("settings.account.auto_refresh")}</Label>
                  <p className="text-xs text-gray-500">
                    {t("settings.account.auto_refresh_desc")}
                  </p>
                </div>
                <Switch
                  checked={config?.auto_refresh || false}
                  onCheckedChange={async (checked) => {
                    if (config) {
                      await saveConfig({ ...config, auto_refresh: checked });
                    }
                  }}
                />
              </div>

              {/* Auto Sync Account */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <Label>{t("settings.account.auto_sync")}</Label>
                  <p className="text-xs text-gray-500">
                    {t("settings.account.auto_sync_desc")}
                  </p>
                </div>
                <Switch
                  checked={config?.auto_sync || false}
                  onCheckedChange={async (checked) => {
                    if (config) {
                      await saveConfig({ ...config, auto_sync: checked });
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Automation & Switching Card */}
          <Card className="border border-border bg-card">
            <CardHeader className="space-y-1 pb-4">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-lg font-semibold tracking-tight">
                  {t("settings.automation.title")}
                </CardTitle>
              </div>
              <CardDescription className="text-sm text-muted-foreground">
                {t("settings.automation.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                role="group"
                aria-labelledby="auto-resume-chat-label"
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-muted-foreground/30"
              >
                <div className="space-y-1.5 min-w-0 flex-1 pr-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label
                      id="auto-resume-chat-label"
                      htmlFor="auto-resume-chat-switch"
                      className="text-sm font-medium text-foreground cursor-pointer"
                    >
                      {t("settings.automation.autoResumeChat.title")}
                    </Label>
                    <Badge
                      variant="outline"
                      className="rounded-full border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] font-mono font-medium text-muted-foreground tracking-wide select-none"
                      aria-label="Scope: Desktop App and IDE only. CLI excluded."
                    >
                      {t("settings.automation.autoResumeChat.cliExcludedBadge")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("settings.automation.autoResumeChat.description")}
                  </p>
                </div>

                <div className="flex items-center shrink-0 self-end sm:self-center">
                  <Switch
                    id="auto-resume-chat-switch"
                    checked={config?.auto_resume_active_chat ?? true}
                    disabled={isSaving}
                    onCheckedChange={async (checked) => {
                      if (config) {
                        await saveConfig({
                          ...config,
                          auto_resume_active_chat: checked,
                        });
                      }
                    }}
                    aria-describedby="auto-resume-chat-label"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Environment Runtimes Card */}
          <RuntimeTargetSettings config={config} saveConfig={saveConfig} />

          {isAutoStartSupported && (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.startup.title")}</CardTitle>
                <CardDescription>
                  {t("settings.startup.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label>{t("settings.startup.auto_startup")}</Label>
                    <p className="text-xs text-gray-500">
                      {t("settings.startup.auto_startup_desc")}
                    </p>
                  </div>
                  <Switch
                    checked={config?.auto_startup || false}
                    onCheckedChange={async (checked) => {
                      if (config) {
                        await saveConfig({ ...config, auto_startup: checked });
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label>{t("settings.startup.start_in_tray")}</Label>
                    <p className="text-xs text-gray-500">
                      {t("settings.startup.start_in_tray_desc")}
                    </p>
                  </div>
                  <Switch
                    checked={config?.start_in_tray || false}
                    disabled={!config?.auto_startup}
                    onCheckedChange={async (checked) => {
                      if (config) {
                        await saveConfig({ ...config, start_in_tray: checked });
                      }
                    }}
                  />
                </div>
                {isMac && (
                  <p className="text-muted-foreground text-xs">
                    {t("settings.startup.macos_hint")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <AntigravityClientCacheSettings />

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.about.title")}</CardTitle>
              <CardDescription>
                {t("settings.about.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-muted-foreground">
                  {t("settings.version")}
                </div>
                <div className="font-medium">
                  {appVersion || t("common.unknown")}
                </div>

                <div className="text-muted-foreground">
                  {t("settings.platform")}
                </div>
                <div className="font-medium capitalize">
                  {platform || t("common.unknown")}
                </div>

                <div className="text-muted-foreground">
                  {t("settings.license")}
                </div>
                <div className="font-medium">CC BY-NC-SA 4.0</div>

                {supportsManualUpdateCheck && (
                  <>
                    <div className="text-muted-foreground">
                      {t("update.title")}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      disabled={isCheckingUpdates}
                      onClick={handleCheckForUpdates}
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${isCheckingUpdates ? "animate-spin" : ""}`}
                      />
                      {isCheckingUpdates
                        ? t("update.checking")
                        : t("update.checkNow")}
                    </Button>
                  </>
                )}

                <div className="text-muted-foreground">
                  {t("action.openLogs")}
                </div>
                <button
                  onClick={() => openLogDirectory()}
                  className="flex items-center gap-2 font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span>{t("settings.openLogDir")}</span>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Notifications Card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.notifications.title")}</CardTitle>
              <CardDescription>
                {t("settings.notifications.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <Label>{t("settings.notifications.quotaAlert")}</Label>
                  <p className="text-xs text-gray-500">
                    {t("settings.notifications.quotaAlertDesc")}
                  </p>
                </div>
                <Switch
                  checked={config?.quota_alert_enabled || false}
                  onCheckedChange={async (checked) => {
                    if (config) {
                      try {
                        await saveConfig({
                          ...config,
                          quota_alert_enabled: checked,
                        });
                      } catch {
                        toast({
                          title: t("common.error"),
                          description: t("settings.notifications.saveFailed"),
                          variant: "destructive",
                        });
                      }
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <Label>{t("settings.notifications.quotaThreshold")}</Label>
                  <p className="text-xs text-gray-500">
                    {t("settings.notifications.quotaThresholdDesc")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CommitOnBlurNumberInput
                    min={0}
                    max={100}
                    value={config?.quota_alert_threshold ?? 20}
                    onCommit={async (rawValue) => {
                      const parsed = parseInt(rawValue, 10);
                      if (isNaN(parsed) || parsed < 0 || parsed > 100) return;

                      if (config) {
                        try {
                          await saveConfig({
                            ...config,
                            quota_alert_threshold: parsed,
                          });
                        } catch {
                          toast({
                            title: t("common.error"),
                            description: t(
                              "settings.notifications.thresholdSaveFailed",
                            ),
                            variant: "destructive",
                          });
                        }
                      }
                    }}
                    className="w-16 rounded-md border bg-transparent px-2 py-1 text-center text-sm"
                  />
                  <span className="text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <Label>{t("settings.notifications.aiCreditsAlert")}</Label>
                  <p className="text-xs text-gray-500">
                    {t("settings.notifications.aiCreditsAlertDesc")}
                  </p>
                </div>
                <Switch
                  checked={config?.ai_credits_alert_enabled || false}
                  onCheckedChange={async (checked) => {
                    if (config) {
                      try {
                        await saveConfig({
                          ...config,
                          ai_credits_alert_enabled: checked,
                        });
                      } catch {
                        toast({
                          title: t("common.error"),
                          description: t("settings.notifications.saveFailed"),
                          variant: "destructive",
                        });
                      }
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <Label>
                    {t("settings.notifications.aiCreditsThreshold")}
                  </Label>
                  <p className="text-xs text-gray-500">
                    {t("settings.notifications.aiCreditsThresholdDesc")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CommitOnBlurNumberInput
                    min={0}
                    value={config?.ai_credits_alert_threshold ?? 5000}
                    onCommit={async (rawValue) => {
                      const parsed = parseInt(rawValue, 10);
                      if (isNaN(parsed) || parsed < 0) return;

                      if (config) {
                        try {
                          await saveConfig({
                            ...config,
                            ai_credits_alert_threshold: parsed,
                          });
                        } catch {
                          toast({
                            title: t("common.error"),
                            description: t(
                              "settings.notifications.aiCreditsThresholdSaveFailed",
                            ),
                            variant: "destructive",
                          });
                        }
                      }
                    }}
                    className="w-24 rounded-md border bg-transparent px-2 py-1 text-center text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- MODELS TAB --- */}
        <TabsContent value="models" className="space-y-5">
          <ModelVisibilitySettings />
          <AutoSwitchModelSettings />
          <WeeklyWarmupSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  errorComponent: RouteErrorFallback,
});
