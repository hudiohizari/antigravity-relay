export const STANDARD_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export const ENTERPRISE_OAUTH_SCOPES = [
  ...STANDARD_OAUTH_SCOPES,
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "https://www.googleapis.com/auth/aicode",
] as const;

export const DEFAULT_OAUTH_SCOPES = STANDARD_OAUTH_SCOPES;

export function getScopesForClientId(clientId?: string): readonly string[] {
  if (clientId && clientId.trim().startsWith("1071006060591")) {
    return ENTERPRISE_OAUTH_SCOPES;
  }
  return STANDARD_OAUTH_SCOPES;
}

export function getScopeString(
  scopes: readonly string[] = DEFAULT_OAUTH_SCOPES,
): string {
  return scopes.join(" ");
}
