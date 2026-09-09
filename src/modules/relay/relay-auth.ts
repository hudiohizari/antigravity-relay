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

  public static buildKey(ip: string, deviceId?: string): string {
    return deviceId ? `${ip}:${deviceId}` : ip;
  }

  public isRateLimited(keyOrIp: string, deviceId?: string): boolean {
    const key = deviceId ? `${keyOrIp}:${deviceId}` : keyOrIp;
    const record = this.attempts.get(key);
    if (!record) {
      return false;
    }

    const now = Date.now();
    if (now - record.firstAttemptAt > this.windowMs) {
      this.attempts.delete(key);
      return false;
    }

    return record.count >= this.maxAttempts;
  }

  public recordFailure(keyOrIp: string, deviceId?: string): void {
    const key = deviceId ? `${keyOrIp}:${deviceId}` : keyOrIp;
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || now - record.firstAttemptAt > this.windowMs) {
      this.attempts.set(key, { count: 1, firstAttemptAt: now });
    } else {
      record.count += 1;
    }
  }

  public recordSuccess(keyOrIp: string, deviceId?: string): void {
    const key = deviceId ? `${keyOrIp}:${deviceId}` : keyOrIp;
    this.attempts.delete(key);
  }

  public reset(keyOrIp?: string, deviceId?: string): void {
    if (keyOrIp) {
      const key = deviceId ? `${keyOrIp}:${deviceId}` : keyOrIp;
      this.attempts.delete(key);
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
