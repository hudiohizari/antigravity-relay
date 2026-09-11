import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/ui/utils";

export interface BatchConflictItem {
  targetKey: "app" | "ide" | "cli";
  targetName: string;
  currentPath: string;
  detectedPath: string;
}

export interface RuntimeBatchConflictDialogProps {
  open: boolean;
  conflicts: BatchConflictItem[];
  onConfirm: (selectedTargets: Array<"app" | "ide" | "cli">) => void;
  onDismiss: () => void;
}

export function RuntimeBatchConflictDialog({
  open,
  conflicts,
  onConfirm,
  onDismiss,
}: RuntimeBatchConflictDialogProps) {
  const { t } = useTranslation();
  const [selectedTargets, setSelectedTargets] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (open && conflicts.length > 0) {
      const initial: Record<string, boolean> = {};
      conflicts.forEach((item) => {
        initial[item.targetKey] = true;
      });
      setSelectedTargets(initial);
    }
  }, [open, conflicts]);

  const selectedCount = Object.values(selectedTargets).filter(Boolean).length;
  const allSelected =
    conflicts.length > 0 && selectedCount === conflicts.length;

  const handleToggleAll = () => {
    const nextState = !allSelected;
    const updated: Record<string, boolean> = {};
    conflicts.forEach((item) => {
      updated[item.targetKey] = nextState;
    });
    setSelectedTargets(updated);
  };

  const handleToggleRow = (targetKey: string) => {
    setSelectedTargets((prev) => ({
      ...prev,
      [targetKey]: !prev[targetKey],
    }));
  };

  const handleReplaceSelected = () => {
    const approved = conflicts
      .filter((c) => selectedTargets[c.targetKey])
      .map((c) => c.targetKey);
    onConfirm(approved);
  };

  const handleReplaceAll = () => {
    onConfirm(conflicts.map((c) => c.targetKey));
  };

  const selectAllLabel = t("accounts.batch.selectAll") || "Select All";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold">
              {t("settings.runtimes.dialog.batch_title")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {t("settings.runtimes.dialog.batch_desc")}
          </DialogDescription>
        </DialogHeader>

        {/* Master Select All Toggle */}
        <div className="flex items-center justify-between border-b pb-2 pt-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="batch-select-all"
              checked={allSelected}
              onCheckedChange={handleToggleAll}
              aria-label={selectAllLabel}
            />
            <label
              htmlFor="batch-select-all"
              className="text-xs font-medium cursor-pointer select-none"
            >
              {selectAllLabel}
            </label>
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedCount} / {conflicts.length} selected
          </span>
        </div>

        {/* Conflicting Items Review List */}
        <div className="space-y-3 py-2">
          {conflicts.map((item) => {
            const isChecked = Boolean(selectedTargets[item.targetKey]);
            return (
              <div
                key={item.targetKey}
                className={cn(
                  "rounded-lg border p-3 transition-colors space-y-2",
                  isChecked
                    ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10"
                    : "border-border bg-card opacity-70",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`toggle-${item.targetKey}`}
                      checked={isChecked}
                      onCheckedChange={() => handleToggleRow(item.targetKey)}
                      aria-label={item.targetName}
                    />
                    <label
                      htmlFor={`toggle-${item.targetKey}`}
                      className="text-sm font-semibold cursor-pointer select-none"
                    >
                      {item.targetName}
                    </label>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase font-mono"
                  >
                    {item.targetKey}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                  {/* Current Path */}
                  <div className="rounded border bg-muted/40 p-2 space-y-1">
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground block">
                      {t("settings.runtimes.dialog.current_label")}
                    </span>
                    <p className="font-mono break-all line-through text-muted-foreground">
                      {item.currentPath}
                    </p>
                  </div>

                  {/* Detected Path */}
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/15 p-2 space-y-1">
                    <span className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400 block">
                      {t("settings.runtimes.dialog.detected_label")}
                    </span>
                    <p className="font-mono break-all font-medium text-emerald-800 dark:text-emerald-300">
                      {item.detectedPath}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={onDismiss}
            className="w-full sm:w-auto h-9"
          >
            {t("settings.runtimes.dialog.keep_current")}
          </Button>
          {selectedCount > 0 && selectedCount < conflicts.length && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleReplaceSelected}
              className="w-full sm:w-auto h-9"
            >
              {t("settings.runtimes.dialog.replace_selected")} ({selectedCount})
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            onClick={handleReplaceAll}
            className="w-full sm:w-auto h-9"
          >
            {t("settings.runtimes.dialog.replace_all")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
