import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/use-toast";
import { QUERY_KEYS } from "@/modules/cloud-account/hooks/useCloudAccounts";
import type { CloudAccount } from "@/modules/cloud-account/types";

export type TraySwitchedPayload =
  | string
  | {
      accountId: string;
      target?: "all" | "app" | "ide" | "cli" | "classic" | "agy";
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

      const email = switchedEmail ?? accountId;

      if (
        typeof payload === "object" &&
        payload !== null &&
        payload.target &&
        payload.target !== "all"
      ) {
        const canonicalKey =
          payload.target === "classic"
            ? "app"
            : payload.target === "agy"
              ? "cli"
              : payload.target;
        const targetName =
          t(`cloud.target.${canonicalKey}`) ||
          t(`cloud.target.${payload.target}`) ||
          payload.target;
        toast({
          title: t("traySync.switchedTargetTitle"),
          description: t("traySync.switchedTargetDescription", {
            target: targetName,
            email,
          }),
          duration: 3000,
        });
      } else if (
        typeof payload === "object" &&
        payload !== null &&
        payload.target === "all"
      ) {
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

  useEffect(() => {
    const electron = window.electron;
    if (!electron) return;

    const unbindSwitched = electron.onAccountSwitched?.(handleAccountSwitched);
    const unbindUpdated = electron.onAccountsUpdated?.(handleAccountsUpdated);

    return () => {
      unbindSwitched?.();
      unbindUpdated?.();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [handleAccountSwitched, handleAccountsUpdated]);
}
