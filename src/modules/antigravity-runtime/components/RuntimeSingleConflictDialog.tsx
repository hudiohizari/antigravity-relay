import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface RuntimeSingleConflictDialogProps {
  open: boolean;
  targetName: string;
  currentPath: string;
  detectedPath: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function RuntimeSingleConflictDialog({
  open,
  targetName,
  currentPath,
  detectedPath,
  onConfirm,
  onDismiss,
}: RuntimeSingleConflictDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold">
              {t("settings.runtimes.dialog.replace_title")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {t("settings.runtimes.dialog.replace_desc", {
              target: targetName,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          {/* Current Path */}
          <div className="rounded-md border bg-muted/40 p-3 space-y-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground block">
              {t("settings.runtimes.dialog.current_label")}
            </span>
            <p className="font-mono break-all line-through text-muted-foreground">
              {currentPath}
            </p>
          </div>

          {/* Detected Path */}
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/15 p-3 space-y-1">
            <span className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400 block">
              {t("settings.runtimes.dialog.detected_label")}
            </span>
            <p className="font-mono break-all font-medium text-emerald-800 dark:text-emerald-300">
              {detectedPath}
            </p>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onDismiss}
            className="w-full sm:w-auto h-9"
          >
            {t("settings.runtimes.dialog.keep_current")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            className="w-full sm:w-auto h-9"
          >
            {t("settings.runtimes.dialog.replace_all")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
