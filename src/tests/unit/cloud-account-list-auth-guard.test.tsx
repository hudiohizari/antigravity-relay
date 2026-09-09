import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloudAccountList } from "@/modules/cloud-account/components/CloudAccountList";
import type { OAuthClientDescriptor } from "@/modules/cloud-account/actions/cloud";
import en from "@/localization/en";
import { get } from "lodash-es";

const mockStartAuthFlow = vi.fn();
const mockAddMutate = vi.fn();
let mockOAuthClients: OAuthClientDescriptor[] = [];

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

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: { accountGridCols: "auto" },
    saveConfig: vi.fn(),
  }),
}));

vi.mock(
  "@/modules/cloud-account/local-import/components/LocalAccountImportDialog",
  () => ({
    LocalAccountImportDialog: () => <div data-testid="local-import-dialog" />,
  }),
);

vi.mock("@/modules/cloud-account/components/CloudAccountGrid", () => ({
  CloudAccountGrid: () => <div data-testid="cloud-account-grid" />,
}));

vi.mock(
  "@/modules/cloud-account/components/CloudAccountBatchActionBar",
  () => ({
    CloudAccountBatchActionBar: () => null,
  }),
);

vi.mock("@/modules/cloud-account/components/CloudAccountListSummary", () => ({
  CloudAccountListSummary: () => null,
}));

vi.mock("@/modules/identity-profile/components/IdentityProfileDialog", () => ({
  IdentityProfileDialog: () => null,
}));

let capturedToolbarProps: any = null;
vi.mock("@/modules/cloud-account/components/CloudAccountToolbar", () => ({
  CloudAccountToolbar: (props: any) => {
    capturedToolbarProps = props;
    return <div data-testid="cloud-account-toolbar" />;
  },
}));

vi.mock("@/modules/cloud-account/hooks/useCloudAccounts", () => ({
  useWeeklyWarmupConfig: () => ({ data: undefined }),
  useCloudAccounts: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCloudAccountSecurityStatus: () => ({ data: undefined }),
  useRefreshQuota: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCloudAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useAddGoogleAccount: () => ({ mutate: mockAddMutate, isPending: false }),
  useSwitchCloudAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncLocalAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useAutoSwitchEnabled: () => ({ data: false, isLoading: false }),
  useSetAutoSwitchEnabled: () => ({ mutate: vi.fn(), isPending: false }),
  useForcePollCloudMonitor: () => ({ mutate: vi.fn(), isPending: false }),
  useOAuthClients: () => ({
    data: mockOAuthClients,
    isLoading: false,
  }),
  useSetActiveOAuthClient: () => ({ mutate: vi.fn(), isPending: false }),
  startAuthFlow: (...args: unknown[]) => mockStartAuthFlow(...args),
  useExportCloudAccounts: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useImportCloudAccounts: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("CloudAccountList OAuth Client Guards", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedToolbarProps = null;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it("blocks openGoogleAuthSignIn when selected client is unconfigured", async () => {
    mockOAuthClients = [
      {
        key: "unconfigured-key",
        label: "Unconfigured Client",
        client_id: "",
        is_active: true,
        is_builtin: true,
        is_configured: false,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <CloudAccountList />
      </QueryClientProvider>,
    );

    expect(capturedToolbarProps).not.toBeNull();

    // Trigger openGoogleAuthSignIn handler
    await act(async () => {
      await capturedToolbarProps.onOpenGoogleAuthSignIn();
    });

    // Guard should prevent startAuthFlow call
    expect(mockStartAuthFlow).not.toHaveBeenCalled();
  });

  it("blocks submitAuthCode when selected client is unconfigured", () => {
    mockOAuthClients = [
      {
        key: "unconfigured-key",
        label: "Unconfigured Client",
        client_id: "",
        is_active: true,
        is_builtin: true,
        is_configured: false,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <CloudAccountList />
      </QueryClientProvider>,
    );

    expect(capturedToolbarProps).not.toBeNull();

    // Trigger submitAuthCode handler with valid code format
    act(() => {
      capturedToolbarProps.onAuthCodeChange("4/dummy-code");
      capturedToolbarProps.onSubmitAuthCode();
    });

    // Guard should prevent addMutation.mutate call
    expect(mockAddMutate).not.toHaveBeenCalled();
  });

  it("allows openGoogleAuthSignIn when selected client is configured", async () => {
    mockOAuthClients = [
      {
        key: "configured-key",
        label: "Configured Client",
        client_id: "configured-id",
        is_active: true,
        is_builtin: false,
        is_configured: true,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <CloudAccountList />
      </QueryClientProvider>,
    );

    expect(capturedToolbarProps).not.toBeNull();

    await act(async () => {
      await capturedToolbarProps.onOpenGoogleAuthSignIn();
    });

    expect(mockStartAuthFlow).toHaveBeenCalledWith({
      oauthClientKey: "configured-key",
    });
  });

  it("allows submitAuthCode when selected client is configured", () => {
    mockOAuthClients = [
      {
        key: "configured-key",
        label: "Configured Client",
        client_id: "configured-id",
        is_active: true,
        is_builtin: false,
        is_configured: true,
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <CloudAccountList />
      </QueryClientProvider>,
    );

    expect(capturedToolbarProps).not.toBeNull();

    act(() => {
      capturedToolbarProps.onAuthCodeChange("4/valid-auth-code");
    });

    act(() => {
      capturedToolbarProps.onSubmitAuthCode();
    });

    expect(mockAddMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        authCode: "4/valid-auth-code",
        oauthClientKey: "configured-key",
      }),
      expect.any(Object),
    );
  });
});
