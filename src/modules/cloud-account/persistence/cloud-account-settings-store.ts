import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import { isAntigravityTargetInstalled } from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";
import { settings } from "@/shared/persistence/database/schema";
import { getCloudDb } from "./cloud-account-db";

const ACTIVE_ACCOUNT_SETTING_PREFIX = "active_cloud_account";
const UNIFIED_MODE_SETTING_KEY = "unified_mode";
const StringSettingSchema = z.string();
const BooleanSettingSchema = z.boolean();

export interface TargetOperationalState {
  isUnifiedMode: boolean;
  isPhysicallyUnified: boolean;
  activeAccountId: string;
  targetAccounts: Record<AntigravityAppTarget, string>;
  installedTargets: AntigravityAppTarget[];
  divergedTargets: AntigravityAppTarget[];
}

export class CloudAccountSettingsStore {
  /** Missing settings use the default; corrupt or unavailable storage must remain an error. */
  static readSetting(key: string): unknown {
    const { raw, orm } = getCloudDb();
    try {
      const row = orm
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .get();
      if (!row) {
        return undefined;
      }
      const rawSetting: unknown = JSON.parse(row.value);
      return rawSetting;
    } finally {
      raw.close();
    }
  }

  static getSetting<T>(key: string, defaultValue: T, schema: z.ZodType<T>): T {
    let rawDb: { close: () => void } | null = null;
    try {
      const { raw, orm } = getCloudDb();
      rawDb = raw;
      const row = orm
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .get();
      if (!row) {
        return defaultValue;
      }
      const rawSetting: unknown = JSON.parse(row.value);
      const parsed = schema.safeParse(rawSetting);
      if (!parsed.success) {
        logger.warn(
          `Ignored invalid setting ${key}; using default value`,
          parsed.error,
        );
        return defaultValue;
      }
      return parsed.data;
    } catch (error) {
      logger.error(`Failed to get setting ${key}`, error);
      return defaultValue;
    } finally {
      if (rawDb) {
        rawDb.close();
      }
    }
  }

  static setSetting(key: string, value: unknown): void {
    const { raw, orm } = getCloudDb();
    try {
      const stringValue = JSON.stringify(value);
      orm
        .insert(settings)
        .values({ key, value: stringValue })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: stringValue },
        })
        .run();
    } finally {
      raw.close();
    }
  }

  static setActiveForTarget(
    target: AntigravityAppTarget | string | undefined,
    id: string,
  ): void {
    const normalizedTarget = resolveAntigravityAppTarget(target);
    this.setSetting(`${ACTIVE_ACCOUNT_SETTING_PREFIX}.${normalizedTarget}`, id);

    // Dual-write during transition
    if (normalizedTarget === "app") {
      this.setSetting(`${ACTIVE_ACCOUNT_SETTING_PREFIX}.classic`, id);
    } else if (normalizedTarget === "cli") {
      this.setSetting(`${ACTIVE_ACCOUNT_SETTING_PREFIX}.agy`, id);
    }
  }

  static getActiveAccountIdForTarget(
    target: AntigravityAppTarget | string | undefined,
  ): string {
    const normalizedTarget = resolveAntigravityAppTarget(target);
    const key = `${ACTIVE_ACCOUNT_SETTING_PREFIX}.${normalizedTarget}`;
    let value = this.getSetting(key, "", StringSettingSchema);

    // Fallback read compatibility: check legacy setting if canonical is empty
    if (
      (typeof value !== "string" || value.trim() === "") &&
      normalizedTarget === "app"
    ) {
      value = this.getSetting(
        `${ACTIVE_ACCOUNT_SETTING_PREFIX}.classic`,
        "",
        StringSettingSchema,
      );
    } else if (
      (typeof value !== "string" || value.trim() === "") &&
      normalizedTarget === "cli"
    ) {
      value = this.getSetting(
        `${ACTIVE_ACCOUNT_SETTING_PREFIX}.agy`,
        "",
        StringSettingSchema,
      );
    }

    if (typeof value !== "string") {
      logger.warn(
        `Ignored invalid active account setting ${key}: expected a string`,
      );
      return "";
    }

    return value.trim();
  }

  static deleteSetting(key: string): void {
    const { raw, orm } = getCloudDb();
    try {
      orm.delete(settings).where(eq(settings.key, key)).run();
    } finally {
      raw.close();
    }
  }

  static clearActiveForTarget(
    target: AntigravityAppTarget | string | undefined,
  ): void {
    const normalizedTarget = resolveAntigravityAppTarget(target);
    this.deleteSetting(`${ACTIVE_ACCOUNT_SETTING_PREFIX}.${normalizedTarget}`);

    // Dual-delete during transition
    if (normalizedTarget === "app") {
      this.deleteSetting(`${ACTIVE_ACCOUNT_SETTING_PREFIX}.classic`);
    } else if (normalizedTarget === "cli") {
      this.deleteSetting(`${ACTIVE_ACCOUNT_SETTING_PREFIX}.agy`);
    }
  }

  static evictIfTargetMissing(
    target: AntigravityAppTarget | string | undefined,
  ): boolean {
    const normalizedTarget = resolveAntigravityAppTarget(target);
    const currentActiveId = this.getActiveAccountIdForTarget(normalizedTarget);
    if (!currentActiveId) {
      return false;
    }

    try {
      const isInstalled = isAntigravityTargetInstalled(normalizedTarget);
      if (!isInstalled) {
        logger.info(
          `Evicted stale active account (${currentActiveId}) for uninstalled target: ${normalizedTarget}`,
        );
        this.clearActiveForTarget(normalizedTarget);
        return true;
      }
    } catch (error) {
      logger.warn(
        `Preserved active account setting for target ${normalizedTarget} due to transient filesystem error`,
        error,
      );
      return false;
    }

    return false;
  }

  static evictAllMissingTargets(): AntigravityAppTarget[] {
    const targets: AntigravityAppTarget[] = ["app", "ide", "cli"];
    const evicted: AntigravityAppTarget[] = [];
    for (const target of targets) {
      if (this.evictIfTargetMissing(target)) {
        evicted.push(target);
      }
    }
    return evicted;
  }

  static isUnifiedMode(): boolean {
    return this.getSetting(
      UNIFIED_MODE_SETTING_KEY,
      true,
      BooleanSettingSchema,
    );
  }

  static setUnifiedMode(enabled: boolean): void {
    this.setSetting(UNIFIED_MODE_SETTING_KEY, enabled);
  }

  static getOperationalState(): TargetOperationalState {
    const isUnified = this.isUnifiedMode();
    const candidateTargets: AntigravityAppTarget[] = ["app", "ide", "cli"];
    const installedTargets = candidateTargets.filter((t) =>
      isAntigravityTargetInstalled(t),
    );

    const appAcc = this.getActiveAccountIdForTarget("app");
    const ideAcc = this.getActiveAccountIdForTarget("ide");
    const cliAcc = this.getActiveAccountIdForTarget("cli");

    const targetAccounts: Record<AntigravityAppTarget, string> = {
      app: appAcc,
      ide: ideAcc,
      cli: cliAcc,
      classic: appAcc,
      agy: cliAcc,
    };

    // Determine primary activeAccountId:
    // Prefer installed targets in order: app -> cli -> ide
    const activeTarget = installedTargets.find((t) =>
      Boolean(targetAccounts[t]),
    );
    const activeAccountId = activeTarget
      ? targetAccounts[activeTarget]
      : targetAccounts.app || "";

    const isPhysicallyUnified =
      installedTargets.length <= 1 ||
      installedTargets.every(
        (t) => targetAccounts[t] === targetAccounts[installedTargets[0]],
      );

    const divergedTargets = isPhysicallyUnified
      ? []
      : installedTargets.filter((t) => targetAccounts[t] !== activeAccountId);

    return {
      isUnifiedMode: isUnified,
      isPhysicallyUnified,
      activeAccountId,
      targetAccounts,
      installedTargets,
      divergedTargets,
    };
  }
}
