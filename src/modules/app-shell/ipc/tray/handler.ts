import { app, Tray, Menu, nativeImage, BrowserWindow } from "electron";
import { CloudAccount } from "@/modules/cloud-account/types";
import { logger } from "@/shared/logging/logger";
import { getTrayTexts, type TrayTexts } from "./i18n";
import { CloudAccountRepo } from "@/modules/cloud-account/persistence/cloudHandler";
import { GoogleAPIService } from "@/modules/cloud-account/services/GoogleAPIService";
import { configureTrayIcon, resolveTrayIconPath } from "./icon";
import { isWeeklyQuotaBucket } from "@/modules/cloud-account/utils/quota-groups";

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
    if (claude !== null) lines.push(`Claude 4.5: ${claude}%`);

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

  // PATCH 3: Destroy existing tray before creating new one (prevents zombie tray icons)
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      logger.error("Failed to destroy existing tray", e);
    }
    tray = null;
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
        try {
          const accounts = await CloudAccountRepo.getAccounts();
          if (accounts.length === 0) return;

          const current = accounts.find((a) => a.is_active);
          let nextIndex = 0;
          if (current) {
            const idx = accounts.findIndex((a) => a.id === current.id);
            nextIndex = (idx + 1) % accounts.length;
          }
          const next = accounts[nextIndex];

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
        }
      },
    },
    {
      label: texts.refresh_current,
      click: async () => {
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
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      logger.error("Failed to destroy tray", e);
    }
    tray = null;
    onQuitRequested = null;
    registeredActions = {};
    logger.info("Tray destroyed");
  }
}
