import { RateLimitReason, RateLimitState } from "./types";

export interface RateLimitTrackerOptions {
  defaultCooldownMs?: number;
  maxRetryExponent?: number;
}

export class RateLimitTracker {
  private states: Map<string, RateLimitState> = new Map();
  private defaultCooldownMs: number;
  private readonly maxRetryExponent: number;
  private listeners: Set<(state: RateLimitState) => void> = new Set();

  constructor(options: RateLimitTrackerOptions = {}) {
    this.defaultCooldownMs = options.defaultCooldownMs ?? 900000; // 15 minutes default
    this.maxRetryExponent = options.maxRetryExponent ?? 5; // Cap at 2^5 = 32x
  }

  public getCooldownDuration(): number {
    return this.defaultCooldownMs;
  }

  public setCooldownDuration(ms: number): void {
    if (ms <= 0) {
      throw new Error("Cooldown duration must be positive");
    }
    this.defaultCooldownMs = ms;
  }

  public onRateLimitChanged(
    callback: (state: RateLimitState) => void,
  ): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(state: RateLimitState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Suppress listener callback errors
      }
    }
  }

  public recordRateLimit(
    accountId: string,
    reason: RateLimitReason = "http_429",
    lastErrorStatus = 429,
    customCooldownMs?: number,
  ): RateLimitState {
    const existing = this.states.get(accountId);
    const retryCount = (existing?.retryCount ?? 0) + 1;
    const now = Date.now();

    const baseCooldown = customCooldownMs ?? this.defaultCooldownMs;
    const exponent = Math.min(retryCount - 1, this.maxRetryExponent);
    const multiplier = Math.pow(2, exponent);
    const cooldownDuration = baseCooldown * multiplier;

    const state: RateLimitState = {
      accountId,
      isRateLimited: true,
      limitedAt: now,
      cooldownUntil: now + cooldownDuration,
      reason,
      retryCount,
      lastErrorStatus,
    };

    this.states.set(accountId, state);
    this.notifyListeners(state);
    return state;
  }

  public clearRateLimit(accountId: string): void {
    const existing = this.states.get(accountId);
    if (!existing) {
      return;
    }

    const cleared: RateLimitState = {
      ...existing,
      isRateLimited: false,
      cooldownUntil: Date.now(),
      retryCount: 0,
    };

    this.states.set(accountId, cleared);
    this.notifyListeners(cleared);
  }

  public getRateLimitState(accountId: string): RateLimitState | null {
    const state = this.states.get(accountId);
    if (!state) {
      return null;
    }

    // Check if cooldown elapsed
    if (
      state.isRateLimited &&
      state.cooldownUntil &&
      Date.now() >= state.cooldownUntil
    ) {
      state.isRateLimited = false;
      this.notifyListeners(state);
    }

    return { ...state };
  }

  public getAllStates(): Record<string, RateLimitState> {
    const result: Record<string, RateLimitState> = {};
    for (const accountId of this.states.keys()) {
      const state = this.getRateLimitState(accountId);
      if (state) {
        result[accountId] = state;
      }
    }
    return result;
  }

  public isAccountLimited(accountId: string): boolean {
    const state = this.getRateLimitState(accountId);
    return state ? state.isRateLimited : false;
  }

  public getActiveCooldownRemainingMs(accountId: string): number {
    const state = this.getRateLimitState(accountId);
    if (!state || !state.isRateLimited || !state.cooldownUntil) {
      return 0;
    }
    const remaining = state.cooldownUntil - Date.now();
    return Math.max(0, remaining);
  }
}
