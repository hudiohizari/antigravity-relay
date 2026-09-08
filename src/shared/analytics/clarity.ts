import type { AppConfig } from "@/modules/config/types";

export function isClarityAvailable(): boolean {
  return false;
}

export function syncClarity(
  _appConfig: Pick<AppConfig, "clarity_enabled" | "language" | "theme">,
): void {
  // Clarity telemetry disabled in Antigravity Relay
}

export function trackClarityEvent(_eventName: string): void {
  // No-op
}
