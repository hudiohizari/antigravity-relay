import crypto from "node:crypto";

export interface AuthRateLimiterOptions {
  maxAttempts?: number;
  windowMs?: number;
}

export class AuthRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private attempts: Map<string, { count: number; firstAttemptAt: number }> =
    new Map();

  constructor(options?: AuthRateLimiterOptions) {
    this.maxAttempts = options?.maxAttempts ?? 5;
    this.windowMs = options?.windowMs ?? 60000;
  }

  public isRateLimited(ip: string): boolean {
    const record = this.attempts.get(ip);
    if (!record) {
      return false;
    }

    const now = Date.now();
    if (now - record.firstAttemptAt > this.windowMs) {
      this.attempts.delete(ip);
      return false;
    }

    return record.count >= this.maxAttempts;
  }

  public recordFailure(ip: string): void {
    const now = Date.now();
    const record = this.attempts.get(ip);

    if (!record || now - record.firstAttemptAt > this.windowMs) {
      this.attempts.set(ip, { count: 1, firstAttemptAt: now });
    } else {
      record.count += 1;
    }
  }

  public recordSuccess(ip: string): void {
    this.attempts.delete(ip);
  }

  public reset(ip?: string): void {
    if (ip) {
      this.attempts.delete(ip);
    } else {
      this.attempts.clear();
    }
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function generatePairingKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }

  const trimmed = authHeader.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (match) {
    return match[1].trim();
  }

  return trimmed.length > 0 ? trimmed : null;
}

export function extractTokenFromQuery(urlOrQuery: string): {
  token?: string;
  pair?: string;
} {
  const queryString = urlOrQuery.includes("?")
    ? urlOrQuery.split("?")[1]
    : urlOrQuery;
  const params = new URLSearchParams(queryString);
  const token = params.get("token") || undefined;
  const pair = params.get("pair") || undefined;
  return { token, pair };
}

export function validateToken(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
