import { isString } from "lodash-es";

export const RATE_LIMIT_HINTS = [
  "resource_exhausted",
  "resource exhausted",
  "resource has been exhausted",
  "quota exceeded",
  "quota_exceeded",
  "too many requests",
  "429",
  "rate limit",
  "rate-limited",
  "risk control",
  "risk-controlled",
  "frozen",
] as const;

export const OAUTH_HINTS = [
  "unauthorized_client",
  "invalid_client",
  "invalid_grant",
  "oauth client",
  "not authorized",
  "token expired",
  "reauth",
  "verify your account",
  "further action is required",
  "validation required",
  "validation_url",
  "appeal_url",
] as const;

function includesAny(text: string, hints: readonly string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

export function isRateLimitReason(reason: string): boolean {
  return includesAny(reason.toLowerCase(), RATE_LIMIT_HINTS);
}

export function isOAuthReauthReason(reason: string): boolean {
  return includesAny(reason.toLowerCase(), OAUTH_HINTS);
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isString(error)) {
    return error;
  }
  return String(error);
}

export function classifyAccountStatusFromError(
  error: unknown,
): { status: "rate_limited" | "expired"; reason: string } | null {
  const reason = extractErrorMessage(error).trim();
  if (!reason) {
    return null;
  }

  const normalizedReason = reason.toLowerCase();
  if (isRateLimitReason(normalizedReason)) {
    return { status: "rate_limited", reason };
  }
  if (isOAuthReauthReason(normalizedReason)) {
    return { status: "expired", reason };
  }

  if (normalizedReason.includes("unauthorized")) {
    return { status: "expired", reason };
  }

  return null;
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const anyErr = error as any;
  const status =
    anyErr?.status ?? anyErr?.statusCode ?? anyErr?.httpStatus ?? anyErr?.code;
  if (status === 429 || status === "429") {
    return true;
  }

  const message = extractErrorMessage(error).trim();
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();

  if (
    isOAuthReauthReason(normalized) ||
    normalized.includes("unauthorized") ||
    status === 401
  ) {
    return false;
  }

  return isRateLimitReason(normalized);
}
