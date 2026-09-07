export const DEFAULT_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export function getScopeString(
  scopes: readonly string[] = DEFAULT_OAUTH_SCOPES,
): string {
  return scopes.join(" ");
}
