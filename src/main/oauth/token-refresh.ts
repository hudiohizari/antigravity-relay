import { GoogleAccount, TokenData } from "../../shared/types";
import { AccountStore } from "../account-store/account-store";
import { OAuthConfig } from "./oauth-server";

export interface TokenRefreshOptions {
  force?: boolean;
  bufferSeconds?: number;
  fetchFn?: typeof fetch;
}

export interface RefreshResult {
  refreshed: boolean;
  token: TokenData;
}

export async function refreshTokenIfNeeded(
  account: GoogleAccount,
  store: AccountStore,
  config: OAuthConfig,
  options: TokenRefreshOptions = {},
): Promise<RefreshResult> {
  const bufferMs = (options.bufferSeconds ?? 300) * 1000;
  const now = Date.now();
  const timeRemaining = account.tokens.expiry_timestamp - now;

  if (!options.force && timeRemaining > bufferMs) {
    return {
      refreshed: false,
      token: account.tokens,
    };
  }

  if (!account.tokens.refresh_token) {
    throw new Error("Account does not have a refresh token");
  }

  const fetchImpl = options.fetchFn || fetch;
  const tokenEndpoint =
    config.tokenEndpoint || "https://oauth2.googleapis.com/token";

  const bodyParams: Record<string, string> = {
    client_id: config.clientId,
    refresh_token: account.tokens.refresh_token,
    grant_type: "refresh_token",
  };

  if (config.clientSecret) {
    bodyParams.client_secret = config.clientSecret;
  }

  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(bodyParams).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // If token was revoked or invalid, mark account as expired
    const current = await store.get(account.id);
    if (current) {
      current.status = "expired";
      current.updatedAt = Date.now();
      await store.saveAccount(current);
    }
    throw new Error(`Failed to refresh token: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
    id_token?: string;
    refresh_token?: string;
  };

  const updatedTokens: TokenData = {
    ...account.tokens,
    access_token: data.access_token,
    expires_in: data.expires_in,
    expiry_timestamp: Date.now() + data.expires_in * 1000,
    token_type: data.token_type || account.tokens.token_type,
    scope: data.scope || account.tokens.scope,
    id_token: data.id_token || account.tokens.id_token,
    refresh_token: data.refresh_token || account.tokens.refresh_token,
  };

  await store.updateTokens(account.id, updatedTokens);

  return {
    refreshed: true,
    token: updatedTokens,
  };
}
