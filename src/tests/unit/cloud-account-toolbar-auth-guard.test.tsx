import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloudAccountToolbar } from "@/modules/cloud-account/components/CloudAccountToolbar";
import type { OAuthClientDescriptor } from "@/modules/cloud-account/actions/cloud";
import en from "@/localization/en";
import { get } from "lodash-es";

// Polyfill ResizeObserver for Radix UI popper in jsdom
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValOrParams?: string | Record<string, unknown>) => {
      const val = get(en, key);
      if (typeof val === "string") return val;
      if (typeof defaultValOrParams === "string") return defaultValOrParams;
      return key;
    },
  }),
}));

vi.mock(
  "@/modules/cloud-account/local-import/components/LocalAccountImportDialog",
  () => ({
    LocalAccountImportDialog: () => <div data-testid="local-import-dialog" />,
  }),
);

describe("CloudAccountToolbar OAuth Credential Safeguards", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const createProps = (
    overrides?: Partial<React.ComponentProps<typeof CloudAccountToolbar>>,
  ): React.ComponentProps<typeof CloudAccountToolbar> => ({
    autoSwitchEnabled: false,
    isSettingsLoading: false,
    isSetAutoSwitchPending: false,
    isForcePollPending: false,
    isSyncPending: false,
    allVisibleSelected: false,
    selectedCount: 0,
    isExportDialogOpen: false,
    isImportDialogOpen: false,
    isAddDialogOpen: false,
    isExportPending: false,
    isImportPending: false,
    isAddPending: false,
    isOAuthClientsLoading: false,
    isSetActiveOAuthClientPending: false,
    importStrategy: "merge",
    importFileContent: null,
    importFileName: "",
    authCode: "",
    selectedOAuthClientKey: "",
    oauthClients: [],
    fileInputRef: { current: null },
    tierOptions: [],
    effectiveSelectedTierKeySet: new Set(),
    hasActiveTierFilter: false,
    tierFilterButtonLabel: "All Tiers",
    currentSort: "recently-used",
    gridLayout: "auto",
    quotaWindow: "5h",
    getTierOptionLabel: (_key, label) => label,
    onToggleAutoSwitch: vi.fn(),
    onToggleSelectAllAccounts: vi.fn(),
    onForcePoll: vi.fn(),
    onSyncLocal: vi.fn(),
    onExportDialogOpenChange: vi.fn(),
    onImportDialogOpenChange: vi.fn(),
    onAddDialogOpenChange: vi.fn(),
    onExport: vi.fn(),
    onImportFileSelect: vi.fn(),
    onImportStrategyChange: vi.fn(),
    onImport: vi.fn(),
    onOAuthClientChange: vi.fn(),
    onOpenGoogleAuthSignIn: vi.fn(),
    onAuthCodeChange: vi.fn(),
    onSubmitAuthCode: vi.fn(),
    onResetTierFilter: vi.fn(),
    onToggleTierFilter: vi.fn(),
    onSortChange: vi.fn(),
    onUpdateGridLayout: vi.fn(),
    onQuotaWindowChange: vi.fn(),
    ...overrides,
  });

  const renderComponent = (
    props: React.ComponentProps<typeof CloudAccountToolbar>,
  ) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CloudAccountToolbar {...props} />
      </QueryClientProvider>,
    );
  };

  describe("Toolbar Trigger Button Behavior", () => {
    it("renders disabled toolbar button with tooltip semantics when no clients are configured", async () => {
      const unconfiguredClients: OAuthClientDescriptor[] = [
        {
          key: "enterprise",
          label: "Enterprise OAuth",
          client_id: "",
          is_active: true,
          is_builtin: true,
          is_configured: false,
        },
      ];

      const onAddDialogOpenChange = vi.fn();
      renderComponent(
        createProps({
          oauthClients: unconfiguredClients,
          onAddDialogOpenChange,
        }),
      );

      const addAccountButton = screen.getByRole("button", {
        name: /add account/i,
      });

      expect(addAccountButton).toBeInTheDocument();
      expect(addAccountButton).toHaveAttribute("aria-disabled", "true");
      expect(addAccountButton).toHaveAttribute("tabIndex", "0");
      expect(addAccountButton).toHaveAttribute(
        "aria-describedby",
        "add-account-disabled-tooltip",
      );
      expect(addAccountButton.className).toContain("cursor-not-allowed");
      expect(addAccountButton.className).toContain("opacity-50");
      expect(addAccountButton.className).toContain("pointer-events-auto");
    });

    it("falls back to active client configuration status when selectedOAuthClientKey is empty", () => {
      const clients: OAuthClientDescriptor[] = [
        {
          key: "active-configured",
          label: "Active Configured",
          client_id: "id",
          is_active: true,
          is_builtin: false,
          is_configured: true,
        },
        {
          key: "inactive-unconfigured",
          label: "Inactive Unconfigured",
          client_id: "",
          is_active: false,
          is_builtin: true,
          is_configured: false,
        },
      ];

      renderComponent(
        createProps({
          isAddDialogOpen: true,
          oauthClients: clients,
          selectedOAuthClientKey: "", // empty, should fall back to active client
          authCode: "4/valid-code",
        }),
      );

      // Active client is configured, so no alert banner should appear
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Open Login Page should be enabled
      expect(
        screen.getByRole("button", { name: /open login page/i }),
      ).toBeEnabled();

      // Auth code input should be enabled
      expect(
        screen.getByPlaceholderText(/paste the code starting with 4\/\.\.\./i),
      ).toBeEnabled();

      // Verify button should be enabled
      expect(
        screen.getByRole("button", { name: /verify & add/i }),
      ).toBeEnabled();
    });

    it("prevents click and keydown activation on disabled toolbar button", () => {
      const unconfiguredClients: OAuthClientDescriptor[] = [
        {
          key: "enterprise",
          label: "Enterprise OAuth",
          client_id: "",
          is_active: true,
          is_builtin: true,
          is_configured: false,
        },
      ];

      const onAddDialogOpenChange = vi.fn();
      renderComponent(
        createProps({
          oauthClients: unconfiguredClients,
          onAddDialogOpenChange,
        }),
      );

      const addAccountButton = screen.getByRole("button", {
        name: /add account/i,
      });

      // Click should be intercepted and prevented
      fireEvent.click(addAccountButton);
      expect(onAddDialogOpenChange).not.toHaveBeenCalled();

      // Enter key should be intercepted and prevented
      fireEvent.keyDown(addAccountButton, { key: "Enter", code: "Enter" });
      expect(onAddDialogOpenChange).not.toHaveBeenCalled();

      // Space key should be intercepted and prevented
      fireEvent.keyDown(addAccountButton, { key: " ", code: "Space" });
      expect(onAddDialogOpenChange).not.toHaveBeenCalled();
    });

    it("renders enabled toolbar button that opens dialog when at least one client is configured", () => {
      const configuredClients: OAuthClientDescriptor[] = [
        {
          key: "custom",
          label: "Custom OAuth",
          client_id: "configured-id",
          is_active: true,
          is_builtin: false,
          is_configured: true,
        },
      ];

      const onAddDialogOpenChange = vi.fn();
      renderComponent(
        createProps({
          oauthClients: configuredClients,
          onAddDialogOpenChange,
        }),
      );

      const addAccountButton = screen.getByRole("button", {
        name: /add account/i,
      });

      expect(addAccountButton).toBeInTheDocument();
      expect(addAccountButton).not.toHaveAttribute("aria-disabled", "true");
      expect(addAccountButton.className).toContain("cursor-pointer");
      expect(addAccountButton.className).not.toContain("cursor-not-allowed");

      // Clicking invokes DialogTrigger which triggers dialog state change
      fireEvent.click(addAccountButton);
      expect(onAddDialogOpenChange).toHaveBeenCalledWith(true);
    });

    it("treats empty oauthClients list as unconfigured", () => {
      const onAddDialogOpenChange = vi.fn();
      renderComponent(
        createProps({
          oauthClients: [],
          onAddDialogOpenChange,
        }),
      );

      const addAccountButton = screen.getByRole("button", {
        name: /add account/i,
      });

      expect(addAccountButton).toHaveAttribute("aria-disabled", "true");
      expect(addAccountButton.className).toContain("cursor-not-allowed");

      fireEvent.click(addAccountButton);
      expect(onAddDialogOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("In-Dialog Safeguards and Action Locks", () => {
    it("renders alert banner and disables action buttons when selected client is unconfigured", () => {
      const clients: OAuthClientDescriptor[] = [
        {
          key: "enterprise",
          label: "Enterprise Client",
          client_id: "",
          is_active: true,
          is_builtin: true,
          is_configured: false,
        },
      ];

      renderComponent(
        createProps({
          isAddDialogOpen: true,
          oauthClients: clients,
          selectedOAuthClientKey: "enterprise",
          authCode: "test-auth-code",
        }),
      );

      // Alert banner should be rendered
      const alertBanner = screen.getByRole("alert");
      expect(alertBanner).toBeInTheDocument();
      expect(alertBanner).toHaveAttribute("aria-live", "polite");
      expect(alertBanner.textContent).toContain(
        "OAuth environment variables are not configured. Adding accounts is unavailable.",
      );

      // Open Login Page button disabled
      const openLoginButton = screen.getByRole("button", {
        name: /open login page/i,
      });
      expect(openLoginButton).toBeDisabled();

      // Auth code input disabled
      const authCodeInput = screen.getByPlaceholderText(
        /paste the code starting with 4\/\.\.\./i,
      );
      expect(authCodeInput).toBeDisabled();

      // Verify & Add button disabled
      const verifyButton = screen.getByRole("button", {
        name: /verify & add/i,
      });
      expect(verifyButton).toBeDisabled();
    });

    it("displays warning banner when multi-client has unconfigured selected client", () => {
      const clients: OAuthClientDescriptor[] = [
        {
          key: "configured-key",
          label: "Configured Client",
          client_id: "configured-id",
          is_active: false,
          is_builtin: false,
          is_configured: true,
        },
        {
          key: "unconfigured-key",
          label: "Unconfigured Client",
          client_id: "",
          is_active: true,
          is_builtin: true,
          is_configured: false,
        },
      ];

      renderComponent(
        createProps({
          isAddDialogOpen: true,
          oauthClients: clients,
          selectedOAuthClientKey: "unconfigured-key",
        }),
      );

      const alertBanner = screen.getByRole("alert");
      expect(alertBanner).toBeInTheDocument();
      expect(alertBanner.textContent).toContain(
        "Selected OAuth client is not configured.",
      );

      const openLoginButton = screen.getByRole("button", {
        name: /open login page/i,
      });
      expect(openLoginButton).toBeDisabled();
    });

    it("dynamically re-enables in-dialog actions when switching from unconfigured to configured client", () => {
      const clients: OAuthClientDescriptor[] = [
        {
          key: "unconfigured-key",
          label: "Unconfigured Client",
          client_id: "",
          is_active: true,
          is_builtin: true,
          is_configured: false,
        },
        {
          key: "configured-key",
          label: "Configured Client",
          client_id: "valid-id",
          is_active: false,
          is_builtin: false,
          is_configured: true,
        },
      ];

      // Initial render with unconfigured client selected
      const { rerender } = renderComponent(
        createProps({
          isAddDialogOpen: true,
          oauthClients: clients,
          selectedOAuthClientKey: "unconfigured-key",
          authCode: "4/abc123code",
        }),
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /open login page/i }),
      ).toBeDisabled();
      expect(
        screen.getByPlaceholderText(/paste the code starting with 4\/\.\.\./i),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: /verify & add/i }),
      ).toBeDisabled();

      // Rerender switching selectedOAuthClientKey to configured client
      rerender(
        <QueryClientProvider client={queryClient}>
          <CloudAccountToolbar
            {...createProps({
              isAddDialogOpen: true,
              oauthClients: clients,
              selectedOAuthClientKey: "configured-key",
              authCode: "4/abc123code",
            })}
          />
        </QueryClientProvider>,
      );

      // Alert banner should be dismissed
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Open Login Page should be enabled
      expect(
        screen.getByRole("button", { name: /open login page/i }),
      ).toBeEnabled();

      // Auth code input should be enabled
      expect(
        screen.getByPlaceholderText(/paste the code starting with 4\/\.\.\./i),
      ).toBeEnabled();

      // Verify button should be enabled since authCode is provided
      expect(
        screen.getByRole("button", { name: /verify & add/i }),
      ).toBeEnabled();
    });

    it("keeps verify button disabled if auth code is empty even when client is configured", () => {
      const clients: OAuthClientDescriptor[] = [
        {
          key: "configured-key",
          label: "Configured Client",
          client_id: "valid-id",
          is_active: true,
          is_builtin: false,
          is_configured: true,
        },
      ];

      renderComponent(
        createProps({
          isAddDialogOpen: true,
          oauthClients: clients,
          selectedOAuthClientKey: "configured-key",
          authCode: "",
        }),
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /open login page/i }),
      ).toBeEnabled();
      expect(
        screen.getByPlaceholderText(/paste the code starting with 4\/\.\.\./i),
      ).toBeEnabled();
      // Disabled because authCode is empty
      expect(
        screen.getByRole("button", { name: /verify & add/i }),
      ).toBeDisabled();
    });

    it("renders unconfigured badge in select dropdown for unconfigured clients", () => {
      const clients: OAuthClientDescriptor[] = [
        {
          key: "configured-client",
          label: "Configured Client",
          client_id: "valid-id",
          is_active: false,
          is_builtin: false,
          is_configured: true,
        },
        {
          key: "unconfigured-client",
          label: "Unconfigured Client",
          client_id: "",
          is_active: true,
          is_builtin: true,
          is_configured: false,
        },
      ];

      renderComponent(
        createProps({
          isAddDialogOpen: true,
          oauthClients: clients,
          selectedOAuthClientKey: "configured-client",
        }),
      );

      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);

      const unconfiguredBadges = screen.getAllByText(/unconfigured/i);
      expect(unconfiguredBadges.length).toBeGreaterThan(0);
    });
  });
});
