import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2, Sparkles, X } from "lucide-react";
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
} from "@/modules/antigravity-runtime/actions/system";

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
    if (isDetectingAppArgs) return;
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
    if (isDetectingIdeArgs) return;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.runtimes.title")}</CardTitle>
        <CardDescription>{t("settings.runtimes.description")}</CardDescription>
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
              <div className="flex items-center gap-2 shrink-0">
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
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDetectingAppArgs}
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
              <div className="flex items-center gap-2 shrink-0">
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
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDetectingIdeArgs}
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
              <div className="flex items-center gap-2 shrink-0">
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
    </Card>
  );
}
