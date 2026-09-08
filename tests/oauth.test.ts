import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { AccountStore } from "../src/main/account-store/account-store";
import {
  OAuthLoopbackServer,
  OAuthConfig,
} from "../src/main/oauth/oauth-server";
import {
  DEFAULT_OAUTH_SCOPES,
  ENTERPRISE_OAUTH_SCOPES,
  STANDARD_OAUTH_SCOPES,
  getScopesForClientId,
  getScopeString,
} from "../src/main/oauth/oauth-scopes";
import { refreshTokenIfNeeded } from "../src/main/oauth/token-refresh";
import { GoogleAccount } from "../src/shared/types";

describe("OAuth Scopes Utilities", () => {
  it("should define standard scopes containing core identity and cloud platform permissions", () => {
    expect(STANDARD_OAUTH_SCOPES.length).toBe(4);
    expect(STANDARD_OAUTH_SCOPES).toContain("openid");
    expect(STANDARD_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/cloud-platform",
    );
    expect(STANDARD_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/userinfo.email",
    );
    expect(STANDARD_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/userinfo.profile",
    );
    expect(STANDARD_OAUTH_SCOPES).not.toContain(
      "https://www.googleapis.com/auth/aicode",
    );
  });

  it("should define enterprise scopes containing all standard scopes plus code assist internal permissions", () => {
    expect(ENTERPRISE_OAUTH_SCOPES.length).toBe(7);
    for (const scope of STANDARD_OAUTH_SCOPES) {
      expect(ENTERPRISE_OAUTH_SCOPES).toContain(scope);
    }
    expect(ENTERPRISE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/cclog",
    );
    expect(ENTERPRISE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/experimentsandconfigs",
    );
    expect(ENTERPRISE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/aicode",
    );
  });

  it("should default DEFAULT_OAUTH_SCOPES to STANDARD_OAUTH_SCOPES for unprivileged safety", () => {
    expect(DEFAULT_OAUTH_SCOPES).toEqual(STANDARD_OAUTH_SCOPES);
    expect(DEFAULT_OAUTH_SCOPES.length).toBe(4);
  });

  it("should resolve enterprise scopes for official client id prefix and standard scopes for custom or missing clients", () => {
    // Official client IDs starting with 1071006060591
    const officialId =
      "1071006060591-mock-enterprise.apps.googleusercontent.com";
    expect(getScopesForClientId(officialId)).toEqual(ENTERPRISE_OAUTH_SCOPES);
    expect(getScopesForClientId("1071006060591-custom-variant")).toEqual(
      ENTERPRISE_OAUTH_SCOPES,
    );
    expect(getScopesForClientId("  1071006060591-padded  ")).toEqual(
      ENTERPRISE_OAUTH_SCOPES,
    );

    // Custom personal Google Cloud Console client IDs
    expect(
      getScopesForClientId("9876543210-personal.apps.googleusercontent.com"),
    ).toEqual(STANDARD_OAUTH_SCOPES);
    expect(getScopesForClientId("custom-client-id")).toEqual(
      STANDARD_OAUTH_SCOPES,
    );

    // Empty or undefined client ID
    expect(getScopesForClientId(undefined)).toEqual(STANDARD_OAUTH_SCOPES);
    expect(getScopesForClientId("")).toEqual(STANDARD_OAUTH_SCOPES);
  });

  it("should format scopes into space-delimited string", () => {
    const defaultScopeStr = getScopeString();
    expect(defaultScopeStr).toBe(STANDARD_OAUTH_SCOPES.join(" "));

    const enterpriseScopeStr = getScopeString(ENTERPRISE_OAUTH_SCOPES);
    expect(enterpriseScopeStr).toBe(ENTERPRISE_OAUTH_SCOPES.join(" "));

    const custom = ["scope1", "scope2"];
    expect(getScopeString(custom)).toBe("scope1 scope2");
  });
});

describe("OAuth Loopback Server and Authentication Flow", () => {
  let tempDir: string;
  let storeFile: string;
  let store: AccountStore;

  const mockOAuthConfig: OAuthConfig = {
    clientId: "mock-client-id.apps.googleusercontent.com",
    clientSecret: "mock-client-secret",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userInfoEndpoint: "https://www.googleapis.com/oauth2/v3/userinfo",
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    store = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it("should generate valid PKCE verifier and challenge pairs", () => {
    const { verifier, challenge } = OAuthLoopbackServer.generatePkce();
    expect(typeof verifier).toBe("string");
    expect(typeof challenge).toBe("string");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge.length).toBeGreaterThan(0);
  });

  it("should generate secure random state tokens", () => {
    const s1 = OAuthLoopbackServer.generateState();
    const s2 = OAuthLoopbackServer.generateState();
    expect(s1).not.toBe(s2);
    expect(s1.length).toBe(32);
  });

  it("should reject concurrent sessions when flow is already active", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);

    const flowPromise = oauthServer.startFlow({
      openBrowser: (_url) => {},
      timeoutMs: 10_000,
    });

    expect(oauthServer.isInProgress()).toBe(true);

    // Second call should throw
    await expect(
      oauthServer.startFlow({
        openBrowser: () => {},
      }),
    ).rejects.toThrow("An OAuth session is already in progress");

    oauthServer.cancel();
    await expect(flowPromise).rejects.toThrow("OAuth flow cancelled by user");
  });

  it("should handle successful authorization code exchange and store account", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);

    let authUrlString = "";

    const mockFetch: typeof fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("/token")) {
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("client_id")).toBe(mockOAuthConfig.clientId);
        expect(body.get("client_secret")).toBe(mockOAuthConfig.clientSecret);
        expect(body.get("code")).toBe("valid-auth-code-123");
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code_verifier")).toBeDefined();

        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "new-access-token-xyz",
            refresh_token: "new-refresh-token-abc",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email profile",
            id_token: "mock-jwt-id-token",
          }),
        } as unknown as Response;
      }

      if (urlStr.includes("/userinfo")) {
        expect(init?.headers).toBeDefined();
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sub: "google-sub-999",
            email: "newuser@example.com",
            picture: "https://example.com/avatar.png",
          }),
        } as unknown as Response;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
      fetchFn: mockFetch,
    });

    // Wait until server has started and opened browser
    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;
    const state = authUrl.searchParams.get("state");

    // 1. Simulate GET /not-found route
    const notFoundRes = await makeHttpGet(`http://127.0.0.1:${port}/unknown`);
    expect(notFoundRes.statusCode).toBe(404);

    // 2. Simulate GET /callback with valid code and state
    const callbackRes = await makeHttpGet(
      `http://127.0.0.1:${port}/callback?code=valid-auth-code-123&state=${state}`,
    );
    expect(callbackRes.statusCode).toBe(200);
    expect(callbackRes.body).toContain("Authentication Complete");

    // Await flow resolution
    const createdAccount = await flowPromise;
    expect(createdAccount.id).toBe("google-sub-999");
    expect(createdAccount.email).toBe("newuser@example.com");
    expect(createdAccount.avatarUrl).toBe("https://example.com/avatar.png");
    expect(createdAccount.tokens.access_token).toBe("new-access-token-xyz");
    expect(createdAccount.tokens.refresh_token).toBe("new-refresh-token-abc");

    // Verify persisted in AccountStore
    const stored = await store.get("google-sub-999");
    expect(stored).not.toBeNull();
    expect(stored?.email).toBe("newuser@example.com");
  });

  it("should handle OAuth provider error in callback", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    let authUrlString = "";

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;

    const [, res] = await Promise.all([
      expect(flowPromise).rejects.toThrow(
        "OAuth error received from provider: access_denied",
      ),
      makeHttpGet(`http://127.0.0.1:${port}/callback?error=access_denied`),
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("access_denied");
  });

  it("should reject callback with invalid or mismatched state (CSRF defense)", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    let authUrlString = "";

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;

    const [, res] = await Promise.all([
      expect(flowPromise).rejects.toThrow(
        "State mismatch: Potential CSRF attempt detected",
      ),
      makeHttpGet(
        `http://127.0.0.1:${port}/callback?code=some-code&state=forged-state`,
      ),
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Invalid State");
  });

  it("should reject callback missing authorization code", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    let authUrlString = "";

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;
    const state = authUrl.searchParams.get("state");

    const [, res] = await Promise.all([
      expect(flowPromise).rejects.toThrow(
        "Missing authorization code in OAuth callback",
      ),
      makeHttpGet(`http://127.0.0.1:${port}/callback?state=${state}`),
    ]);

    expect(res.statusCode).toBe(400);
  });

  it("should handle token exchange network error", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    let authUrlString = "";

    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes("/token")) {
        return {
          ok: false,
          status: 400,
          text: async () => '{"error": "invalid_grant"}',
        } as unknown as Response;
      }
      throw new Error("Not reached");
    };

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
      fetchFn: mockFetch,
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;
    const state = authUrl.searchParams.get("state");

    await Promise.all([
      expect(flowPromise).rejects.toThrow("Failed to exchange token"),
      makeHttpGet(
        `http://127.0.0.1:${port}/callback?code=bad-code&state=${state}`,
      ),
    ]);
  });

  it("should handle user profile fetch failure", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    let authUrlString = "";

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "token-xyz",
            expires_in: 3600,
          }),
        } as unknown as Response;
      }
      if (urlStr.includes("/userinfo")) {
        return {
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
        } as unknown as Response;
      }
      throw new Error("Not reached");
    };

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
      fetchFn: mockFetch,
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;
    const state = authUrl.searchParams.get("state");

    await Promise.all([
      expect(flowPromise).rejects.toThrow("Failed to fetch user profile"),
      makeHttpGet(
        `http://127.0.0.1:${port}/callback?code=good-code&state=${state}`,
      ),
    ]);
  });

  it("should reject when saving account fails unexpectedly in callback", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    let authUrlString = "";

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "token-xyz", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/userinfo")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sub: "s-1", email: "e@test.com" }),
        } as unknown as Response;
      }
      throw new Error("Not reached");
    };

    vi.spyOn(store, "saveAccount").mockRejectedValueOnce(
      new Error("Disk failure"),
    );

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
      fetchFn: mockFetch,
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;
    const state = authUrl.searchParams.get("state");

    await Promise.all([
      expect(flowPromise).rejects.toThrow("Disk failure"),
      makeHttpGet(
        `http://127.0.0.1:${port}/callback?code=good-code&state=${state}`,
      ),
    ]);

    vi.restoreAllMocks();
  });

  it("should trigger timeout when user abandons OAuth flow", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    const flowPromise = oauthServer.startFlow({
      timeoutMs: 50,
    });

    await expect(flowPromise).rejects.toThrow("OAuth session timed out");
  });

  it("should reject when openBrowser throws an exception", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    const flowPromise = oauthServer.startFlow({
      openBrowser: () => {
        throw new Error("Failed to open browser");
      },
    });

    await expect(flowPromise).rejects.toThrow("Failed to open browser");
  });

  it("should reject when loopback server emits an error", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    const flowPromise = oauthServer.startFlow({
      openBrowser: () => {},
    });

    // Access private server to trigger error event
    // @ts-expect-error accessing private property for error simulation
    oauthServer.server?.emit("error", new Error("Address in use"));

    await expect(flowPromise).rejects.toThrow("Address in use");
  });

  it("should use default Google endpoints when endpoints are not provided in config", async () => {
    const minimalConfig: OAuthConfig = {
      clientId: "mock-client-id",
    };
    const oauthServer = new OAuthLoopbackServer(store, minimalConfig);
    let authUrlString = "";

    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "tok-def", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("googleapis.com/oauth2/v3/userinfo")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sub: "sub-def", email: "def@test.com" }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${urlStr}`);
    };

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        authUrlString = url;
      },
      fetchFn: mockFetch,
    });

    while (!authUrlString) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const authUrl = new URL(authUrlString);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = redirectUri.port;
    const state = authUrl.searchParams.get("state");

    await Promise.all([
      flowPromise,
      makeHttpGet(
        `http://127.0.0.1:${port}/callback?code=def-code&state=${state}`,
      ),
    ]);
  });

  it("should reject when loopback server fails to return valid address", async () => {
    const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
    vi.spyOn(http, "createServer").mockImplementationOnce(((_handler: any) => {
      const mockServer = {
        listen: (_port: any, _host: any, cb: any) => {
          cb();
          return mockServer;
        },
        address: () => null,
        close: vi.fn(),
        on: vi.fn(),
      };
      return mockServer as any;
    }) as any);

    await expect(oauthServer.startFlow()).rejects.toThrow(
      "Failed to bind loopback server",
    );
    vi.restoreAllMocks();
  });

  it("should configure authorization url with enterprise scopes for official client id", async () => {
    const officialConfig: OAuthConfig = {
      ...mockOAuthConfig,
      clientId: "1071006060591-mock-enterprise.apps.googleusercontent.com",
    };
    const oauthServer = new OAuthLoopbackServer(store, officialConfig);
    let capturedUrl = "";

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        capturedUrl = url;
      },
    });

    while (!capturedUrl) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const parsed = new URL(capturedUrl);
    const scopeParam = parsed.searchParams.get("scope") || "";

    expect(scopeParam).toContain("openid");
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/cloud-platform",
    );
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/userinfo.email",
    );
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/userinfo.profile",
    );
    expect(scopeParam).toContain("https://www.googleapis.com/auth/cclog");
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/experimentsandconfigs",
    );
    expect(scopeParam).toContain("https://www.googleapis.com/auth/aicode");

    oauthServer.cancel();
    await expect(flowPromise).rejects.toThrow("OAuth flow cancelled by user");
  });

  it("should configure authorization url with standard scopes for custom client id", async () => {
    const customConfig: OAuthConfig = {
      ...mockOAuthConfig,
      clientId: "9988776655-custom.apps.googleusercontent.com",
    };
    const oauthServer = new OAuthLoopbackServer(store, customConfig);
    let capturedUrl = "";

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        capturedUrl = url;
      },
    });

    while (!capturedUrl) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const parsed = new URL(capturedUrl);
    const scopeParam = parsed.searchParams.get("scope") || "";

    expect(scopeParam).toContain("openid");
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/cloud-platform",
    );
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/userinfo.email",
    );
    expect(scopeParam).toContain(
      "https://www.googleapis.com/auth/userinfo.profile",
    );
    expect(scopeParam).not.toContain("https://www.googleapis.com/auth/aicode");
    expect(scopeParam).not.toContain("https://www.googleapis.com/auth/cclog");
    expect(scopeParam).not.toContain(
      "https://www.googleapis.com/auth/experimentsandconfigs",
    );

    oauthServer.cancel();
    await expect(flowPromise).rejects.toThrow("OAuth flow cancelled by user");
  });

  it("should honor explicit scopes configuration over client id dynamic resolution", async () => {
    const explicitConfig: OAuthConfig = {
      ...mockOAuthConfig,
      clientId: "1071006060591-mock-enterprise.apps.googleusercontent.com",
      scopes: ["openid", "email"],
    };
    const oauthServer = new OAuthLoopbackServer(store, explicitConfig);
    let capturedUrl = "";

    const flowPromise = oauthServer.startFlow({
      openBrowser: (url) => {
        capturedUrl = url;
      },
    });

    while (!capturedUrl) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get("scope")).toBe("openid email");

    oauthServer.cancel();
    await expect(flowPromise).rejects.toThrow("OAuth flow cancelled by user");
  });
});

describe("OAuth Token Refresh", () => {
  let tempDir: string;
  let storeFile: string;
  let store: AccountStore;

  const mockOAuthConfig: OAuthConfig = {
    clientId: "mock-client-id.apps.googleusercontent.com",
    clientSecret: "mock-client-secret",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
  };

  const createTestAccount = (expiryTimestamp: number): GoogleAccount => ({
    id: "user-refresh-1",
    email: "refresh@example.com",
    status: "active",
    tokens: {
      access_token: "initial-access-token",
      refresh_token: "valid-refresh-token",
      expires_in: 3600,
      expiry_timestamp: expiryTimestamp,
      token_type: "Bearer",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-refresh-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    store = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it("should skip refresh if token has plenty of lifetime remaining", async () => {
    const account = createTestAccount(Date.now() + 1800_000); // 30 minutes left
    await store.saveAccount(account);

    const result = await refreshTokenIfNeeded(account, store, mockOAuthConfig, {
      bufferSeconds: 300,
    });

    expect(result.refreshed).toBe(false);
    expect(result.token.access_token).toBe("initial-access-token");
  });

  it("should refresh token when expiring within buffer seconds", async () => {
    const account = createTestAccount(Date.now() + 100_000); // Only 100s left (buffer is 300s)
    await store.saveAccount(account);

    const mockFetch: typeof fetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("valid-refresh-token");

      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "brand-new-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      } as unknown as Response;
    };

    const result = await refreshTokenIfNeeded(account, store, mockOAuthConfig, {
      bufferSeconds: 300,
      fetchFn: mockFetch,
    });

    expect(result.refreshed).toBe(true);
    expect(result.token.access_token).toBe("brand-new-access-token");

    // Confirm updated in store
    const stored = await store.get(account.id);
    expect(stored?.tokens.access_token).toBe("brand-new-access-token");
    expect(stored?.status).toBe("active");
  });

  it("should force refresh token when force option is true", async () => {
    const account = createTestAccount(Date.now() + 3000_000); // Plenty of time
    await store.saveAccount(account);

    const mockFetch: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "forced-refreshed-token",
          expires_in: 3600,
        }),
      }) as unknown as Response;

    const result = await refreshTokenIfNeeded(account, store, mockOAuthConfig, {
      force: true,
      fetchFn: mockFetch,
    });

    expect(result.refreshed).toBe(true);
    expect(result.token.access_token).toBe("forced-refreshed-token");
  });

  it("should throw when account lacks refresh token", async () => {
    const account = createTestAccount(Date.now() - 1000);
    account.tokens.refresh_token = "";
    await store.saveAccount(account);

    await expect(
      refreshTokenIfNeeded(account, store, mockOAuthConfig),
    ).rejects.toThrow("Account does not have a refresh token");
  });

  it("should mark account as expired when token refresh fails with invalid_grant", async () => {
    const account = createTestAccount(Date.now() - 1000);
    await store.saveAccount(account);

    const mockFetch: typeof fetch = async () =>
      ({
        ok: false,
        status: 400,
        text: async () => '{"error": "invalid_grant"}',
      }) as unknown as Response;

    await expect(
      refreshTokenIfNeeded(account, store, mockOAuthConfig, {
        fetchFn: mockFetch,
      }),
    ).rejects.toThrow("Failed to refresh token: 400");

    // Account status in store must now be 'expired'
    const stored = await store.get(account.id);
    expect(stored?.status).toBe("expired");
  });

  it("should refresh token when clientSecret is omitted from config", async () => {
    const account = createTestAccount(Date.now() - 1000);
    await store.saveAccount(account);

    const configWithoutSecret: OAuthConfig = {
      clientId: "mock-client-id.apps.googleusercontent.com",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
    };

    const mockFetch: typeof fetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_secret")).toBeNull();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "no-secret-refreshed-token",
          expires_in: 3600,
        }),
      } as unknown as Response;
    };

    const result = await refreshTokenIfNeeded(
      account,
      store,
      configWithoutSecret,
      {
        fetchFn: mockFetch,
      },
    );
    expect(result.refreshed).toBe(true);
    expect(result.token.access_token).toBe("no-secret-refreshed-token");
  });
});

function makeHttpGet(
  urlStr: string,
): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
  });
}
