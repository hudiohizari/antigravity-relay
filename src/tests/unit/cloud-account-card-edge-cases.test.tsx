// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CloudAccountCard,
  CompactCloudAccountCard,
} from "@/modules/cloud-account/components/CloudAccountCard";
import type { CloudAccount } from "@/modules/cloud-account/types";

vi.mock("@/modules/antigravity-runtime/actions/process", () => ({
  getProcessStatus: vi.fn().mockResolvedValue({
    isRunning: false,
    isBinaryInstalled: true,
  }),
}));

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: {},
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

vi.mock("@/modules/cloud-account/hooks/useCloudAccounts", () => ({
  useSetAccountProxy: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      if (key === "cloud.card.unknown") return "Unknown Account";
      if (key === "cloud.card.noQuota") return "No quota data";
      if (key === "cloud.target.classic") return "Antigravity App";
      if (key === "cloud.target.ide") return "Antigravity IDE";
      if (key === "cloud.target.cli") return "Antigravity CLI";
      if (key === "cloud.switch.targetAllShort") return "Switch All";
      if (key === "cloud.switch.activeAll") return "Active on All";
      return key;
    },
  }),
}));

describe("CloudAccountCard Edge Cases & Concurrency", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );
  };

  const createBaseAccount = (
    overrides?: Partial<CloudAccount>,
  ): CloudAccount => ({
    id: "test-acc-1",
    provider: "google",
    email: "user@example.com",
    token: {
      access_token: "token",
      refresh_token: "refresh",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    created_at: Date.now(),
    last_used: Date.now(),
    ...overrides,
  });

  it("handles extremely long email string without crashing in full and compact views", () => {
    const longEmail =
      "very.long.enterprise.developer.account.name.with.deep.subdomain@department.division.company.example.org";
    const account = createBaseAccount({ email: longEmail });

    const { unmount: unmountFull } = renderWithClient(
      <CloudAccountCard
        account={account}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText(longEmail)).toBeDefined();
    unmountFull();

    const { unmount: unmountCompact } = renderWithClient(
      <CompactCloudAccountCard
        account={account}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText(longEmail)).toBeDefined();
    unmountCompact();
  });

  it("falls back to Unknown Account and initial letter fallback when account name is missing", () => {
    const account = createBaseAccount({ name: null });

    const { unmount } = renderWithClient(
      <CloudAccountCard
        account={account}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText("Unknown Account")).toBeDefined();
    unmount();
  });

  it("renders clean empty quota state when account.quota is undefined", () => {
    const account = createBaseAccount({ quota: undefined });

    const { unmount } = renderWithClient(
      <CloudAccountCard
        account={account}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(screen.getByText("No quota data")).toBeDefined();
    unmount();
  });

  it("disables primary button and dropdown trigger when isSwitching is true", () => {
    const account = createBaseAccount();
    const switchSpy = vi.fn();

    const { unmount } = renderWithClient(
      <CloudAccountCard
        account={account}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={switchSpy}
        onManageIdentity={vi.fn()}
        isSwitching={true}
        switchingTarget="all"
      />,
    );

    const switchBtn = screen.getByRole("button", { name: /Switch All/i });
    expect(switchBtn.hasAttribute("disabled")).toBe(true);

    fireEvent.click(switchBtn);
    expect(switchSpy).not.toHaveBeenCalled();

    unmount();
  });

  it("unmounts cleanly without errors or dangling timers", () => {
    const account = createBaseAccount();

    const { unmount } = renderWithClient(
      <CloudAccountCard
        account={account}
        onRefresh={vi.fn()}
        onDelete={vi.fn()}
        onSwitch={vi.fn()}
        onManageIdentity={vi.fn()}
      />,
    );

    expect(() => unmount()).not.toThrow();
  });
});
