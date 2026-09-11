import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CloudAccountList } from "@/modules/cloud-account/components/CloudAccountList";
import type { CloudAccount } from "@/modules/cloud-account/types";
import type { TargetOperationalState } from "@/modules/cloud-account/persistence/cloud-account-settings-store";
import en from "@/localization/en";
import { get } from "lodash-es";

const mockAccounts: CloudAccount[] = [
  {
    id: "acc-app",
    provider: "google",
    email: "devon@company.com",
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
    is_active_app: true,
    is_active_classic: true,
  },
  {
    id: "acc-cli",
    provider: "google",
    email: "amber@company.com",
    token: {
      access_token: "tok",
      refresh_token: "ref",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    created_at: Date.now(),
    last_used: Date.now(),
    status: "rate_limited",
    is_active_cli: true,
    is_active_agy: true,
  },
];

let mockOperationalState: TargetOperationalState = {
  isUnifiedMode: true,
  isPhysicallyUnified: false,
  activeAccountId: "acc-app",
  targetAccounts: { app: "acc-app", ide: "", cli: "acc-cli", classic: "acc-app", agy: "acc-cli" },
  installedTargets: ["app", "cli"],
  divergedTargets: ["cli"],
};

const mockResyncMutateAsync = vi.fn();
const mockToast = vi.fn();

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

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: { grid_layout: "auto", account_sort: "recently-used" },
    saveConfig: vi.fn(),
  }),
}));

vi.mock("@/modules/cloud-account/components/CloudAccountToolbar", () => ({
  CloudAccountToolbar: () => <div data-testid="cloud-account-toolbar" />,
}));

vi.mock("@/modules/cloud-account/components/CloudAccountGrid", () => ({
  CloudAccountGrid: () => <div data-testid="cloud-account-grid" />,
}));

vi.mock("@/modules/cloud-account/components/CloudAccountBatchActionBar", () => ({
  CloudAccountBatchActionBar: () => null,
}));

vi.mock("@/modules/identity-profile/components/IdentityProfileDialog", () => ({
  IdentityProfileDialog: () => null,
}));

vi.mock("@/modules/cloud-account/hooks/useCloudAccounts", () => ({
  useWeeklyWarmupConfig: () => ({ data: undefined }),
  useCloudAccounts: () => ({
    data: mockAccounts,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCloudAccountSecurityStatus: () => ({ data: undefined }),
  useRefreshQuota: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCloudAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useAddGoogleAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useSwitchCloudAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncLocalAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useAutoSwitchEnabled: () => ({ data: true, isLoading: false }),
  useSetAutoSwitchEnabled: () => ({ mutate: vi.fn(), isPending: false }),
  useForcePollCloudMonitor: () => ({ mutate: vi.fn(), isPending: false }),
  useOAuthClients: () => ({ data: [], isLoading: false }),
  useSetActiveOAuthClient: () => ({ mutate: vi.fn(), isPending: false }),
  startAuthFlow: vi.fn(),
  useExportCloudAccounts: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportCloudAccounts: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncState: () => ({ data: mockOperationalState }),
  useResyncAllEnvironments: () => ({
    mutateAsync: mockResyncMutateAsync,
    isPending: false,
  }),
}));

describe("CloudAccountList Diverged State & Resync Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOperationalState = {
      isUnifiedMode: true,
      isPhysicallyUnified: false,
      activeAccountId: "acc-app",
      targetAccounts: { app: "acc-app", ide: "", cli: "acc-cli", classic: "acc-app", agy: "acc-cli" },
      installedTargets: ["app", "cli"],
      divergedTargets: ["cli"],
    };
  });

  it("renders diverged badge and diverged banner above grid when environments are split", () => {
    render(<CloudAccountList />);

    expect(screen.getByText("Diverged (2 Targets Split)")).toBeTruthy();
    expect(screen.getByText("Environments Desynchronized")).toBeTruthy();
    expect(
      screen.getByText(
        "Environments are running different accounts: App (devon@company.com), CLI (amber@company.com)"
      )
    ).toBeTruthy();

    const resyncBtn = screen.getByRole("button", {
      name: /Resync All Environments to devon@company.com/i,
    });
    expect(resyncBtn).toBeTruthy();
  });

  it("executes 1-click resync and triggers success toast", async () => {
    mockResyncMutateAsync.mockResolvedValueOnce({
      success: true,
      overall: "success",
      accountId: "acc-app",
    });

    render(<CloudAccountList />);

    const resyncBtn = screen.getByRole("button", {
      name: /Resync All Environments to devon@company.com/i,
    });
    fireEvent.click(resyncBtn);

    expect(mockResyncMutateAsync).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Environments Resynchronized",
        })
      );
    });
  });

  it("handles partial failure during resync with warning toast", async () => {
    mockResyncMutateAsync.mockResolvedValueOnce({
      success: true,
      overall: "partial",
      succeededTargets: ["cli"],
      failedTargets: [{ target: "app", error: "Process restart timed out" }],
    });

    render(<CloudAccountList />);

    const resyncBtn = screen.getByRole("button", {
      name: /Resync All Environments to devon@company.com/i,
    });
    fireEvent.click(resyncBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Partial Resynchronization",
        })
      );
    });
  });

  it("handles all accounts exhausted failure with destructive toast", async () => {
    mockResyncMutateAsync.mockResolvedValueOnce({
      success: false,
      reason: "all_accounts_exhausted",
    });

    render(<CloudAccountList />);

    const resyncBtn = screen.getByRole("button", {
      name: /Resync All Environments to devon@company.com/i,
    });
    fireEvent.click(resyncBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "All Accounts Rate-Limited",
          variant: "destructive",
        })
      );
    });
  });

  it("restores keyboard focus to summary container when diverged banner unmounts", async () => {
    const { rerender } = render(<CloudAccountList />);

    const summaryCard = document.getElementById("cloud-account-summary-card");
    expect(summaryCard).toBeTruthy();
    const focusSpy = vi.spyOn(summaryCard!, "focus");

    // Transition state from diverged to unified
    mockOperationalState = {
      ...mockOperationalState,
      isPhysicallyUnified: true,
      divergedTargets: [],
    };

    rerender(<CloudAccountList />);

    await waitFor(() => {
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    });
  });
});
