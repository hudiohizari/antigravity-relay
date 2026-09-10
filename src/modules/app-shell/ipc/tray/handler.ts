import { app, Tray, Menu, nativeImage, BrowserWindow } from "electron";
import { z } from "zod";
import { CloudAccount } from "@/modules/cloud-account/types";
import { logger } from "@/shared/logging/logger";
import { getTrayTexts, type TrayTexts } from "./i18n";
import { CloudAccountRepo } from "@/modules/cloud-account/persistence/cloudHandler";
import { GoogleAPIService } from "@/modules/cloud-account/services/GoogleAPIService";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";
import { cloudAccountEvents } from "@/modules/cloud-account/services/cloud-account-events";
import { configureTrayIcon, resolveTrayIconPath } from "./icon";
import { isWeeklyQuotaBucket } from "@/modules/cloud-account/utils/quota-groups";
import { AutoSwitchService } from "@/modules/cloud-account/services/AutoSwitchService";

export interface TrayAccountActions {
  switchAccount?: (accountId: string) => Promise<void>;
  refreshQuota?: (accountId: string) => Promise<CloudAccount | null>;
}

let registeredActions: TrayAccountActions = {};

export function registerTrayAccountHandlers(actions: TrayAccountActions): void {
  registeredActions = { ...registeredActions, ...actions };
}

let tray: Tray | null = null;
let globalMainWindow: BrowserWindow | null = null;
let lastAccount: CloudAccount | null = null;
let lastLanguage: string = "en";
let onQuitRequested: (() => void | Promise<void>) | null = null;
let isSwitchingAccount = false;
let isRefreshingQuota = false;
let inFlightSync: Promise<void> | null = null;
let syncSequenceToken = 0;
let hasPendingSync = false;
let isSubscribedToCloudEvents = false;

const onCloudAccountEvent = () => {
  void syncTrayWithActiveAccount();
};

function subscribeCloudAccountEvents(): void {
  if (isSubscribedToCloudEvents) return;
  cloudAccountEvents.on("account:switched", onCloudAccountEvent);
  cloudAccountEvents.on("account:quota_updated", onCloudAccountEvent);
  cloudAccountEvents.on("account:deleted", onCloudAccountEvent);
  cloudAccountEvents.on("account:sync_requested", onCloudAccountEvent);
  isSubscribedToCloudEvents = true;
}

function unsubscribeCloudAccountEvents(): void {
  if (!isSubscribedToCloudEvents) return;
  cloudAccountEvents.off("account:switched", onCloudAccountEvent);
  cloudAccountEvents.off("account:quota_updated", onCloudAccountEvent);
  cloudAccountEvents.off("account:deleted", onCloudAccountEvent);
  cloudAccountEvents.off("account:sync_requested", onCloudAccountEvent);
  isSubscribedToCloudEvents = false;
}

export function syncTrayWithActiveAccount(): Promise<void> {
  if (inFlightSync) {
    hasPendingSync = true;
    return inFlightSync;
  }

  const currentToken = ++syncSequenceToken;

  inFlightSync = (async () => {
    try {
      let lang = "en";
      try {
        const stored = CloudAccountSettingsStore.getSetting(
          "language",
          "en",
          z.string(),
        );
        if (typeof stored === "string" && stored.trim()) {
          lang = stored.trim();
        }
      } catch (langErr) {
        logger.warn(
          "Tray: Failed to resolve language from store, using fallback",
          langErr,
        );
      }

      try {
        const accounts = await CloudAccountRepo.getAccounts();
        if (currentToken !== syncSequenceToken) {
          return;
        }
        const activeAccount =
          accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
        updateTrayMenu(activeAccount, lang);
      } catch (e) {
        logger.warn("Tray: Failed to sync active account", e);
        if (currentToken === syncSequenceToken) {
          updateTrayMenu(null, lang);
        }
      }
    } finally {
      inFlightSync = null;
      if (hasPendingSync) {
        hasPendingSync = false;
        void syncTrayWithActiveAccount();
      }
    }
  })();

  return inFlightSync;
}

export function getQuotaText(
  account: CloudAccount | null,
  texts: TrayTexts,
): string[] {
  if (!account) return [`${texts.quota}: --`];
  if (!account.quota) return [`${texts.quota}: ${texts.unknown_quota}`];
  if (account.quota.is_forbidden || account.quota.isForbidden) {
    return [`${texts.quota}: ${texts.forbidden}`];
  }

  const lines: string[] = [];
  const groups = account.quota.quota_groups || [];
  const fiveHourBuckets: number[] = [];

  for (const group of groups) {
    for (const bucket of group.buckets || []) {
      if (!isWeeklyQuotaBucket(bucket)) {
        fiveHourBuckets.push(Math.round(bucket.remaining_fraction * 100));
      }
    }
  }

  if (fiveHourBuckets.length > 0) {
    const bottleneck5h = Math.min(...fiveHourBuckets);
    lines.push(`${texts.quota_5h}: ${bottleneck5h}%`);
  }

  const models = account.quota.models;
  if (models && Object.keys(models).length > 0) {
    let gHigh: number | null = null;
    let gImage: number | null = null;
    let claude: number | null = null;

    for (const [key, val] of Object.entries(models)) {
      const k = key.toLowerCase();
      if (k.includes("high") && gHigh === null) gHigh = val.percentage;
      else if (k.includes("image") && gImage === null) gImage = val.percentage;
      else if (k.includes("claude") && claude === null) claude = val.percentage;
    }

    if (gHigh !== null) lines.push(`Gemini High: ${gHigh}%`);
    if (gImage !== null) lines.push(`Gemini Image: ${gImage}%`);
    if (claude !== null) lines.push(`Claude 4.6: ${claude}%`);

    if (gHigh === null && gImage === null && claude === null) {
      for (const [key, val] of Object.entries(models).slice(0, 3)) {
        const name = val.display_name || key;
        lines.push(`${name}: ${val.percentage}%`);
      }
    }
  }

  if (lines.length === 0) {
    lines.push(`${texts.quota}: ${texts.unknown_quota}`);
  }

  return lines;
}

export function initTray(
  mainWindow: BrowserWindow,
  quitHandler?: () => void | Promise<void>,
) {
  globalMainWindow = mainWindow;
  onQuitRequested = quitHandler ?? null;

  // Destroy existing tray before creating new one (prevents zombie tray icons)
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      logger.error("Failed to destroy existing tray", e);
    }
    tray = null;
    unsubscribeCloudAccountEvents();
    logger.info("Destroyed existing tray before creating new one");
  }

  const inDevelopment = process.env.NODE_ENV === "development";
  // In production, extraResource copies 'src/assets' folder to 'resources/assets'.
  const iconPath = resolveTrayIconPath({
    inDevelopment,
    platform: process.platform,
    cwd: process.cwd(),
    resourcesPath: process.resourcesPath,
  });

  logger.info(
    `Tray icon path: ${iconPath}, inDevelopment: ${inDevelopment}, resourcesPath: ${process.resourcesPath}`,
  );

  const icon = nativeImage.createFromPath(iconPath);

  // Verify icon is valid before creating tray
  if (icon.isEmpty()) {
    logger.error(`Tray icon not found or invalid at path: ${iconPath}`);
    return;
  }

  configureTrayIcon(icon, process.platform);
  tray = new Tray(icon);
  tray.setToolTip("Antigravity Relay");

  tray.on("double-click", () => {
    if (globalMainWindow) {
      if (globalMainWindow.isVisible()) {
        globalMainWindow.hide();
      } else {
        globalMainWindow.show();
        globalMainWindow.focus();
      }
    }
  });

  updateTrayMenu(null);
  subscribeCloudAccountEvents();
  void syncTrayWithActiveAccount();
}

async function resolveAccountSwitcher(): Promise<
  ((accountId: string) => Promise<void>) | null
> {
  if (registeredActions.switchAccount !== undefined) {
    return registeredActions.switchAccount ?? null;
  }
  try {
    const { switchCloudAccount } =
      await import("@/modules/cloud-account/ipc/handler");
    return switchCloudAccount;
  } catch {
    return null;
  }
}

async function resolveQuotaRefresher(): Promise<
  ((accountId: string) => Promise<CloudAccount | null>) | null
> {
  if (registeredActions.refreshQuota !== undefined) {
    return registeredActions.refreshQuota ?? null;
  }
  try {
    const { refreshAccountQuota } =
      await import("@/modules/cloud-account/ipc/handler");
    return refreshAccountQuota;
  } catch {
    return null;
  }
}

export function updateTrayMenu(
  account: CloudAccount | null,
  language?: string,
) {
  lastAccount = account;
  if (language) {
    lastLanguage = language;
  }

  if (!tray || !globalMainWindow) return;

  const texts = getTrayTexts(lastLanguage);
  const quotaLines = getQuotaText(account, texts);

  let currentLabel: string;
  if (!account) {
    currentLabel = `${texts.current}: ${texts.no_account}`;
  } else {
    let statusSuffix = "";
    if (account.quota?.is_forbidden || account.quota?.isForbidden) {
      statusSuffix = ` [${texts.forbidden}]`;
    } else if (account.status === "rate_limited") {
      statusSuffix = ` [${texts.rate_limited}]`;
    } else if (account.status === "expired") {
      statusSuffix = ` [${texts.expired}]`;
    }
    currentLabel = `${texts.current}: ${account.email}${statusSuffix}`;
  }

  tray.setToolTip(
    account ? `Antigravity Relay (${account.email})` : "Antigravity Relay",
  );

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: currentLabel,
      enabled: false,
    },
    ...quotaLines.map((line) => ({ label: line, enabled: false })),
    { type: "separator" },
    {
      label: texts.switch_next,
      click: async () => {
        if (isSwitchingAccount) {
          logger.info(
            "Tray: Switch account dropped (concurrent switch in progress)",
          );
          return;
        }
        isSwitchingAccount = true;
        try {
          const accounts = await CloudAccountRepo.getAccounts();
          if (accounts.length === 0) return;

          const current = accounts.find((a) => a.is_active);
          let next: CloudAccount | null = null;
          if (current) {
            next = await AutoSwitchService.findBestAccount(current.id);
          } else {
            next = await AutoSwitchService.findBestAccount("");
          }

          // Fallback to deterministic round robin if all null
          if (!next) {
            let nextIndex = 0;
            if (current) {
              const idx = accounts.findIndex((a) => a.id === current.id);
              nextIndex = (idx + 1) % accounts.length;
            }
            next = accounts[nextIndex];
          }

          if (!next) return;

          const switchAccount = await resolveAccountSwitcher();
          if (switchAccount) {
            await switchAccount(next.id);
          } else {
            CloudAccountRepo.setActive(next.id);
          }
          logger.info(`Tray: Switched to account ${next.email}`);

          const updatedNext =
            (await CloudAccountRepo.getAccount(next.id)) ?? next;
          updateTrayMenu(updatedNext, lastLanguage);

          if (globalMainWindow && !globalMainWindow.isDestroyed()) {
            globalMainWindow.webContents.send(
              "tray://account-switched",
              next.id,
            );
          }
        } catch (e) {
          logger.error("Tray: Switch account failed", e);
        } finally {
          isSwitchingAccount = false;
        }
      },
    },
    {
      label: texts.refresh_current,
      click: async () => {
        if (isRefreshingQuota) {
          logger.info(
            "Tray: Refresh quota dropped (concurrent refresh in progress)",
          );
          return;
        }
        isRefreshingQuota = true;
        try {
          const accounts = await CloudAccountRepo.getAccounts();
          const current = accounts.find((a) => a.is_active);
          if (!current) return;

          logger.info(`Tray: Refreshing quota for ${current.email}`);

          let updated: CloudAccount | null = null;
          const refreshQuota = await resolveQuotaRefresher();
          if (refreshQuota) {
            updated = await refreshQuota(current.id);
          } else {
            const quota = await GoogleAPIService.fetchQuota(
              current.token.access_token,
            );
            await CloudAccountRepo.updateQuota(current.id, quota);
            updated = (await CloudAccountRepo.getAccount(current.id)) ?? null;
          }

          if (updated) {
            updateTrayMenu(updated, lastLanguage);
          }

          if (globalMainWindow && !globalMainWindow.isDestroyed()) {
            globalMainWindow.webContents.send("tray://refresh-current");
          }
        } catch (e) {
          logger.error("Tray: Refresh quota failed", e);
        } finally {
          isRefreshingQuota = false;
        }
      },
    },
    { type: "separator" },
    {
      label: texts.show_window,
      click: () => {
        if (globalMainWindow && !globalMainWindow.isDestroyed()) {
          globalMainWindow.show();
          globalMainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: texts.quit,
      click: () => {
        if (onQuitRequested) {
          onQuitRequested();
          return;
        }
        app.quit();
      },
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
}

export function setTrayLanguage(lang: string) {
  updateTrayMenu(lastAccount, lang);
}

export function destroyTray() {
  unsubscribeCloudAccountEvents();
  syncSequenceToken++;
  inFlightSync = null;
  hasPendingSync = false;
  isRefreshingQuota = false;
  isSwitchingAccount = false;
  registeredActions = {};
  onQuitRequested = null;
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      logger.error("Failed to destroy tray", e);
    }
    tray = null;
    logger.info("Tray destroyed");
  }
}
