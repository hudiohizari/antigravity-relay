import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  OAuthClientRegistryService,
  resetRegistryCache,
  isClientConfigured,
  hasAnyConfiguredClient,
} from "@/modules/cloud-account/services/OAuthClientRegistryService";
import { GoogleAPIService } from "@/modules/cloud-account/services/GoogleAPIService";
import {
  startAuthFlow,
  addGoogleAccount,
} from "@/modules/cloud-account/ipc/handler";
import { shell } from "electron";

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-settings-store",
  () => ({
    CloudAccountSettingsStore: {
      getSetting: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      setSetting: vi.fn(),
    },
  }),
);

describe("OAuthClientRegistryService & Configuration Safeguards", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetRegistryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRegistryCache();
    vi.restoreAllMocks();
  });

  describe("Unconfigured enterprise client", () => {
    it("marks enterprise client as is_configured: false when env vars are unset", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENTS", "");
      resetRegistryCache();

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients).toHaveLength(1);
      expect(clients[0]).toMatchObject({
        key: "antigravity_enterprise",
        label: "Antigravity Enterprise",
        is_builtin: true,
        is_active: true,
        is_configured: false,
      });
      // Ensure client_secret is never exposed in the descriptor
      expect(clients[0]).not.toHaveProperty("client_secret");

      expect(OAuthClientRegistryService.isClientConfigured()).toBe(false);
      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(false);
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);
      expect(isClientConfigured()).toBe(false);
      expect(hasAnyConfiguredClient()).toBe(false);
    });

    it("marks enterprise client as is_configured: false when env vars contain only whitespace", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "   ");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "   \t  ");
      resetRegistryCache();

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients[0]?.is_configured).toBe(false);
      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(false);
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);
    });

    it("marks enterprise client as is_configured: false when only client_id is set but secret is missing", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "test-client-id");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      resetRegistryCache();

      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(false);
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);
    });

    it("marks enterprise client as is_configured: false when only client_secret is set but id is missing", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "test-client-secret");
      resetRegistryCache();

      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(false);
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);
    });
  });

  describe("Configured enterprise client", () => {
    it("marks enterprise client as is_configured: true when both id and secret are non-empty", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "test-enterprise-id");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "test-enterprise-secret");
      resetRegistryCache();

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients).toHaveLength(1);
      expect(clients[0]).toMatchObject({
        key: "antigravity_enterprise",
        client_id: "test-enterprise-id",
        is_builtin: true,
        is_active: true,
        is_configured: true,
      });
      // Sensitive secret must remain unexposed
      expect(clients[0]).not.toHaveProperty("client_secret");

      expect(OAuthClientRegistryService.isClientConfigured()).toBe(true);
      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(true);
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(true);
      expect(isClientConfigured()).toBe(true);
      expect(hasAnyConfiguredClient()).toBe(true);
    });
  });

  describe("Dynamic env reading & resetRegistryCache()", () => {
    it("dynamically reads updated env vars after resetRegistryCache() without module reload", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      resetRegistryCache();

      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);

      // Mutate env
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "dynamic-id");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "dynamic-secret");

      // Before cache reset, cached value persists
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);

      // After cache reset, dynamic values are picked up immediately
      resetRegistryCache();
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(true);
      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(true);
      expect(OAuthClientRegistryService.listOAuthClients()[0]?.client_id).toBe(
        "dynamic-id",
      );

      // Clear env again
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      resetRegistryCache();
      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(false);
      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(false);
    });
  });

  describe("startAuthFlow fail-fast error when unconfigured", () => {
    it("throws error and does not call shell.openExternal when enterprise client is unconfigured", async () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENTS", "");
      resetRegistryCache();

      await expect(startAuthFlow()).rejects.toThrow(
        /OAuth client "antigravity_enterprise" is not configured\. Both client_id and client_secret must be set\./,
      );
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it("throws error and does not call shell.openExternal when specific client is unconfigured", async () => {
      vi.stubEnv(
        "ANTIGRAVITY_OAUTH_CLIENTS",
        "custom_unconfigured|valid-id||Custom Unconfigured",
      );
      resetRegistryCache();

      await expect(startAuthFlow("custom_unconfigured")).rejects.toThrow(
        /OAuth client "custom_unconfigured" is not configured\. Both client_id and client_secret must be set\./,
      );
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it("succeeds and calls shell.openExternal when target client is configured", async () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "enterprise-id");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "enterprise-secret");
      resetRegistryCache();

      await startAuthFlow();
      expect(shell.openExternal).toHaveBeenCalledOnce();
      const calledUrl = vi.mocked(shell.openExternal).mock
        .calls[0]?.[0] as string;
      expect(calledUrl).toContain("client_id=enterprise-id");
    });
  });

  describe("exchangeCode and getAuthUrl fail-fast error when unconfigured", () => {
    it("GoogleAPIService.getAuthUrl throws error when target client is unconfigured", () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      resetRegistryCache();

      expect(() => GoogleAPIService.getAuthUrl()).toThrow(
        /OAuth client "antigravity_enterprise" is not configured\. Both client_id and client_secret must be set\./,
      );
    });

    it("GoogleAPIService.exchangeCode throws error when no configured clients exist", async () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENTS", "");
      resetRegistryCache();

      await expect(
        GoogleAPIService.exchangeCode("test-auth-code"),
      ).rejects.toThrow(
        "No configured OAuth clients available for token exchange.",
      );
    });

    it("GoogleAPIService.exchangeCode throws fail-fast error when specific unconfigured client requested", async () => {
      vi.stubEnv(
        "ANTIGRAVITY_OAUTH_CLIENTS",
        "valid_client|valid-id|valid-secret|Valid;unconfigured_client|unconf-id||Unconfigured",
      );
      resetRegistryCache();

      await expect(
        GoogleAPIService.exchangeCode("test-auth-code", "unconfigured_client"),
      ).rejects.toThrow(
        /OAuth client "unconfigured_client" is not configured\. Both client_id and client_secret must be set\./,
      );
    });

    it("addGoogleAccount throws fail-fast error when unconfigured without calling network", async () => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENTS", "");
      resetRegistryCache();

      await expect(addGoogleAccount("test-auth-code")).rejects.toThrow(
        "No configured OAuth clients available. Both client_id and client_secret must be set.",
      );

      await expect(
        addGoogleAccount("test-auth-code", "nonexistent_or_unconfigured"),
      ).rejects.toThrow(
        /OAuth client "nonexistent_or_unconfigured" is not configured/,
      );
    });
  });

  describe("Multi-client scenario (one configured, one unconfigured)", () => {
    beforeEach(() => {
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "");
      vi.stubEnv(
        "ANTIGRAVITY_OAUTH_CLIENTS",
        "custom_configured|conf-id|conf-secret|Configured Client;custom_unconfigured|unconf-id||Unconfigured Client",
      );
      resetRegistryCache();
    });

    it("accurately distinguishes configured and unconfigured clients in registry", () => {
      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients).toHaveLength(3);

      const enterprise = clients.find(
        (c) => c.key === "antigravity_enterprise",
      );
      const configured = clients.find((c) => c.key === "custom_configured");
      const unconfigured = clients.find((c) => c.key === "custom_unconfigured");

      expect(enterprise?.is_configured).toBe(false);
      expect(configured?.is_configured).toBe(true);
      expect(unconfigured?.is_configured).toBe(false);

      expect(OAuthClientRegistryService.hasAnyConfiguredClient()).toBe(true);
      expect(
        OAuthClientRegistryService.isClientConfigured("custom_configured"),
      ).toBe(true);
      expect(
        OAuthClientRegistryService.isClientConfigured("custom_unconfigured"),
      ).toBe(false);
      expect(
        OAuthClientRegistryService.isClientConfigured("antigravity_enterprise"),
      ).toBe(false);
    });

    it("allows getAuthUrl for configured client and rejects unconfigured client", () => {
      const configuredUrl = GoogleAPIService.getAuthUrl("custom_configured");
      expect(configuredUrl).toContain("client_id=conf-id");

      expect(() => GoogleAPIService.getAuthUrl("custom_unconfigured")).toThrow(
        /OAuth client "custom_unconfigured" is not configured/,
      );
    });

    it("allows startAuthFlow for configured client and rejects unconfigured client", async () => {
      await expect(startAuthFlow("custom_unconfigured")).rejects.toThrow(
        /OAuth client "custom_unconfigured" is not configured/,
      );
      expect(shell.openExternal).not.toHaveBeenCalled();

      await startAuthFlow("custom_configured");
      expect(shell.openExternal).toHaveBeenCalledOnce();
      expect(vi.mocked(shell.openExternal).mock.calls[0]?.[0]).toContain(
        "client_id=conf-id",
      );
    });

    it("filters candidates to only configured clients during candidate selection for exchange", () => {
      const candidates =
        OAuthClientRegistryService.getCandidateClients("custom_configured");
      const configuredOnly = candidates.filter(
        (c) => c.client_id.trim() !== "" && c.client_secret.trim() !== "",
      );
      expect(configuredOnly).toHaveLength(1);
      expect(configuredOnly[0]?.key).toBe("custom_configured");
    });
  });

  describe("Zod Schema Output Validation", () => {
    it("verifies listOAuthClients output conforms to schema with is_configured: z.boolean()", () => {
      const schema = z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          client_id: z.string(),
          is_active: z.boolean(),
          is_builtin: z.boolean(),
          is_configured: z.boolean(),
        }),
      );

      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_ID", "test-id");
      vi.stubEnv("ANTIGRAVITY_OAUTH_CLIENT_SECRET", "test-secret");
      resetRegistryCache();

      const clients = OAuthClientRegistryService.listOAuthClients();
      const parseResult = schema.safeParse(clients);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data?.[0]?.is_configured).toBe(true);
    });
  });
});
