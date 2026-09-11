// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CloudAccountCard,
  CompactCloudAccountCard,
} from "@/modules/cloud-account/components/CloudAccountCard";
import { CloudAccountList } from "@/modules/cloud-account/components/CloudAccountList";
import type { CloudAccount } from "@/modules/cloud-account/types";
import en from "@/localization/en";
import { get } from "lodash-es";

const mockToast = vi.fn();
let mockSwitchMutate: any = vi.fn();
let mockSwitchIsPending = false;

const baseAccount: CloudAccount = {
  id: "acc-1",
  provider: "google",
  email: "dev@example.com",
  token: {
    access_token: "tok",
    refresh_token: "ref",
    expires_in: 3600,
    expiry_timestamp: Date.now() + 3600000,
    token_type: "Bearer",
  },
  created_at: Date.now(),
  last_used: Date.now(),
  status: "active",
  is_active_app: false,
  is_active_ide: false,
  is_active_cli: false,
};

vi.mock("@/modules/antigravity-runtime/actions/process", () => ({
  getProcessStatus: vi.fn().mockResolvedValue({
    isRunning: false,
    isBinaryInstalled: true,
  }),
}));

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: { grid_layout: "auto", account_sort: "recently-used" },
    saveConfig: vi.fn(),
  }),
}));

vi.mock("@/modules/cloud-account/hooks/useProviderGrouping", () => ({
  useProviderGrouping: () => ({
    enabled: false,
    getAccountStats: vi.fn(),
    isProviderCollapsed: vi.fn(),
    toggleProviderCollapse: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let val = get(en, key);
      if (typeof val === "string") {
        if (options) {
          for (const [k, v] of Object.entries(options)) {
            val = val.replace(new RegExp(`{{${k}}}`, "g"), String(v));
          }
        }
        return val;
      }
      if (options?.defaultValue) return options.defaultValue;
      return key;
    },
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/modules/cloud-account/components/CloudAccountToolbar", () => ({
  CloudAccountToolbar: () => <div data-testid="cloud-account-toolbar" />,
}));

let mockOnSwitchCapture: ((id: string, target?: any) => void) | null = null;

vi.mock("@/modules/cloud-account/components/CloudAccountGrid", () => ({
  CloudAccountGrid: ({
    onSwitch,
  }: {
    onSwitch: (id: string, target?: any) => void;
  }) => {
    mockOnSwitchCapture = onSwitch;
    return <div data-testid="cloud-account-grid" />;
  },
}));

vi.mock(
  "@/modules/cloud-account/components/CloudAccountBatchActionBar",
  () => ({
    CloudAccountBatchActionBar: () => null,
  }),
);

vi.mock("@/modules/identity-profile/components/IdentityProfileDialog", () => ({
  IdentityProfileDialog: () => null,
}));

vi.mock("@/modules/cloud-account/hooks/useCloudAccounts", () => ({
  useWeeklyWarmupConfig: () => ({ data: undefined }),
  useCloudAccounts: () => ({
    data: [baseAccount],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCloudAccountSecurityStatus: () => ({ data: undefined }),
  useRefreshQuota: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCloudAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useAddGoogleAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useSwitchCloudAccount: () => ({
    mutate: (vars: any, opts: any) => mockSwitchMutate(vars, opts),
    isPending: mockSwitchIsPending,
  }),
  useSyncLocalAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useAutoSwitchEnabled: () => ({ data: true, isLoading: false }),
  useSetAutoSwitchEnabled: () => ({ mutate: vi.fn(), isPending: false }),
  useForcePollCloudMonitor: () => ({ mutate: vi.fn(), isPending: false }),
  useOAuthClients: () => ({ data: [], isLoading: false }),
  useSetActiveOAuthClient: () => ({ mutate: vi.fn(), isPending: false }),
  startAuthFlow: vi.fn(),
  useExportCloudAccounts: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportCloudAccounts: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncState: () => ({
    data: {
      isUnifiedMode: true,
      isPhysicallyUnified: false,
      activeAccountId: "acc-1",
      targetAccounts: {
        app: "acc-1",
        ide: "",
        cli: "",
        classic: "acc-1",
        agy: "",
      },
      installedTargets: ["app", "ide", "cli"],
      divergedTargets: [],
    },
  }),
  useResyncAllEnvironments: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSetAccountProxy: () => ({
    mutate: vi.fn(),
  }),
}));

describe("CloudAccountCard CLI Hints and Dropdown Layout", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
  };

  it("renders CLI subtitle hint and tooltip in standard card view", async () => {
    renderWithClient(
      <CloudAccountCard
        account={baseAccount}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    const trigger = screen.getByLabelText(
      "Switch active account for dev@example.com",
    );
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(
      await screen.findByText("Terminal tool: applies to new sessions"),
    ).toBeDefined();
    expect(screen.getByText("Antigravity CLI")).toBeDefined();

    const cliItem = screen.getByTitle("Terminal tool: applies to new sessions");
    expect(cliItem).toBeDefined();
    expect(cliItem.className).toContain("min-h-[44px]");
  });

  it("renders CLI subtitle hint and tooltip in compact card view", async () => {
    renderWithClient(
      <CompactCloudAccountCard
        account={baseAccount}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    const trigger = screen.getByLabelText(
      "Switch active account for dev@example.com",
    );
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(
      await screen.findByText("Terminal tool: applies to new sessions"),
    ).toBeDefined();
    expect(screen.getByText("Antigravity CLI")).toBeDefined();

    const cliItem = screen.getByTitle("Terminal tool: applies to new sessions");
    expect(cliItem).toBeDefined();
    expect(cliItem.className).toContain("min-h-[44px]");
  });
});

describe("CloudAccountList Toast Messaging Rules", () => {
  let queryClient: QueryClient;
  let mockNoticeDispatch = vi.fn();
  let noticeEventListener: (e: Event) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSwitchCapture = null;
    mockSwitchIsPending = false;
    mockNoticeDispatch = vi.fn();
    noticeEventListener = (e: Event) => {
      mockNoticeDispatch((e as CustomEvent).detail);
    };
    window.addEventListener("cloud_account_switch_notice", noticeEventListener);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    window.removeEventListener(
      "cloud_account_switch_notice",
      noticeEventListener,
    );
  });

  const renderList = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CloudAccountList />
      </QueryClientProvider>,
    );
  };

  it("displays noticeCliUpdated when switching specifically for CLI", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["cli"],
        failedTargets: [],
        restarted: false,
        results: { cli: { success: true, restarted: false } },
      });
    });

    renderList();
    expect(mockOnSwitchCapture).toBeDefined();
    mockOnSwitchCapture!("acc-1", "cli");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Account switched!",
      description:
        "CLI credentials updated. Ready for your next terminal command.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "cli",
      restarted: false,
      notice_variant: "cli_updated",
      status: "success",
    });
  });

  it("displays noticeRestarted when switching running GUI target", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["app"],
        failedTargets: [],
        restarted: true,
        results: { app: { success: true, restarted: true } },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "app");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Account switched!",
      description: "Credentials applied. Restarted Antigravity App.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "app",
      restarted: true,
      notice_variant: "restarted",
      status: "success",
    });
  });

  it("displays noticeInjectedOnDisk when switching stopped GUI target", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["ide"],
        failedTargets: [],
        restarted: false,
        results: { ide: { success: true, restarted: false } },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "ide");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Account switched!",
      description:
        "Credentials updated on disk for Antigravity IDE. Changes take effect on next launch.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "ide",
      restarted: false,
      notice_variant: "injected_on_disk",
      status: "success",
    });
  });

  it("displays noticeBatchAllRestarted when all switched batch environments were restarted", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["app", "ide"],
        failedTargets: [],
        restartedTargets: ["app", "ide"],
        injectedTargets: [],
        results: {
          app: { success: true, restarted: true },
          ide: { success: true, restarted: true },
        },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith({
      title: "All Environments Switched",
      description:
        "Credentials applied. Running environments have been restarted.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: ["app", "ide"],
      notice_variant: "batch_all_restarted",
      status: "success",
    });
  });

  it("displays noticeBatchAllInjected when all batch environments were injected on disk", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["app", "cli"],
        failedTargets: [],
        restartedTargets: [],
        injectedTargets: ["app", "cli"],
        results: {
          app: { success: true, restarted: false },
          cli: { success: true, restarted: false },
        },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith({
      title: "All Environments Switched",
      description:
        "Credentials updated on disk for all environments. Changes take effect on next launch.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: [],
      notice_variant: "batch_all_injected",
      status: "success",
    });
  });

  it("displays noticeBatchMixed when batch switch includes restarted and disk-injected targets", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["app", "cli"],
        failedTargets: [],
        restartedTargets: ["app"],
        injectedTargets: ["cli"],
        results: {
          app: { success: true, restarted: true },
          cli: { success: true, restarted: false },
        },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith({
      title: "All Environments Switched",
      description:
        "Credentials updated: restarted Antigravity App, updated on disk for Antigravity CLI.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: ["app"],
      notice_variant: "batch_mixed",
      status: "success",
    });
  });

  it("never classifies CLI as restarted even if passed in restartedTargets array", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["cli"],
        failedTargets: [],
        restartedTargets: ["cli"],
        injectedTargets: [],
        results: {
          cli: { success: true, restarted: true },
        },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith({
      title: "All Environments Switched",
      description:
        "Credentials updated on disk for all environments. Changes take effect on next launch.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: [],
      notice_variant: "batch_all_injected",
      status: "success",
    });
  });

  it("emits telemetry and displays toast when single target switch fails", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "failed",
        accountId: "acc-1",
        succeededTargets: [],
        failedTargets: [{ target: "app", error: "Target process locked" }],
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "app");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Failed to switch account",
      description: "Target process locked",
      variant: "destructive",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "app",
      restarted: false,
      notice_variant: "failed",
      status: "failed",
    });
  });

  it("emits telemetry and displays toast when single target switch throws error", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onError(new Error("Connection timeout"));
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "cli");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Failed to switch account",
      description: "Connection timeout",
      variant: "destructive",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "cli",
      restarted: false,
      notice_variant: "failed",
      status: "failed",
    });
  });

  it("emits telemetry and displays toast when batch switch partially fails", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "partial",
        accountId: "acc-1",
        succeededTargets: ["app"],
        failedTargets: [{ target: "ide", error: "Permission denied" }],
        restartedTargets: ["app"],
        injectedTargets: [],
        results: {
          app: { success: true, restarted: true },
          ide: { success: false, error: "Permission denied" },
        },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Partial Switch Completed",
        variant: "destructive",
      }),
    );
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: ["app"],
      notice_variant: "failed",
      status: "partial",
    });
  });

  it("emits telemetry and displays toast when batch switch completely fails", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "failed",
        accountId: "acc-1",
        succeededTargets: [],
        failedTargets: [{ target: "app", error: "Daemon offline" }],
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Switch Failed",
      description: "Failed to switch environments: Daemon offline",
      variant: "destructive",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: [],
      notice_variant: "failed",
      status: "failed",
    });
  });

  it("emits telemetry and displays toast when batch switch throws mutation error", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onError(new Error("Daemon unreachable"));
    });

    renderList();
    mockOnSwitchCapture!("acc-1", "all");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Failed to switch account",
      description: "Daemon unreachable",
      variant: "destructive",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "all",
      restarted: [],
      notice_variant: "failed",
      status: "failed",
    });
  });

  it("emits telemetry with canonical app target when target parameter is omitted", async () => {
    mockSwitchMutate = vi.fn((vars, opts) => {
      opts.onSuccess({
        overall: "success",
        accountId: "acc-1",
        succeededTargets: ["app"],
        failedTargets: [],
        restarted: true,
        results: { app: { success: true, restarted: true } },
      });
    });

    renderList();
    mockOnSwitchCapture!("acc-1");

    expect(mockToast).toHaveBeenCalledWith({
      title: "Account switched!",
      description: "Credentials applied. Restarted Antigravity App.",
    });
    expect(mockNoticeDispatch).toHaveBeenCalledWith({
      account_id: "acc-1",
      app_target: "app",
      restarted: true,
      notice_variant: "restarted",
      status: "success",
    });
  });
});
