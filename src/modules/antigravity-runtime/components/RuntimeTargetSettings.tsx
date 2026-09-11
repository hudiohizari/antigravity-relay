import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2, Search, Sparkles, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/shared/ui/utils";
import { useAppConfig } from "@/modules/config/hooks/useAppConfig";
import { AppConfig } from "@/modules/config/types";
import {
  getAntigravityArgs,
  selectAntigravityExecutable,
  detectAntigravityExecutable,
  detectAllAntigravityExecutables,
} from "@/modules/antigravity-runtime/actions/system";
import {
  RuntimeBatchConflictDialog,
  BatchConflictItem,
} from "@/modules/antigravity-runtime/components/RuntimeBatchConflictDialog";
import { RuntimeSingleConflictDialog } from "@/modules/antigravity-runtime/components/RuntimeSingleConflictDialog";

export type ActiveDetection = "app" | "ide" | "cli" | "all" | null;

export function sanitizeExecutablePath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed.length > 0 ? trimmed : null;
}

export function parseArgsInput(value: string): string[] {
  const args: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/gu;
  let match: RegExpExecArray | null = regex.exec(value);

  while (match !== null) {
    const matchedToken = match[1] ?? match[2] ?? match[0];
    if (matchedToken) {
      args.push(matchedToken);
    }
    match = regex.exec(value);
  }

  return args;
}

export function formatArgsDisplay(args: string[]): string {
  return args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");
}

export interface RuntimeTargetSettingsProps {
  config?: AppConfig;
  saveConfig?: (config: AppConfig) => Promise<void>;
}

export function RuntimeTargetSettings({
  config: propConfig,
  saveConfig: propSaveConfig,
}: RuntimeTargetSettingsProps = {}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const appConfigHook = useAppConfig();

  const config = propConfig ?? appConfigHook.config;
  const saveConfig = propSaveConfig ?? appConfigHook.saveConfig;

  const [appExecutable, setAppExecutable] = useState("");
  const [appArgs, setAppArgs] = useState("");
  const [isDetectingAppArgs, setIsDetectingAppArgs] = useState(false);

  const [ideExecutable, setIdeExecutable] = useState("");
  const [ideArgs, setIdeArgs] = useState("");
  const [isDetectingIdeArgs, setIsDetectingIdeArgs] = useState(false);

  const [cliExecutable, setCliExecutable] = useState("");

  const [activeDetection, setActiveDetection] = useState<ActiveDetection>(null);
  const [singleConflict, setSingleConflict] = useState<{
    target: "app" | "ide" | "cli";
    targetName: string;
    currentPath: string;
    detectedPath: string;
  } | null>(null);
  const [batchConflicts, setBatchConflicts] = useState<BatchConflictItem[]>([]);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");

  useEffect(() => {
    if (config) {
      setAppExecutable(config.antigravity_executable ?? "");
      setAppArgs(formatArgsDisplay(config.antigravity_args ?? []));
      setIdeExecutable(config.antigravity_ide_executable ?? "");
      setIdeArgs(formatArgsDisplay(config.antigravity_ide_args ?? []));
      setCliExecutable(config.antigravity_cli_executable ?? "");
    }
  }, [config]);

  const saveAppExecutable = async (rawValue: string) => {
    const sanitized = sanitizeExecutablePath(rawValue);
    setAppExecutable(sanitized ?? "");
    if (config) {
      await saveConfig({
        ...config,
        antigravity_executable: sanitized,
      });
    }
  };

  const handleBrowseApp = async () => {
    const selectedPath = await selectAntigravityExecutable("app");
    if (selectedPath) {
      await saveAppExecutable(selectedPath);
    }
  };

  const handleClearAppExecutable = async () => {
    await saveAppExecutable("");
  };

  const saveAppArgs = async (rawValue: string) => {
    const parsedArgs = parseArgsInput(rawValue);
    setAppArgs(formatArgsDisplay(parsedArgs));
    if (config) {
      await saveConfig({
        ...config,
        antigravity_args: parsedArgs,
      });
    }
  };

  const handleClearAppArgs = async () => {
    setAppArgs("");
    if (config) {
      await saveConfig({
        ...config,
        antigravity_args: [],
      });
    }
  };

  const handleDetectAppArgs = async () => {
    if (isDetectingAppArgs || activeDetection !== null) return;
    setIsDetectingAppArgs(true);
    try {
      const result = await getAntigravityArgs("app");
      const targetName = t("settings.runtimes.target_app");
      if (!result.running) {
        toast({
          title: t("settings.runtimes.toast.not_running_title"),
          description: t("settings.runtimes.toast.not_running_desc", {
            target: targetName,
          }),
        });
        return;
      }
      if (result.args.length === 0) {
        toast({
          title: t("settings.runtimes.toast.empty_title"),
          description: t("settings.runtimes.toast.empty_desc", {
            target: targetName,
          }),
        });
        return;
      }
      setAppArgs(formatArgsDisplay(result.args));
      if (config) {
        await saveConfig({
          ...config,
          antigravity_args: result.args,
        });
      }
      toast({
        title: t("settings.runtimes.toast.success_title"),
        description: t("settings.runtimes.toast.success_desc", {
          target: targetName,
        }),
      });
    } catch {
      toast({
        title: t("settings.runtimes.toast.error_title"),
        description: t("settings.runtimes.toast.error_desc", {
          target: t("settings.runtimes.target_app"),
        }),
        variant: "destructive",
      });
    } finally {
      setIsDetectingAppArgs(false);
    }
  };

  const saveIdeExecutable = async (rawValue: string) => {
    const sanitized = sanitizeExecutablePath(rawValue);
    setIdeExecutable(sanitized ?? "");
    if (config) {
      await saveConfig({
        ...config,
        antigravity_ide_executable: sanitized,
      });
    }
  };

  const handleBrowseIde = async () => {
    const selectedPath = await selectAntigravityExecutable("ide");
    if (selectedPath) {
      await saveIdeExecutable(selectedPath);
    }
  };

  const handleClearIdeExecutable = async () => {
    await saveIdeExecutable("");
  };

  const saveIdeArgs = async (rawValue: string) => {
    const parsedArgs = parseArgsInput(rawValue);
    setIdeArgs(formatArgsDisplay(parsedArgs));
    if (config) {
      await saveConfig({
        ...config,
        antigravity_ide_args: parsedArgs,
      });
    }
  };

  const handleClearIdeArgs = async () => {
    setIdeArgs("");
    if (config) {
      await saveConfig({
        ...config,
        antigravity_ide_args: [],
      });
    }
  };

  const handleDetectIdeArgs = async () => {
    if (isDetectingIdeArgs || activeDetection !== null) return;
    setIsDetectingIdeArgs(true);
    try {
      const result = await getAntigravityArgs("ide");
      const targetName = t("settings.runtimes.target_ide");
      if (!result.running) {
        toast({
          title: t("settings.runtimes.toast.not_running_title"),
          description: t("settings.runtimes.toast.not_running_desc", {
            target: targetName,
          }),
        });
        return;
      }
      if (result.args.length === 0) {
        toast({
          title: t("settings.runtimes.toast.empty_title"),
          description: t("settings.runtimes.toast.empty_desc", {
            target: targetName,
          }),
        });
        return;
      }
      setIdeArgs(formatArgsDisplay(result.args));
      if (config) {
        await saveConfig({
          ...config,
          antigravity_ide_args: result.args,
        });
      }
      toast({
        title: t("settings.runtimes.toast.success_title"),
        description: t("settings.runtimes.toast.success_desc", {
          target: targetName,
        }),
      });
    } catch {
      toast({
        title: t("settings.runtimes.toast.error_title"),
        description: t("settings.runtimes.toast.error_desc", {
          target: t("settings.runtimes.target_ide"),
        }),
        variant: "destructive",
      });
    } finally {
      setIsDetectingIdeArgs(false);
    }
  };

  const saveCliExecutable = async (rawValue: string) => {
    const sanitized = sanitizeExecutablePath(rawValue);
    setCliExecutable(sanitized ?? "");
    if (config) {
      await saveConfig({
        ...config,
        antigravity_cli_executable: sanitized,
      });
    }
  };

  const handleBrowseCli = async () => {
    const selectedPath = await selectAntigravityExecutable("cli");
    if (selectedPath) {
      await saveCliExecutable(selectedPath);
    }
  };

  const handleClearCliExecutable = async () => {
    await saveCliExecutable("");
  };

  // Row-level executable auto-detection handler
  const handleDetectExecutable = async (target: "app" | "ide" | "cli") => {
    if (activeDetection !== null) return;
    setActiveDetection(target);

    const targetName =
      target === "app"
        ? t("settings.runtimes.target_app")
        : target === "ide"
          ? t("settings.runtimes.target_ide")
          : t("settings.runtimes.target_cli");

    const currentPath = sanitizeExecutablePath(
      target === "app"
        ? appExecutable
        : target === "ide"
          ? ideExecutable
          : cliExecutable,
    );

    try {
      const result = await detectAntigravityExecutable({
        target,
        bypassConfig: true,
      });

      if (!result.detectedPath || result.status === "not_found") {
        const title = t("settings.runtimes.toast.exec_not_found_title");
        const desc = t("settings.runtimes.toast.exec_not_found_desc", {
          target: targetName,
        });
        toast({
          title,
          description: desc,
        });
        setStatusAnnouncement(`${title}: ${desc}`);
        return;
      }

      const detectedPath = result.detectedPath;

      // Detected matches current setting
      if (
        result.status === "already_set" ||
        result.alreadySet ||
        currentPath === detectedPath
      ) {
        const title = t("settings.runtimes.toast.exec_already_set_title");
        const desc = t("settings.runtimes.toast.exec_already_set_desc", {
          target: targetName,
        });
        toast({
          title,
          description: desc,
        });
        setStatusAnnouncement(`${title}: ${desc}`);
        return;
      }

      // Empty or non-existent path on disk: auto-populate and save immediately
      if (!currentPath || result.configuredPathExists === false) {
        if (target === "app") {
          setAppExecutable(detectedPath);
          if (config) {
            await saveConfig({
              ...config,
              antigravity_executable: detectedPath,
            });
          }
        } else if (target === "ide") {
          setIdeExecutable(detectedPath);
          if (config) {
            await saveConfig({
              ...config,
              antigravity_ide_executable: detectedPath,
            });
          }
        } else {
          setCliExecutable(detectedPath);
          if (config) {
            await saveConfig({
              ...config,
              antigravity_cli_executable: detectedPath,
            });
          }
        }

        const title = t("settings.runtimes.toast.exec_detected_title");
        const desc = t("settings.runtimes.toast.exec_detected_desc", {
          target: targetName,
          path: detectedPath,
        });
        toast({
          title,
          description: desc,
        });
        setStatusAnnouncement(`${title}: ${desc}`);
        return;
      }

      // Differing valid path on disk: prompt conflict dialog
      setSingleConflict({
        target,
        targetName,
        currentPath,
        detectedPath,
      });
    } catch {
      toast({
        title: t("settings.runtimes.toast.exec_not_found_title"),
        description: t("settings.runtimes.toast.exec_not_found_desc", {
          target: targetName,
        }),
        variant: "destructive",
      });
    } finally {
      setActiveDetection(null);
    }
  };

  const handleConfirmSingleConflict = async () => {
    if (!singleConflict) return;
    const { target, targetName, detectedPath } = singleConflict;

    if (target === "app") {
      setAppExecutable(detectedPath);
      if (config) {
        await saveConfig({
          ...config,
          antigravity_executable: detectedPath,
        });
      }
    } else if (target === "ide") {
      setIdeExecutable(detectedPath);
      if (config) {
        await saveConfig({
          ...config,
          antigravity_ide_executable: detectedPath,
        });
      }
    } else {
      setCliExecutable(detectedPath);
      if (config) {
        await saveConfig({
          ...config,
          antigravity_cli_executable: detectedPath,
        });
      }
    }

    const title = t("settings.runtimes.toast.exec_detected_title");
    const desc = t("settings.runtimes.toast.exec_detected_desc", {
      target: targetName,
      path: detectedPath,
    });
    toast({
      title,
      description: desc,
    });
    setStatusAnnouncement(`${title}: ${desc}`);
    setSingleConflict(null);
  };

  const handleDismissSingleConflict = () => {
    if (!singleConflict) return;
    const title = t("settings.runtimes.toast.exec_preserved_title");
    const desc = t("settings.runtimes.toast.exec_preserved_desc", {
      target: singleConflict.targetName,
    });
    toast({
      title,
      description: desc,
    });
    setStatusAnnouncement(`${title}: ${desc}`);
    setSingleConflict(null);
  };

  // Bulk Auto-Detect All runtimes handler
  const handleAutoDetectAll = async () => {
    if (activeDetection !== null) return;
    setActiveDetection("all");

    try {
      const results = await detectAllAntigravityExecutables({
        bypassConfig: true,
      });

      type ExecutableKey =
        | "antigravity_executable"
        | "antigravity_ide_executable"
        | "antigravity_cli_executable";

      const targets: Array<{
        key: "app" | "ide" | "cli";
        name: string;
        current: string | null;
        configKey: ExecutableKey;
      }> = [
        {
          key: "app",
          name: t("settings.runtimes.target_app"),
          current: sanitizeExecutablePath(appExecutable),
          configKey: "antigravity_executable",
        },
        {
          key: "ide",
          name: t("settings.runtimes.target_ide"),
          current: sanitizeExecutablePath(ideExecutable),
          configKey: "antigravity_ide_executable",
        },
        {
          key: "cli",
          name: t("settings.runtimes.target_cli"),
          current: sanitizeExecutablePath(cliExecutable),
          configKey: "antigravity_cli_executable",
        },
      ];

      const cleanUpdates: Partial<Record<ExecutableKey, string>> = {};
      const newConflicts: BatchConflictItem[] = [];
      let alreadySetCount = 0;
      let cleanAppliedCount = 0;

      for (const targetInfo of targets) {
        const result = results.find((r) => r.target === targetInfo.key);
        if (!result || !result.detectedPath || result.status === "not_found") {
          continue;
        }

        const detectedPath = result.detectedPath;
        const isAlreadySet =
          result.status === "already_set" ||
          result.alreadySet ||
          targetInfo.current === detectedPath;

        if (isAlreadySet) {
          alreadySetCount++;
          continue;
        }

        // Clean target: currently empty or non-existent file on disk
        if (!targetInfo.current || result.configuredPathExists === false) {
          cleanUpdates[targetInfo.configKey] = detectedPath;
          if (targetInfo.key === "app") {
            setAppExecutable(detectedPath);
          } else if (targetInfo.key === "ide") {
            setIdeExecutable(detectedPath);
          } else {
            setCliExecutable(detectedPath);
          }
          cleanAppliedCount++;
        } else {
          // Differing valid path on disk: queue for batch review
          newConflicts.push({
            targetKey: targetInfo.key,
            targetName: targetInfo.name,
            currentPath: targetInfo.current,
            detectedPath,
          });
        }
      }

      // Commit clean targets in a single atomic saveConfig transaction
      if (cleanAppliedCount > 0 && config) {
        await saveConfig({
          ...config,
          ...cleanUpdates,
        });
      }

      // If conflicting items exist, open batch review dialog
      if (newConflicts.length > 0) {
        setBatchConflicts(newConflicts);
        setStatusAnnouncement(
          `${t("settings.runtimes.dialog.batch_title")}: ${newConflicts.length}`,
        );
      } else {
        if (cleanAppliedCount > 0) {
          const title = t("settings.runtimes.toast.exec_bulk_summary_title");
          const desc = t("settings.runtimes.toast.exec_bulk_summary_desc", {
            count: cleanAppliedCount,
          });
          toast({
            title,
            description: desc,
          });
          setStatusAnnouncement(`${title}: ${desc}`);
        } else if (alreadySetCount > 0) {
          const title = t("settings.runtimes.toast.exec_bulk_summary_title");
          const desc = t("settings.runtimes.toast.exec_bulk_unchanged_desc");
          toast({
            title,
            description: desc,
          });
          setStatusAnnouncement(`${title}: ${desc}`);
        } else {
          const title = t("settings.runtimes.toast.exec_not_found_title");
          const desc = t("settings.runtimes.toast.exec_bulk_none_desc");
          toast({
            title,
            description: desc,
          });
          setStatusAnnouncement(`${title}: ${desc}`);
        }
      }
    } catch {
      toast({
        title: t("settings.runtimes.toast.exec_not_found_title"),
        description: t("settings.runtimes.toast.exec_bulk_none_desc"),
        variant: "destructive",
      });
    } finally {
      setActiveDetection(null);
    }
  };

  const handleConfirmBatchConflicts = async (
    selectedTargets: Array<"app" | "ide" | "cli">,
  ) => {
    if (selectedTargets.length === 0) {
      handleDismissBatchConflicts();
      return;
    }

    type ExecutableKey =
      | "antigravity_executable"
      | "antigravity_ide_executable"
      | "antigravity_cli_executable";

    const updates: Partial<Record<ExecutableKey, string>> = {};
    selectedTargets.forEach((targetKey) => {
      const item = batchConflicts.find((c) => c.targetKey === targetKey);
      if (!item) return;
      if (targetKey === "app") {
        setAppExecutable(item.detectedPath);
        updates.antigravity_executable = item.detectedPath;
      } else if (targetKey === "ide") {
        setIdeExecutable(item.detectedPath);
        updates.antigravity_ide_executable = item.detectedPath;
      } else if (targetKey === "cli") {
        setCliExecutable(item.detectedPath);
        updates.antigravity_cli_executable = item.detectedPath;
      }
    });

    if (config && Object.keys(updates).length > 0) {
      await saveConfig({
        ...config,
        ...updates,
      });
    }

    const title = t("settings.runtimes.toast.exec_bulk_summary_title");
    const desc = t("settings.runtimes.toast.exec_bulk_summary_desc", {
      count: selectedTargets.length,
    });
    toast({
      title,
      description: desc,
    });
    setStatusAnnouncement(`${title}: ${desc}`);
    setBatchConflicts([]);
  };

  const handleDismissBatchConflicts = () => {
    const title = t("settings.runtimes.toast.exec_preserved_title");
    const desc = t("settings.runtimes.toast.exec_preserved_desc", {
      target: batchConflicts.map((c) => c.targetName).join(", "),
    });
    toast({
      title,
      description: desc,
    });
    setStatusAnnouncement(`${title}: ${desc}`);
    setBatchConflicts([]);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <div className="space-y-1">
          <CardTitle>{t("settings.runtimes.title")}</CardTitle>
          <CardDescription>
            {t("settings.runtimes.description")}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={activeDetection !== null}
          aria-busy={activeDetection === "all"}
          aria-label={t("settings.runtimes.auto_detect_all_aria")}
          onClick={handleAutoDetectAll}
          className="w-full sm:w-auto h-9 px-3 gap-1.5 shrink-0 font-medium text-xs sm:text-sm"
        >
          {activeDetection === "all" ? (
            <>
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <span>{t("settings.runtimes.detecting")}</span>
            </>
          ) : (
            <>
              <Sparkles
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <span>{t("settings.runtimes.auto_detect_all")}</span>
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Antigravity App (Classic Desktop) */}
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("settings.runtimes.app.title")}
            </h3>
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="antigravity-app-executable">
                {t("settings.runtimes.app.executable")}
              </Label>
              <p
                id="antigravity-app-executable-desc"
                className="text-muted-foreground text-xs"
              >
                {t("settings.runtimes.app.executable_desc")}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="antigravity-app-executable"
                aria-describedby="antigravity-app-executable-desc"
                value={appExecutable}
                placeholder={t("settings.runtimes.app.executable_placeholder")}
                onChange={(event) => setAppExecutable(event.target.value)}
                onBlur={() => saveAppExecutable(appExecutable)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveAppExecutable(appExecutable);
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 font-mono text-sm h-9"
              />
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={activeDetection !== null}
                  aria-busy={activeDetection === "app"}
                  aria-label={t("settings.runtimes.app.detect_exec_aria")}
                  onClick={() => handleDetectExecutable("app")}
                  className="h-9 px-3 gap-1.5 shrink-0 font-medium text-xs sm:text-sm"
                >
                  {activeDetection === "app" ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detecting")}</span>
                    </>
                  ) : (
                    <>
                      <Search
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detect_exec")}</span>
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("settings.runtimes.app.browse_aria")}
                  onClick={handleBrowseApp}
                  className="h-9 w-9 shrink-0"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
                {Boolean(appExecutable) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("settings.runtimes.app.clear_path_aria")}
                    onClick={handleClearAppExecutable}
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="antigravity-app-args">
                {t("settings.runtimes.app.args")}
              </Label>
              <p
                id="antigravity-app-args-desc"
                className="text-muted-foreground text-xs"
              >
                {t("settings.runtimes.app.args_desc")}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="antigravity-app-args"
                aria-describedby="antigravity-app-args-desc"
                value={appArgs}
                placeholder={t("settings.runtimes.app.args_placeholder")}
                onChange={(event) => setAppArgs(event.target.value)}
                onBlur={() => saveAppArgs(appArgs)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveAppArgs(appArgs);
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 font-mono text-sm h-9"
              />
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDetectingAppArgs || activeDetection !== null}
                  aria-busy={isDetectingAppArgs}
                  aria-label={t("settings.runtimes.app.detect_args_aria")}
                  onClick={handleDetectAppArgs}
                  className={cn(
                    "h-9 px-3 gap-1.5 shrink-0 transition-all font-medium text-xs sm:text-sm",
                    isDetectingAppArgs && "cursor-wait opacity-80",
                  )}
                >
                  {isDetectingAppArgs ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detecting")}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detect")}</span>
                    </>
                  )}
                </Button>
                {Boolean(appArgs) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("settings.runtimes.app.clear_args_aria")}
                    onClick={handleClearAppArgs}
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <hr className="border-border" />

        {/* Antigravity IDE */}
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("settings.runtimes.ide.title")}
            </h3>
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="antigravity-ide-executable">
                {t("settings.runtimes.ide.executable")}
              </Label>
              <p
                id="antigravity-ide-executable-desc"
                className="text-muted-foreground text-xs"
              >
                {t("settings.runtimes.ide.executable_desc")}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="antigravity-ide-executable"
                aria-describedby="antigravity-ide-executable-desc"
                value={ideExecutable}
                placeholder={t("settings.runtimes.ide.executable_placeholder")}
                onChange={(event) => setIdeExecutable(event.target.value)}
                onBlur={() => saveIdeExecutable(ideExecutable)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveIdeExecutable(ideExecutable);
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 font-mono text-sm h-9"
              />
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={activeDetection !== null}
                  aria-busy={activeDetection === "ide"}
                  aria-label={t("settings.runtimes.ide.detect_exec_aria")}
                  onClick={() => handleDetectExecutable("ide")}
                  className="h-9 px-3 gap-1.5 shrink-0 font-medium text-xs sm:text-sm"
                >
                  {activeDetection === "ide" ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detecting")}</span>
                    </>
                  ) : (
                    <>
                      <Search
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detect_exec")}</span>
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("settings.runtimes.ide.browse_aria")}
                  onClick={handleBrowseIde}
                  className="h-9 w-9 shrink-0"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
                {Boolean(ideExecutable) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("settings.runtimes.ide.clear_path_aria")}
                    onClick={handleClearIdeExecutable}
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="antigravity-ide-args">
                {t("settings.runtimes.ide.args")}
              </Label>
              <p
                id="antigravity-ide-args-desc"
                className="text-muted-foreground text-xs"
              >
                {t("settings.runtimes.ide.args_desc")}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="antigravity-ide-args"
                aria-describedby="antigravity-ide-args-desc"
                value={ideArgs}
                placeholder={t("settings.runtimes.ide.args_placeholder")}
                onChange={(event) => setIdeArgs(event.target.value)}
                onBlur={() => saveIdeArgs(ideArgs)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveIdeArgs(ideArgs);
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 font-mono text-sm h-9"
              />
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDetectingIdeArgs || activeDetection !== null}
                  aria-busy={isDetectingIdeArgs}
                  aria-label={t("settings.runtimes.ide.detect_args_aria")}
                  onClick={handleDetectIdeArgs}
                  className={cn(
                    "h-9 px-3 gap-1.5 shrink-0 transition-all font-medium text-xs sm:text-sm",
                    isDetectingIdeArgs && "cursor-wait opacity-80",
                  )}
                >
                  {isDetectingIdeArgs ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detecting")}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detect")}</span>
                    </>
                  )}
                </Button>
                {Boolean(ideArgs) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("settings.runtimes.ide.clear_args_aria")}
                    onClick={handleClearIdeArgs}
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <hr className="border-border" />

        {/* Antigravity CLI (agy) */}
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("settings.runtimes.cli.title")}
            </h3>
          </div>

          <div className="space-y-2 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="antigravity-cli-executable">
                {t("settings.runtimes.cli.executable")}
              </Label>
              <p
                id="antigravity-cli-executable-desc"
                className="text-muted-foreground text-xs"
              >
                {t("settings.runtimes.cli.executable_desc")}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="antigravity-cli-executable"
                aria-describedby="antigravity-cli-executable-desc"
                value={cliExecutable}
                placeholder={t("settings.runtimes.cli.executable_placeholder")}
                onChange={(event) => setCliExecutable(event.target.value)}
                onBlur={() => saveCliExecutable(cliExecutable)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveCliExecutable(cliExecutable);
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 font-mono text-sm h-9"
              />
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={activeDetection !== null}
                  aria-busy={activeDetection === "cli"}
                  aria-label={t("settings.runtimes.cli.detect_exec_aria")}
                  onClick={() => handleDetectExecutable("cli")}
                  className="h-9 px-3 gap-1.5 shrink-0 font-medium text-xs sm:text-sm"
                >
                  {activeDetection === "cli" ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detecting")}</span>
                    </>
                  ) : (
                    <>
                      <Search
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{t("settings.runtimes.detect_exec")}</span>
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("settings.runtimes.cli.browse_aria")}
                  onClick={handleBrowseCli}
                  className="h-9 w-9 shrink-0"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
                {Boolean(cliExecutable) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("settings.runtimes.cli.clear_path_aria")}
                    onClick={handleClearCliExecutable}
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>

      {/* Screen reader live announcements */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </span>

      {/* Single target conflict resolution dialog */}
      {singleConflict && (
        <RuntimeSingleConflictDialog
          open={Boolean(singleConflict)}
          targetName={singleConflict.targetName}
          currentPath={singleConflict.currentPath}
          detectedPath={singleConflict.detectedPath}
          onConfirm={handleConfirmSingleConflict}
          onDismiss={handleDismissSingleConflict}
        />
      )}

      {/* Unified batch conflict resolution dialog */}
      {batchConflicts.length > 0 && (
        <RuntimeBatchConflictDialog
          open={batchConflicts.length > 0}
          conflicts={batchConflicts}
          onConfirm={handleConfirmBatchConflicts}
          onDismiss={handleDismissBatchConflicts}
        />
      )}
    </Card>
  );
}
