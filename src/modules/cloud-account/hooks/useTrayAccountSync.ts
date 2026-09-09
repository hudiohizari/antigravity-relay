import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/use-toast";
import { QUERY_KEYS } from "@/modules/cloud-account/hooks/useCloudAccounts";
import type { CloudAccount } from "@/modules/cloud-account/types";

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
      debounceTimerRef.current = null;
    }, 150);
  }, [queryClient]);

  const handleAccountSwitched = useCallback(
    (accountId: string) => {
      let switchedEmail: string | undefined;

      queryClient.setQueryData<CloudAccount[]>(
        QUERY_KEYS.cloudAccounts,
        (oldData) => {
          if (!oldData) return oldData;
          const target = oldData.find((acc) => acc.id === accountId);
          if (target) {
            switchedEmail = target.email;
          }
          return oldData.map((acc) => ({
            ...acc,
            is_active: acc.id === accountId,
          }));
        },
      );

      const email = switchedEmail ?? accountId;

      toast({
        title: t("traySync.switchedTitle"),
        description: t("traySync.switchedDescription", { email }),
        duration: 3000,
      });

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
