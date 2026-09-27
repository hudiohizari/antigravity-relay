import { useState, useRef, useCallback } from "react";
import {
  Loader2,
  MessageSquareX,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Database,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/shared/ui/utils";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  cleanInvalidChats,
  getInvalidChatsStats,
} from "@/modules/antigravity-runtime/actions/conversationCleaner";
import type { InvalidChatsStats } from "@/modules/antigravity-runtime/conversation/types";
import { ProjectGroupAccordion } from "@/modules/antigravity-runtime/components/ProjectGroupAccordion";

const TARGETS: { id: AntigravityAppTarget; labelKey: string }[] = [
  { id: "app", labelKey: "settings.conversationCleaner.targetApp" },
  { id: "ide", labelKey: "settings.conversationCleaner.targetIde" },
  { id: "cli", labelKey: "settings.conversationCleaner.targetCli" },
];

function StatsSummaryBar({ stats }: { stats: InvalidChatsStats }) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-center dark:bg-muted/20">
      <div>
        <div className="text-xs text-muted-foreground">
          {t("settings.conversationCleaner.totalLabel")}
        </div>
        <div className="text-lg font-semibold text-foreground">
          {stats.totalChats}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">
          {t("settings.conversationCleaner.validLabel")}
        </div>
        <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
          {stats.validChats}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">
          {t("settings.conversationCleaner.invalidLabel")}
        </div>
        <div className="text-lg font-semibold text-rose-600 dark:text-rose-400">
          {stats.invalidChats}
        </div>
      </div>
    </div>
  );
}

export function AntigravityConversationCleanerSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] =
    useState<AntigravityAppTarget>("app");
  const [stats, setStats] = useState<InvalidChatsStats | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isPruning, setIsPruning] = useState(false);

  const scanSequenceRef = useRef(0);

  const handleScan = useCallback(async (target: AntigravityAppTarget) => {
    const currentSeq = ++scanSequenceRef.current;
    setIsScanning(true);
    try {
      const result = await getInvalidChatsStats(target);
      if (scanSequenceRef.current !== currentSeq) {
        return;
      }
      setStats(result);
    } catch (err) {
      if (scanSequenceRef.current !== currentSeq) {
        return;
      }
      setStats({
        target,
        summariesDbPath: "",
        exists: true,
        totalChats: 0,
        invalidChats: 0,
        validChats: 0,
        projectGroups: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (scanSequenceRef.current === currentSeq) {
        setIsScanning(false);
      }
    }
  }, []);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
    void handleScan(selectedTarget);
  };

  const handleTargetChange = (target: AntigravityAppTarget) => {
    if (target === selectedTarget) {
      return;
    }
    setSelectedTarget(target);
    void handleScan(target);
  };

  const handleCleanChats = async () => {
    setIsPruning(true);
    try {
      const result = await cleanInvalidChats(selectedTarget);
      if (result.prunedCount > 0) {
        toast({
          title: t("settings.conversationCleaner.successTitle"),
          description: t("settings.conversationCleaner.successDescription", {
            count: result.prunedCount,
          }),
        });
      } else if (result.errors.length > 0) {
        toast({
          title: t("settings.conversationCleaner.failedTitle"),
          description: result.errors.join("; "),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("settings.conversationCleaner.successTitle"),
          description: t("settings.conversationCleaner.noInvalidChats"),
        });
      }
      await handleScan(selectedTarget);
    } catch (error) {
      toast({
        title: t("settings.conversationCleaner.failedTitle"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsPruning(false);
    }
  };

  const isPurgeDisabled =
    isPruning ||
    isScanning ||
    !stats ||
    !stats.exists ||
    Boolean(stats.error) ||
    stats.invalidChats === 0;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.conversationCleaner.title")}</CardTitle>
          <CardDescription>
            {t("settings.conversationCleaner.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            disabled={isScanning}
            onClick={handleOpenDialog}
          >
            {isScanning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageSquareX className="mr-2 h-4 w-4" />
            )}
            {t("settings.conversationCleaner.scanAndClean")}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!isPruning) {
            setIsDialogOpen(open);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          {/* Pinned Sticky Header (shrink-0) */}
          <div className="shrink-0 border-b border-border/60 bg-card p-5 pb-4 sm:p-6">
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle>
                {t("settings.conversationCleaner.dialogTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.conversationCleaner.dialogDescription")}
              </DialogDescription>
            </DialogHeader>

            {/* Segmented Target Toggle */}
            <div className="mt-4">
              <div
                role="tablist"
                aria-label={t("settings.conversationCleaner.targetToggleLabel")}
                className="grid grid-cols-3 gap-1 rounded-lg border border-border/50 bg-muted/50 p-1 dark:bg-muted/20"
              >
                {TARGETS.map(({ id, labelKey }) => {
                  const isSelected = selectedTarget === id;
                  return (
                    <button
                      key={id}
                      role="tab"
                      type="button"
                      disabled={isPruning}
                      aria-selected={isSelected}
                      onClick={() => handleTargetChange(id)}
                      className={cn(
                        "flex min-h-[30px] items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
                        isSelected
                          ? "bg-background font-semibold text-foreground shadow-xs dark:bg-card dark:text-foreground"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{t(labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Independently Scrollable Body (flex-1 overflow-y-auto min-h-0) */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
            {/* State 1: Scanning State */}
            {isScanning && (
              <div
                className="space-y-3 py-2"
                data-testid="cleaner-skeleton-loader"
                role="status"
                aria-live="polite"
                aria-label={t("settings.conversationCleaner.scanningAria")}
              >
                <div className="h-16 w-full animate-pulse rounded-lg bg-muted/60" />
                <div className="h-12 w-full animate-pulse rounded-lg bg-muted/40" />
                <div className="h-24 w-full animate-pulse rounded-lg bg-muted/30" />
              </div>
            )}

            {/* State 5: Inline Recoverable Error State */}
            {!isScanning && stats?.error && (
              <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <div className="flex items-center space-x-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>{t("settings.conversationCleaner.errorTitle")}</span>
                </div>
                <p className="break-words text-xs text-muted-foreground">
                  {stats.error}
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleScan(selectedTarget)}
                    className="h-8 text-xs"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {t("settings.conversationCleaner.retry")}
                  </Button>
                </div>
              </div>
            )}

            {/* State 4: Missing Database Notice */}
            {!isScanning && !stats?.error && stats?.exists === false && (
              <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
                <Database className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="font-medium text-foreground">
                  {t("settings.conversationCleaner.notFoundTitle")}
                </p>
                <p className="text-xs">
                  {t("settings.conversationCleaner.notFoundDescription")}
                </p>
                {stats.summariesDbPath ? (
                  <p
                    className="mx-auto max-w-sm break-all font-mono text-xs opacity-75"
                    title={stats.summariesDbPath}
                  >
                    {stats.summariesDbPath}
                  </p>
                ) : null}
              </div>
            )}

            {/* State 3: Healthy Zero-State */}
            {!isScanning &&
              !stats?.error &&
              stats?.exists &&
              stats.invalidChats === 0 && (
                <div className="space-y-4">
                  <StatsSummaryBar stats={stats} />
                  <div className="flex items-center space-x-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                    <div>
                      <span className="block font-medium">
                        {t("settings.conversationCleaner.noInvalidChats")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("settings.conversationCleaner.zeroStateSubtext")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

            {/* State 2: Populated Grouped Breakdown State */}
            {!isScanning &&
              !stats?.error &&
              stats?.exists &&
              stats.invalidChats > 0 && (
                <div className="space-y-3.5">
                  <StatsSummaryBar stats={stats} />
                  <div className="flex items-start space-x-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>
                      {t("settings.conversationCleaner.hasInvalidChats", {
                        count: stats.invalidChats,
                      })}
                    </span>
                  </div>
                  <ProjectGroupAccordion
                    key={selectedTarget}
                    groups={stats.projectGroups}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("settings.conversationCleaner.warning")}
                  </p>
                </div>
              )}
          </div>

          {/* Pinned Sticky Footer (shrink-0) */}
          <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-muted/30 p-4 sm:flex-row sm:justify-end sm:space-x-2 sm:gap-0 sm:px-6 dark:bg-card">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPruning}>
                {t("settings.conversationCleaner.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={isPurgeDisabled}
              onClick={handleCleanChats}
            >
              {isPruning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isPruning
                ? t("settings.conversationCleaner.pruning")
                : t("settings.conversationCleaner.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
