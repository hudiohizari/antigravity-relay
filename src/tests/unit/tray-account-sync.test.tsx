// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useTrayAccountSync,
  triggerChatResumptionToast,
  type TraySwitchedPayload,
} from "@/modules/cloud-account/hooks/useTrayAccountSync";
import type { ChatResumptionStatusPayload } from "@/modules/chat-resume/types";
import { QUERY_KEYS } from "@/modules/cloud-account/hooks/useCloudAccounts";
import type { CloudAccount } from "@/modules/cloud-account/types";
import * as toastModule from "@/components/ui/use-toast";

vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { email?: string; target?: string }) => {
      if (key === "traySync.switchedTitle") return "Account Switched";
      if (key === "traySync.switchedDescription") {
        return `Active account switched to ${params?.email} via system tray.`;
      }
      if (key === "traySync.switchedAllTitle")
        return "All Environments Switched";
      if (key === "traySync.switchedAllDescription") {
        return `Switched all environments to ${params?.email} via system tray.`;
      }
      if (key === "traySync.switchedTargetTitle") return "Account Switched";
      if (key === "traySync.switchedTargetDescription") {
        return `Switched ${params?.target} to ${params?.email} via system tray.`;
      }
      if (key === "autoSwitch.toastTitle") return "Auto-Switch: Rate Limit";
      if (key === "autoSwitch.toastTargetTitle") {
        return `Auto-Switch: ${params?.target}`;
      }
      if (key === "autoSwitch.toastAllDescription") {
        return `Switched all environments to ${params?.email} due to rate limit.`;
      }
      if (key === "autoSwitch.toastTargetDescription") {
        return `Switched ${params?.target} to ${params?.email} due to rate limit.`;
      }
      if (key === "cloud.target.app") return "Antigravity";
      if (key === "cloud.target.ide") return "Antigravity IDE";
      if (key === "cloud.target.cli") return "Antigravity CLI";
      if (key === "toast.chatResume.successTitle")
        return "Chat Session Resumed";
      if (key === "toast.chatResume.successDesc") {
        return `Auto-resumed chat session under ${params?.email}.`;
      }
      if (key === "toast.chatResume.failedTitle") return "Auto-Resume Failed";
      if (key === "toast.chatResume.failedDesc") {
        return "Could not auto-resume chat session. Your prompt has been saved.";
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
  let switchedCallback: ((payload: TraySwitchedPayload) => void) | null = null;
  let updatedCallback: (() => void) | null = null;
  let resumptionCallback:
    ((payload: ChatResumptionStatusPayload) => void) | null = null;
  const unbindSwitchedMock = vi.fn();
  const unbindUpdatedMock = vi.fn();
  const unbindResumptionMock = vi.fn();

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
    resumptionCallback = null;

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
      onAccountSwitched: vi.fn((cb: (payload: TraySwitchedPayload) => void) => {
        switchedCallback = cb;
        return unbindSwitchedMock;
      }),
      onAccountsUpdated: vi.fn((cb: () => void) => {
        updatedCallback = cb;
        return unbindUpdatedMock;
      }),
      onChatResumptionStatus: vi.fn(
        (cb: (payload: ChatResumptionStatusPayload) => void) => {
          resumptionCallback = cb;
          return unbindResumptionMock;
        },
      ),
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
    expect(window.electron.onChatResumptionStatus).toHaveBeenCalledTimes(1);

    unmount();

    expect(unbindSwitchedMock).toHaveBeenCalledTimes(1);
    expect(unbindUpdatedMock).toHaveBeenCalledTimes(1);
    expect(unbindResumptionMock).toHaveBeenCalledTimes(1);
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

  it("handles null, undefined, or empty payload without throwing or corrupting cache", () => {
    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    expect(() => {
      act(() => {
        // @ts-expect-error intentionally testing null payload
        switchedCallback!(null);
      });
    }).not.toThrow();

    expect(() => {
      act(() => {
        // @ts-expect-error intentionally testing undefined payload
        switchedCallback!(undefined);
      });
    }).not.toThrow();

    expect(() => {
      act(() => {
        // @ts-expect-error intentionally testing payload without accountId
        switchedCallback!({});
      });
    }).not.toThrow();

    const cached = queryClient.getQueryData<CloudAccount[]>(
      QUERY_KEYS.cloudAccounts,
    );
    expect(cached!.find((a) => a.id === "acc-1")?.is_active).toBe(true);
  });

  it("handles multi-target payloads and normalizes cli alias to agy with dual-property hydration", () => {
    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    act(() => {
      switchedCallback!({
        accountId: "acc-2",
        target: "cli",
      } as any);
    });

    const cached = queryClient.getQueryData<CloudAccount[]>(
      QUERY_KEYS.cloudAccounts,
    );
    const acc2 = cached!.find((a) => a.id === "acc-2");
    expect(acc2?.is_active_cli).toBe(true);
    expect(acc2?.is_active_agy).toBe(true);
    expect(acc2?.is_active).toBe(true);
  });

  it("handles single target ide, app, and classic switch payloads correctly", () => {
    renderHook(() => useTrayAccountSync(), {
      wrapper: createWrapper(),
    });

    act(() => {
      switchedCallback!({
        accountId: "acc-2",
        target: "ide",
      });
    });

    let cached = queryClient.getQueryData<CloudAccount[]>(
      QUERY_KEYS.cloudAccounts,
    );
    let acc2 = cached!.find((a) => a.id === "acc-2");
    expect(acc2?.is_active_ide).toBe(true);
    expect(acc2?.is_active).toBe(true);

    act(() => {
      switchedCallback!({
        accountId: "acc-2",
        target: "app",
      });
    });

    cached = queryClient.getQueryData<CloudAccount[]>(QUERY_KEYS.cloudAccounts);
    acc2 = cached!.find((a) => a.id === "acc-2");
    expect(acc2?.is_active_app).toBe(true);
    expect(acc2?.is_active_classic).toBe(true);
    expect(acc2?.is_active).toBe(true);

    act(() => {
      switchedCallback!({
        accountId: "acc-2",
        target: "classic",
      });
    });

    cached = queryClient.getQueryData<CloudAccount[]>(QUERY_KEYS.cloudAccounts);
    acc2 = cached!.find((a) => a.id === "acc-2");
    expect(acc2?.is_active_app).toBe(true);
    expect(acc2?.is_active_classic).toBe(true);
    expect(acc2?.is_active).toBe(true);
  });

  describe("Source Attribution & Feedback Routing", () => {
    it("renders amber toast with Zap icon, 4500ms duration, and autoSwitch copy when source is auto_switch for all targets", () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "all",
          source: "auto_switch",
          reason: "rate_limit",
        });
      });

      const cached = queryClient.getQueryData<CloudAccount[]>(
        QUERY_KEYS.cloudAccounts,
      );
      expect(cached!.find((a) => a.id === "acc-2")?.is_active).toBe(true);

      expect(toastModule.toast).toHaveBeenCalledTimes(1);
      const call = vi.mocked(toastModule.toast).mock.calls[0][0];

      expect(call.duration).toBe(4500);
      expect(call.className).toContain("border-amber-500/30");
      expect(call.className).toContain("bg-amber-500/10");
      expect(call.className).toContain("dark:border-amber-500/35");
      expect(call.className).toContain("dark:bg-amber-500/15");

      const { container: titleContainer } = render(
        call.title as React.ReactElement,
      );
      expect(titleContainer.textContent).toContain("Auto-Switch: Rate Limit");
      const icon = titleContainer.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.getAttribute("class")).toContain("text-amber-700");

      const { container: descContainer } = render(
        call.description as React.ReactElement,
      );
      expect(descContainer.textContent).toContain(
        "Switched all environments to beta@example.com due to rate limit.",
      );
      expect(descContainer.textContent).not.toContain("via system tray");
      const descElement = descContainer.firstChild as HTMLElement;
      expect(descElement?.className).toContain("break-words");
      expect(descElement?.className).toContain("[overflow-wrap:anywhere]");

      expect(invalidateSpy).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: QUERY_KEYS.cloudAccounts,
        refetchType: "active",
      });
    });

    it("renders amber toast with target-specific title and description when source is auto_switch for a single target", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "ide",
          source: "auto_switch",
          reason: "rate_limit",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledTimes(1);
      const call = vi.mocked(toastModule.toast).mock.calls[0][0];
      expect(call.duration).toBe(4500);

      const { container: titleContainer } = render(
        call.title as React.ReactElement,
      );
      expect(titleContainer.textContent).toContain(
        "Auto-Switch: Antigravity IDE",
      );

      const { container: descContainer } = render(
        call.description as React.ReactElement,
      );
      expect(descContainer.textContent).toContain(
        "Switched Antigravity IDE to beta@example.com due to rate limit.",
      );
      expect(descContainer.textContent).not.toContain("via system tray");
    });

    it("handles legacy aliases classic and agy for auto_switch target normalization", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "classic",
          source: "auto_switch",
        });
      });

      const callClassic = vi.mocked(toastModule.toast).mock.calls[0][0];
      const { container: descClassic } = render(
        callClassic.description as React.ReactElement,
      );
      expect(descClassic.textContent).toContain(
        "Switched Antigravity to beta@example.com due to rate limit.",
      );

      vi.mocked(toastModule.toast).mockClear();

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "agy",
          source: "auto_switch",
        });
      });

      const callAgy = vi.mocked(toastModule.toast).mock.calls[0][0];
      const { container: descAgy } = render(
        callAgy.description as React.ReactElement,
      );
      expect(descAgy.textContent).toContain(
        "Switched Antigravity CLI to beta@example.com due to rate limit.",
      );
    });

    it("strictly suppresses toast when source is manual while executing cache updates and invalidation", () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "all",
          source: "manual",
          reason: "user_action",
        });
      });

      const cached = queryClient.getQueryData<CloudAccount[]>(
        QUERY_KEYS.cloudAccounts,
      );
      expect(cached!.find((a) => a.id === "acc-2")?.is_active).toBe(true);

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

    it("strictly suppresses toast when source is resync while executing cache updates and invalidation", () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "all",
          source: "resync",
          reason: "user_action",
        });
      });

      const cached = queryClient.getQueryData<CloudAccount[]>(
        QUERY_KEYS.cloudAccounts,
      );
      expect(cached!.find((a) => a.id === "acc-2")?.is_active).toBe(true);

      expect(toastModule.toast).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: QUERY_KEYS.cloudAccounts,
        refetchType: "active",
      });
    });

    it("renders standard tray toast with 3000ms duration when source is explicitly tray", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "all",
          source: "tray",
          reason: "user_action",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledWith({
        title: "All Environments Switched",
        description:
          "Switched all environments to beta@example.com via system tray.",
        duration: 3000,
      });
    });

    it("renders target-specific tray toast when source is tray and target is single", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "ide",
          source: "tray",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledWith({
        title: "Account Switched",
        description:
          "Switched Antigravity IDE to beta@example.com via system tray.",
        duration: 3000,
      });
    });

    it("gracefully falls back to tray toast when payload has no source property (legacy object)", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        switchedCallback!({
          accountId: "acc-2",
          target: "all",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledWith({
        title: "All Environments Switched",
        description:
          "Switched all environments to beta@example.com via system tray.",
        duration: 3000,
      });
    });
  });

  describe("chat resumption status toasts", () => {
    it("renders emerald toast with Zap icon, 4000ms duration, and Maya copy on status resumed", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        resumptionCallback!({
          status: "resumed",
          accountEmail: "developer@example.com",
          resumptionId: "res-uuid-1",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledTimes(1);
      const call = vi.mocked(toastModule.toast).mock.calls[0][0];

      expect(call.duration).toBe(4000);
      expect(call.className).toContain("border-emerald-500/30");
      expect(call.className).toContain("bg-emerald-500/10");
      expect(call.className).toContain("dark:border-emerald-500/35");
      expect(call.className).toContain("dark:bg-emerald-500/15");

      const { container: titleContainer } = render(
        call.title as React.ReactElement,
      );
      expect(titleContainer.textContent).toContain("Chat Session Resumed");

      const { container: descContainer } = render(
        call.description as React.ReactElement,
      );
      expect(descContainer.textContent).toContain(
        "Auto-resumed chat session under developer@example.com.",
      );
    });

    it("renders amber toast with AlertTriangle icon, 4500ms duration, and Maya copy on status failed", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        resumptionCallback!({
          status: "failed",
          reason: "timeout",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledTimes(1);
      const call = vi.mocked(toastModule.toast).mock.calls[0][0];

      expect(call.duration).toBe(4500);
      expect(call.className).toContain("border-amber-500/30");
      expect(call.className).toContain("bg-amber-500/10");
      expect(call.className).toContain("dark:border-amber-500/35");
      expect(call.className).toContain("dark:bg-amber-500/15");

      const { container: titleContainer } = render(
        call.title as React.ReactElement,
      );
      expect(titleContainer.textContent).toContain("Auto-Resume Failed");

      const { container: descContainer } = render(
        call.description as React.ReactElement,
      );
      expect(descContainer.textContent).toContain(
        "Could not auto-resume chat session. Your prompt has been saved.",
      );
    });

    it("renders amber toast with 4500ms duration on status model_fallback", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        resumptionCallback!({
          status: "model_fallback",
          fallbackModel: "gemini-1.5-flash",
        });
      });

      expect(toastModule.toast).toHaveBeenCalledTimes(1);
      const call = vi.mocked(toastModule.toast).mock.calls[0][0];

      expect(call.duration).toBe(4500);
      expect(call.className).toContain("border-amber-500/30");

      const { container: titleContainer } = render(
        call.title as React.ReactElement,
      );
      expect(titleContainer.textContent).toContain("Auto-Resume Failed");
    });

    it("ignores null or undefined resumption payloads gracefully", () => {
      renderHook(() => useTrayAccountSync(), {
        wrapper: createWrapper(),
      });

      act(() => {
        resumptionCallback!(null as unknown as ChatResumptionStatusPayload);
      });

      expect(toastModule.toast).not.toHaveBeenCalled();
    });

    it("mounts safely when electron.onChatResumptionStatus is missing", () => {
      delete window.electron.onChatResumptionStatus;

      expect(() => {
        const { unmount } = renderHook(() => useTrayAccountSync(), {
          wrapper: createWrapper(),
        });
        unmount();
      }).not.toThrow();
    });

    it("directly triggers toast via triggerChatResumptionToast with empty email fallback", () => {
      const mockT = vi.fn((key: string, params?: Record<string, unknown>) => {
        if (key === "toast.chatResume.successTitle")
          return "Chat Session Resumed";
        if (key === "toast.chatResume.successDesc") {
          return `Auto-resumed under ${params?.email || "unknown"}`;
        }
        return key;
      });

      triggerChatResumptionToast(
        { status: "resumed", accountEmail: undefined },
        mockT,
      );

      expect(toastModule.toast).toHaveBeenCalledTimes(1);
      const call = vi.mocked(toastModule.toast).mock.calls[0][0];
      expect(call.duration).toBe(4000);
    });
  });
});
