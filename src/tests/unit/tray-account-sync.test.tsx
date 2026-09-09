// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTrayAccountSync } from "@/modules/cloud-account/hooks/useTrayAccountSync";
import { QUERY_KEYS } from "@/modules/cloud-account/hooks/useCloudAccounts";
import type { CloudAccount } from "@/modules/cloud-account/types";
import * as toastModule from "@/components/ui/use-toast";

vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { email?: string }) => {
      if (key === "traySync.switchedTitle") return "Account Switched";
      if (key === "traySync.switchedDescription") {
        return `Active account switched to ${params?.email} via system tray.`;
      }
      return key;
    },
  }),
}));

const mockAccounts: CloudAccount[] = [
  {
    id: "acc-1",
    provider: "google",
    email: "alpha@example.com",
    token: {
      access_token: "token-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    is_active: true,
    created_at: Date.now(),
    last_used: Date.now(),
  },
  {
    id: "acc-2",
    provider: "google",
    email: "beta@example.com",
    token: {
      access_token: "token-2",
      refresh_token: "refresh-2",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    is_active: false,
    created_at: Date.now(),
    last_used: Date.now(),
  },
];

describe("useTrayAccountSync", () => {
  let queryClient: QueryClient;
  let switchedCallback: ((accountId: string) => void) | null = null;
  let updatedCallback: (() => void) | null = null;
  const unbindSwitchedMock = vi.fn();
  const unbindUpdatedMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    queryClient.setQueryData(QUERY_KEYS.cloudAccounts, [...mockAccounts]);

    switchedCallback = null;
    updatedCallback = null;

    window.electron = {
      ...((window.electron as object) || {}),
      onGoogleAuthCode: vi.fn(),
      changeLanguage: vi.fn(),
      onManualUpdateAvailable: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      dismissManualUpdate: vi.fn(),
      openExternalUrl: vi.fn(),
      onAccountSwitched: vi.fn((cb: (id: string) => void) => {
        switchedCallback = cb;
        return unbindSwitchedMock;
      }),
      onAccountsUpdated: vi.fn((cb: () => void) => {
        updatedCallback = cb;
        return unbindUpdatedMock;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  it("subscribes to electron bridge events and unbinds on unmount", () => {
    const { unmount } = renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    expect(window.electron.onAccountSwitched).toHaveBeenCalledTimes(1);
    expect(window.electron.onAccountsUpdated).toHaveBeenCalledTimes(1);

    unmount();

    expect(unbindSwitchedMock).toHaveBeenCalledTimes(1);
    expect(unbindUpdatedMock).toHaveBeenCalledTimes(1);
  });

  it("optimistically updates active account in cache and triggers 3s toast on account switch", () => {
    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    expect(switchedCallback).toBeDefined();

    act(() => {
      switchedCallback!("acc-2");
    });

    // Optimistic cache check (0ms perceived latency)
    const cached = queryClient.getQueryData<CloudAccount[]>(
      QUERY_KEYS.cloudAccounts,
    );
    expect(cached).toBeDefined();
    expect(cached!.find((a) => a.id === "acc-1")?.is_active).toBe(false);
    expect(cached!.find((a) => a.id === "acc-2")?.is_active).toBe(true);

    // Toast check
    expect(toastModule.toast).toHaveBeenCalledWith({
      title: "Account Switched",
      description:
        "Active account switched to beta@example.com via system tray.",
      duration: 3000,
    });
  });

  it("falls back to account ID if email is not found in cache during switch", () => {
    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    act(() => {
      switchedCallback!("acc-unknown");
    });

    expect(toastModule.toast).toHaveBeenCalledWith({
      title: "Account Switched",
      description: "Active account switched to acc-unknown via system tray.",
      duration: 3000,
    });
  });

  it("debounces query invalidation with 150ms timeout and refetchType active", () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    act(() => {
      switchedCallback!("acc-2");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();

    // Advance timer 149ms (still waiting)
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Advance 1ms more (150ms total)
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: QUERY_KEYS.cloudAccounts,
      refetchType: "active",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["currentAccount"],
      refetchType: "active",
    });
  });

  it("collapses rapid successive switches into a single invalidation", () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    act(() => {
      switchedCallback!("acc-1");
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => {
      switchedCallback!("acc-2");
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => {
      switchedCallback!("acc-1");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Invalidated once per query key
    const cloudAccountCalls = invalidateSpy.mock.calls.filter(
      (call) =>
        JSON.stringify(call[0]?.queryKey) ===
        JSON.stringify(QUERY_KEYS.cloudAccounts),
    );
    expect(cloudAccountCalls).toHaveLength(1);
  });

  it("invalidates queries on accounts-updated event with 150ms debounce without showing a toast", () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    expect(updatedCallback).toBeDefined();

    act(() => {
      updatedCallback!();
    });

    expect(toastModule.toast).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: QUERY_KEYS.cloudAccounts,
      refetchType: "active",
    });
  });

  it("handles null or empty cache gracefully on account switched", () => {
    queryClient.removeQueries({ queryKey: QUERY_KEYS.cloudAccounts });

    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    expect(() => {
      act(() => {
        switchedCallback!("acc-1");
      });
    }).not.toThrow();

    expect(toastModule.toast).toHaveBeenCalledWith({
      title: "Account Switched",
      description: "Active account switched to acc-1 via system tray.",
      duration: 3000,
    });
  });

  it("handles missing window.electron without crashing", () => {
    const originalElectron = window.electron;
    // @ts-expect-error intentionally testing undefined electron
    window.electron = undefined;

    expect(() => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();

    window.electron = originalElectron;
  });
});
