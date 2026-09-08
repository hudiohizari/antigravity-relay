import { Notification, BrowserWindow } from "electron";
import { z } from "zod";
import {
  NotificationPayload,
  NotificationPreferences,
  NotificationType,
} from "../../shared/types";
import { SettingsStore } from "../settings/settings-store";

export const NotificationPayloadSchema = z.object({
  type: z.enum([
    "account_switched",
    "rate_limit_cooldown",
    "service_crash",
    "general_alert",
  ]),
  title: z.string().min(1, "Notification title is required"),
  body: z.string().default(""),
  silent: z.boolean().optional(),
  urgency: z.enum(["normal", "critical", "low"]).optional(),
  timestamp: z.number().optional(),
});

export interface NotifierOptions {
  settingsStore?: SettingsStore;
  getMainWindow?: () => BrowserWindow | null;
  iconPath?: string;
  defaultDebounceMs?: number;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  notifyOnAutoSwitch: true,
  notifyOnRateLimit: true,
  notifyOnProcessCrash: true,
  debounceMs: 5000,
};

export class NativeNotifier {
  private readonly options: NotifierOptions;
  private cachedPreferences: NotificationPreferences = {
    ...DEFAULT_PREFERENCES,
  };
  private lastDispatchTimes: Map<string, number> = new Map();

  constructor(options: NotifierOptions = {}) {
    this.options = options;
    if (this.options.settingsStore) {
      this.options.settingsStore.onSettingsUpdated((settings) => {
        this.cachedPreferences = { ...settings.notifications };
      });
      // Preload preferences
      this.options.settingsStore
        .get()
        .then((settings) => {
          this.cachedPreferences = { ...settings.notifications };
        })
        .catch(() => {});
    }
  }

  public setPreferences(preferences: NotificationPreferences): void {
    this.cachedPreferences = { ...preferences };
  }

  public async getPreferences(): Promise<NotificationPreferences> {
    if (this.options.settingsStore) {
      const settings = await this.options.settingsStore.get();
      this.cachedPreferences = { ...settings.notifications };
      return this.cachedPreferences;
    }
    return { ...this.cachedPreferences };
  }

  public async updatePreferences(
    partial: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    if (this.options.settingsStore) {
      const updated = await this.options.settingsStore.update({
        notifications: {
          ...this.cachedPreferences,
          ...partial,
        },
      });
      this.cachedPreferences = { ...updated.notifications };
      return this.cachedPreferences;
    }

    this.cachedPreferences = {
      ...this.cachedPreferences,
      ...partial,
    };
    return { ...this.cachedPreferences };
  }

  public resetDebounce(): void {
    this.lastDispatchTimes.clear();
  }

  public isCategoryEnabled(type: NotificationType): boolean {
    if (!this.cachedPreferences.enabled) {
      return false;
    }

    switch (type) {
      case "account_switched":
        return this.cachedPreferences.notifyOnAutoSwitch;
      case "rate_limit_cooldown":
        return this.cachedPreferences.notifyOnRateLimit;
      case "service_crash":
        return this.cachedPreferences.notifyOnProcessCrash;
      case "general_alert":
      default:
        return true;
    }
  }

  public shouldDebounce(
    type: NotificationType,
    debounceWindowMs?: number,
  ): boolean {
    const windowMs =
      debounceWindowMs ?? this.cachedPreferences.debounceMs ?? 5000;

    const now = Date.now();
    const lastTime = this.lastDispatchTimes.get(type) ?? 0;

    if (now - lastTime < windowMs) {
      return true;
    }

    this.lastDispatchTimes.set(type, now);
    return false;
  }

  public async send(rawPayload: NotificationPayload): Promise<boolean> {
    if (!Notification.isSupported()) {
      return false;
    }

    const parseResult = NotificationPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      return false;
    }
    const payload = parseResult.data;

    // Refresh preferences if store is available
    if (this.options.settingsStore) {
      try {
        const settings = await this.options.settingsStore.get();
        this.cachedPreferences = { ...settings.notifications };
      } catch {
        // Fall back to cached preferences
      }
    }

    if (!this.isCategoryEnabled(payload.type)) {
      return false;
    }

    if (this.shouldDebounce(payload.type)) {
      return false;
    }

    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.silent,
      urgency: payload.urgency,
      icon: this.options.iconPath,
    });

    notification.on("click", () => {
      const win = this.options.getMainWindow
        ? this.options.getMainWindow()
        : null;
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) {
          win.restore();
        }
        win.show();
        win.focus();
      }
    });

    notification.show();
    return true;
  }

  public async notifyAccountSwitched(
    prevEmail: string | null,
    nextEmail: string,
  ): Promise<boolean> {
    const body = prevEmail
      ? `Switched from ${prevEmail} to ${nextEmail}`
      : `Active account switched to ${nextEmail}`;

    return this.send({
      type: "account_switched",
      title: "Antigravity Relay - Account Rotated",
      body,
    });
  }

  public async notifyRateLimit(
    email: string,
    cooldownMinutes = 15,
  ): Promise<boolean> {
    return this.send({
      type: "rate_limit_cooldown",
      title: "Rate Limit Detected",
      body: `${email} placed in cooldown for ${cooldownMinutes} minutes`,
    });
  }

  public async notifyServiceCrash(
    serviceName: string,
    exitCode?: number | string,
  ): Promise<boolean> {
    const exitDetails = exitCode !== undefined ? ` with code ${exitCode}` : "";

    return this.send({
      type: "service_crash",
      title: "Service Alert",
      body: `${serviceName} exited unexpectedly${exitDetails}`,
      urgency: "critical",
    });
  }

  public async notifyGeneral(title: string, body: string): Promise<boolean> {
    return this.send({
      type: "general_alert",
      title,
      body,
    });
  }
}
