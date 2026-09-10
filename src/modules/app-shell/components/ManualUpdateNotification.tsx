import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function ManualUpdateNotification() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<ManualUpdateInfo | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    if (!window.electron?.onManualUpdateAvailable) {
      return;
    }
    return window.electron.onManualUpdateAvailable((nextUpdate) => {
      setUpdate(nextUpdate);
      setIsWorking(false);
    });
  }, []);

  if (!update) {
    return null;
  }

  const dismiss = async () => {
    if (window.electron?.dismissManualUpdate) {
      await window.electron.dismissManualUpdate(update.version);
    }
    setUpdate(null);
  };

  const runPrimaryAction = async () => {
    setIsWorking(true);
    try {
      if (update.source === "electron-updater") {
        if (update.state === "downloaded") {
          if (window.electron?.installUpdate) {
            await window.electron.installUpdate();
          }
          return;
        }

        if (!window.electron?.downloadUpdate) {
          setIsWorking(false);
          return;
        }

        const result = await window.electron.downloadUpdate();
        if (
          result.status === "started" ||
          result.status === "already-downloading"
        ) {
          return;
        }

        if (result.status === "already-downloaded") {
          setUpdate({ ...update, state: "downloaded" });
          setIsWorking(false);
          return;
        }

        setIsWorking(false);
        return;
      }

      if (window.electron?.openExternalUrl) {
        await window.electron.openExternalUrl(update.releaseUrl);
      }
      if (window.electron?.dismissManualUpdate) {
        await window.electron.dismissManualUpdate(update.version);
      }
      setUpdate(null);
    } catch {
      setIsWorking(false);
    }
  };

  const isDownloaded =
    update.source === "electron-updater" && update.state === "downloaded";
  const title = isDownloaded
    ? t("update.downloaded.title")
    : t("update.available.title");
  const description = isDownloaded
    ? t("update.downloaded.description", { version: update.version })
    : t("update.available.description", { version: update.version });
  const actionLabel = isDownloaded
    ? t("update.downloaded.restart")
    : isWorking
      ? t("update.available.downloading")
      : t("update.available.download");
  const ActionIcon = isDownloaded ? RefreshCw : Download;

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-110 w-[min(calc(100vw-2rem),24rem)]">
      <div className="bg-popover text-popover-foreground pointer-events-auto rounded-md border p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1">
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-muted-foreground text-sm">{description}</div>
            {update.platform === "darwin" && (
              <div className="text-muted-foreground text-xs">
                {t("update.available.macosUnsignedNote")}
              </div>
            )}
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
            aria-label={t("update.available.dismiss")}
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={isWorking && !isDownloaded}
            onClick={runPrimaryAction}
          >
            <ActionIcon
              className={`mr-2 h-4 w-4 ${isWorking && !isDownloaded ? "animate-spin" : ""}`}
            />
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
