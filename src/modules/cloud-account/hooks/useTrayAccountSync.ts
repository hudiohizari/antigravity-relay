import React, { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Zap } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { QUERY_KEYS } from "@/modules/cloud-account/hooks/useCloudAccounts";
import type { CloudAccount } from "@/modules/cloud-account/types";
import type {
  CloudAccountSwitchReason,
  CloudAccountSwitchSource,
} from "@/modules/cloud-account/services/cloud-account-events";
import type { ChatResumptionStatusPayload } from "@/modules/chat-resume/types";

export type TraySwitchedPayload =
  | string
  | {
      accountId: string;
      target?: "all" | "app" | "ide" | "cli" | "classic" | "agy";
      source?: CloudAccountSwitchSource;
      reason?: CloudAccountSwitchReason;
    };

export function useTrayAccountSync(): void {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleInvalidate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.cloudAccounts,
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.syncState,
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: ["currentAccount"],
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: ["process", "status"],
        refetchType: "active",
      });
      debounceTimerRef.current = null;
    }, 150);
  }, [queryClient]);

  const handleAccountSwitched = useCallback(
    (payload: TraySwitchedPayload) => {
      if (!payload) return;
      const accountId =
        typeof payload === "string" ? payload : payload.accountId;
      if (!accountId) return;

      const rawTarget =
        typeof payload === "string" ? "all" : (payload.target ?? "all");
      const target =
        rawTarget === "classic"
          ? "app"
          : rawTarget === "agy"
            ? "cli"
            : rawTarget;
      const payloadObj =
        typeof payload === "object" && payload !== null ? payload : null;
      const source = payloadObj?.source;
      const reason = payloadObj?.reason;
      void reason;

      let switchedEmail: string | undefined;

      queryClient.setQueryData<CloudAccount[]>(
        QUERY_KEYS.cloudAccounts,
        (oldData) => {
          if (!oldData) return oldData;
          const matched = oldData.find((acc) => acc.id === accountId);
          if (matched) {
            switchedEmail = matched.email;
          }
          return oldData.map((acc) => {
            const isMatch = acc.id === accountId;
            if (target === "all") {
              return {
                ...acc,
                is_active: isMatch,
                is_active_app: isMatch,
                is_active_classic: isMatch,
                is_active_ide: isMatch,
                is_active_cli: isMatch,
                is_active_agy: isMatch,
              };
            }
            if (target === "app") {
              const otherActive = Boolean(
                acc.is_active_ide || acc.is_active_cli || acc.is_active_agy,
              );
              return {
                ...acc,
                is_active_app: isMatch,
                is_active_classic: isMatch,
                is_active: isMatch || otherActive,
              };
            }
            if (target === "ide") {
              const otherActive = Boolean(
                acc.is_active_app ||
                acc.is_active_classic ||
                acc.is_active_cli ||
                acc.is_active_agy,
              );
              return {
                ...acc,
                is_active_ide: isMatch,
                is_active: isMatch || otherActive,
              };
            }
            if (target === "cli") {
              const otherActive = Boolean(
                acc.is_active_app || acc.is_active_classic || acc.is_active_ide,
              );
              return {
                ...acc,
                is_active_cli: isMatch,
                is_active_agy: isMatch,
                is_active: isMatch || otherActive,
              };
            }
            return {
              ...acc,
              is_active: isMatch,
            };
          });
        },
      );

      // 1. Strict suppression for manual in-app switches and resync actions
      if (source === "manual" || source === "resync") {
        scheduleInvalidate();
        return;
      }

      const email = switchedEmail ?? accountId;

      // 2. Distinct Auto-Switch Toast (Amber Accent + Lucide Zap + 4500ms Duration)
      if (source === "auto_switch") {
        const isAll = target === "all";
        const canonicalKey =
          rawTarget === "classic"
            ? "app"
            : rawTarget === "agy"
              ? "cli"
              : rawTarget;
        const targetName =
          t(`cloud.target.${canonicalKey}`) ||
          t(`cloud.target.${rawTarget}`) ||
          rawTarget;

        const description = isAll
          ? t("autoSwitch.toastAllDescription", { email })
          : t("autoSwitch.toastTargetDescription", {
              target: targetName,
              email,
            });

        const titleText = isAll
          ? t("autoSwitch.toastTitle")
          : t("autoSwitch.toastTargetTitle", { target: targetName });

        toast({
          title: React.createElement(
            "div",
            { className: "flex items-center gap-2 min-w-0" },
            React.createElement(Zap, {
              className: "h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400",
              "aria-hidden": "true",
            }),
            React.createElement(
              "span",
              {
                className:
                  "font-semibold text-amber-950 dark:text-amber-100 truncate",
              },
              titleText,
            ),
          ),
          description: React.createElement(
            "span",
            {
              className:
                "block text-sm text-amber-900/90 dark:text-amber-200/90 break-words [overflow-wrap:anywhere]",
            },
            description,
          ),
          className:
            "border-amber-500/30 bg-amber-500/10 dark:border-amber-500/35 dark:bg-amber-500/15 text-foreground shadow-lg",
          duration: 4500,
        });

        scheduleInvalidate();
        return;
      }

      // 3. Standard Tray Switch Toast (source === 'tray' or legacy fallback)
      if (payloadObj && payloadObj.target && payloadObj.target !== "all") {
        const canonicalKey =
          payloadObj.target === "classic"
            ? "app"
            : payloadObj.target === "agy"
              ? "cli"
              : payloadObj.target;
        const targetName =
          t(`cloud.target.${canonicalKey}`) ||
          t(`cloud.target.${payloadObj.target}`) ||
          payloadObj.target;
        toast({
          title: t("traySync.switchedTargetTitle"),
          description: t("traySync.switchedTargetDescription", {
            target: targetName,
            email,
          }),
          duration: 3000,
        });
      } else if (payloadObj && payloadObj.target === "all") {
        const hasSwitchedAll =
          t("traySync.switchedAllTitle") !== "traySync.switchedAllTitle";
        toast({
          title: hasSwitchedAll
            ? t("traySync.switchedAllTitle")
            : t("traySync.switchedTitle"),
          description: hasSwitchedAll
            ? t("traySync.switchedAllDescription", { email })
            : t("traySync.switchedDescription", { email }),
          duration: 3000,
        });
      } else {
        toast({
          title: t("traySync.switchedTitle"),
          description: t("traySync.switchedDescription", { email }),
          duration: 3000,
        });
      }

      scheduleInvalidate();
    },
    [queryClient, t, scheduleInvalidate],
  );

  const handleAccountsUpdated = useCallback(() => {
    scheduleInvalidate();
  }, [scheduleInvalidate]);

  const handleChatResumptionStatus = useCallback(
    (payload: ChatResumptionStatusPayload) => {
      triggerChatResumptionToast(payload, t);
    },
    [t],
  );

  useEffect(() => {
    const electron = window.electron;
    if (!electron) return;

    const unbindSwitched = electron.onAccountSwitched?.(handleAccountSwitched);
    const unbindUpdated = electron.onAccountsUpdated?.(handleAccountsUpdated);
    const unbindResumption = electron.onChatResumptionStatus?.(
      handleChatResumptionStatus,
    );

    return () => {
      unbindSwitched?.();
      unbindUpdated?.();
      unbindResumption?.();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    handleAccountSwitched,
    handleAccountsUpdated,
    handleChatResumptionStatus,
  ]);
}

export function triggerChatResumptionToast(
  payload: ChatResumptionStatusPayload,
  t: (key: string, options?: Record<string, unknown>) => string,
): void {
  if (!payload) return;

  if (payload.status === "resumed") {
    toast({
      title: React.createElement(
        "div",
        { className: "flex items-center gap-2 min-w-0" },
        React.createElement(Zap, {
          className: "h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400",
          "aria-hidden": "true",
        }),
        React.createElement(
          "span",
          {
            className:
              "font-semibold text-emerald-950 dark:text-emerald-100 truncate",
          },
          t("toast.chatResume.successTitle"),
        ),
      ),
      description: React.createElement(
        "span",
        {
          className:
            "block text-sm text-emerald-900/90 dark:text-emerald-200/90 break-words [overflow-wrap:anywhere]",
        },
        t("toast.chatResume.successDesc", {
          email: payload.accountEmail || "",
        }),
      ),
      className:
        "border-emerald-500/30 bg-emerald-500/10 dark:border-emerald-500/35 dark:bg-emerald-500/15 text-foreground shadow-lg",
      duration: 4000,
    });
    return;
  }

  if (payload.status === "failed" || payload.status === "model_fallback") {
    toast({
      title: React.createElement(
        "div",
        { className: "flex items-center gap-2 min-w-0" },
        React.createElement(AlertTriangle, {
          className: "h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400",
          "aria-hidden": "true",
        }),
        React.createElement(
          "span",
          {
            className:
              "font-semibold text-amber-950 dark:text-amber-100 truncate",
          },
          t("toast.chatResume.failedTitle"),
        ),
      ),
      description: React.createElement(
        "span",
        {
          className:
            "block text-sm text-amber-900/90 dark:text-amber-200/90 break-words [overflow-wrap:anywhere]",
        },
        t("toast.chatResume.failedDesc"),
      ),
      className:
        "border-amber-500/30 bg-amber-500/10 dark:border-amber-500/35 dark:bg-amber-500/15 text-foreground shadow-lg",
      duration: 4500,
    });
  }
}
