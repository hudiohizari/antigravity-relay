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
import { runWithSwitchGuard } from "@/modules/antigravity-runtime/switch/switchGuard";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { isAntigravityTargetInstalled } from "@/shared/platform/paths";

export interface TargetAccountsMap {
  classic: CloudAccount | null;
  ide: CloudAccount | null;
  agy: CloudAccount | null;
}

export function middleTruncate(text: string, maxLength = 24): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }
  const ellipsis = "...";
  const charsToShow = maxLength - ellipsis.length;
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  return `${text.slice(0, frontChars)}${ellipsis}${text.slice(text.length - backChars)}`;
}

export interface TrayAccountActions {
  switchAccount?: (
    accountId: string,
    target?: AntigravityAppTarget | "all",
  ) => Promise<void>;
  refreshQuota?: (accountId: string) => Promise<CloudAccount | null>;
}

let registeredActions: TrayAccountActions = {};

export function registerTrayAccountHandlers(actions: TrayAccountActions): void {
  registeredActions = { ...registeredActions, ...actions };
}

let tray: Tray | null = null;
let globalMainWindow: BrowserWindow | null = null;
let lastAccount: CloudAccount | null = null;
let lastTargetAccounts: TargetAccountsMap | null = null;
let lastAccountsList: CloudAccount[] = [];
let lastLanguage: string = "en";
let onQuitRequested: (() => void | Promise<void>) | null = null;
let isRefreshingQuota = false;
let inFlightSync: Promise<void> | null = null;
let syncSequenceToken = 0;
let hasPendingSync = false;
let isSubscribedToCloudEvents = false;

const onCloudAccountEvent = () => {
  void syncTrayWithActiveAccount();
};

const onCloudAccountQuotaUpdated = (event?: { accountId?: string }) => {
  if (event?.accountId && lastAccountsList.length > 0) {
    const isTargetOrActive =
      event.accountId ===
        CloudAccountSettingsStore.getActiveAccountIdForTarget("classic") ||
      event.accountId ===
        CloudAccountSettingsStore.getActiveAccountIdForTarget("ide") ||
      event.accountId ===
        CloudAccountSettingsStore.getActiveAccountIdForTarget("agy") ||
      lastAccountsList.find((a) => a.id === event.accountId)?.is_active;

    if (!isTargetOrActive) {
      return;
    }
  }
  void syncTrayWithActiveAccount();
};

function subscribeCloudAccountEvents(): void {
  if (isSubscribedToCloudEvents) return;
  cloudAccountEvents.on("account:switched", onCloudAccountEvent);
  cloudAccountEvents.on("account:quota_updated", onCloudAccountQuotaUpdated);
  cloudAccountEvents.on("account:deleted", onCloudAccountEvent);
  cloudAccountEvents.on("account:sync_requested", onCloudAccountEvent);
  isSubscribedToCloudEvents = true;
}

function unsubscribeCloudAccountEvents(): void {
  if (!isSubscribedToCloudEvents) return;
  cloudAccountEvents.off("account:switched", onCloudAccountEvent);
  cloudAccountEvents.off("account:quota_updated", onCloudAccountQuotaUpdated);
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
        lastAccountsList = accounts;

        const classicId =
          CloudAccountSettingsStore.getActiveAccountIdForTarget("classic");
        const ideId =
          CloudAccountSettingsStore.getActiveAccountIdForTarget("ide");
        const agyId =
          CloudAccountSettingsStore.getActiveAccountIdForTarget("agy");

        const defaultActive = accounts.find((a) => a.is_active) ?? null;
        const hasAnyExplicitTarget = Boolean(classicId || ideId || agyId);

        const isClassicInstalled = isAntigravityTargetInstalled("classic");
        const isIdeInstalled = isAntigravityTargetInstalled("ide");
        const isAgyInstalled = isAntigravityTargetInstalled("agy");

        const classicAccount = isClassicInstalled
          ? classicId
            ? (accounts.find((a) => a.id === classicId) ?? null)
            : !hasAnyExplicitTarget
              ? defaultActive
              : null
          : null;
        const ideAccount = isIdeInstalled
          ? ideId
            ? (accounts.find((a) => a.id === ideId) ?? null)
            : !hasAnyExplicitTarget
              ? defaultActive
              : null
          : null;
        const agyAccount = isAgyInstalled
          ? agyId
            ? (accounts.find((a) => a.id === agyId) ?? null)
            : !hasAnyExplicitTarget
              ? defaultActive
              : null
          : null;

        const targetAccounts: TargetAccountsMap = {
          classic: classicAccount,
          ide: ideAccount,
          agy: agyAccount,
        };

        const activeAccount =
          classicAccount ?? agyAccount ?? ideAccount ?? defaultActive ?? null;
        updateTrayMenu(activeAccount, lang, targetAccounts);
      } catch (e) {
        logger.warn("Tray: Failed to sync active account", e);
        if (currentToken === syncSequenceToken) {
          updateTrayMenu(null, lang, {
            classic: null,
            ide: null,
            agy: null,
          });
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
  | ((
      accountId: string,
      target?: AntigravityAppTarget | "all",
    ) => Promise<void>)
  | null
> {
  if (registeredActions.switchAccount !== undefined) {
    return registeredActions.switchAccount ?? null;
  }
  try {
    const { switchCloudAccount } =
      await import("@/modules/cloud-account/ipc/handler");
    return async (accountId: string, target?: AntigravityAppTarget | "all") => {
      await switchCloudAccount(accountId, target);
    };
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
  targetAccounts?: TargetAccountsMap | null,
) {
  lastAccount = account;
  if (language) {
    lastLanguage = language;
  }
  if (targetAccounts !== undefined) {
    lastTargetAccounts = targetAccounts;
  }

  if (!tray || !globalMainWindow) return;

  const texts = getTrayTexts(lastLanguage);
  const quotaLines = getQuotaText(account, texts);

  const targets: TargetAccountsMap = lastTargetAccounts ?? {
    classic: account,
    ide: account,
    agy: account,
  };

  const classicId = targets.classic?.id ?? "";
  const ideId = targets.ide?.id ?? "";
  const agyId = targets.agy?.id ?? "";

  const installedTargets = (
    ["classic", "ide", "agy"] as AntigravityAppTarget[]
  ).filter((t) => isAntigravityTargetInstalled(t));

  const activeIds = installedTargets.map((t) => targets[t]?.id).filter(Boolean);

  const areAllEqual =
    installedTargets.length > 0
      ? activeIds.length === installedTargets.length &&
        activeIds.every((id) => id === activeIds[0])
      : !targets.classic && !targets.ide && !targets.agy;

  let headerItems: Electron.MenuItemConstructorOptions[] = [];

  if (!account && !targets.classic && !targets.ide && !targets.agy) {
    headerItems = [
      {
        label: `${texts.current}: ${texts.no_account}`,
        enabled: false,
      },
    ];
  } else if (areAllEqual) {
    const primaryAccount =
      targets.classic ?? targets.agy ?? targets.ide ?? account;
    let statusSuffix = "";
    if (
      primaryAccount?.quota?.is_forbidden ||
      primaryAccount?.quota?.isForbidden
    ) {
      statusSuffix = ` [${texts.forbidden}]`;
    } else if (primaryAccount?.status === "rate_limited") {
      statusSuffix = ` [${texts.rate_limited}]`;
    } else if (primaryAccount?.status === "expired") {
      statusSuffix = ` [${texts.expired}]`;
    }
    const email = primaryAccount?.email ?? texts.no_account;
    const truncatedEmail = middleTruncate(email, 24);
    const label = `${texts.current_all.replace("{{email}}", truncatedEmail)}${statusSuffix}`;
    headerItems = [
      {
        label,
        enabled: false,
      },
    ];
  } else {
    // Divergent targets
    const formatTargetItem = (
      template: string,
      targetAccount: CloudAccount | null,
    ): string => {
      let suffix = "";
      if (
        targetAccount?.quota?.is_forbidden ||
        targetAccount?.quota?.isForbidden
      ) {
        suffix = ` [${texts.forbidden}]`;
      } else if (targetAccount?.status === "rate_limited") {
        suffix = ` [${texts.rate_limited}]`;
      } else if (targetAccount?.status === "expired") {
        suffix = ` [${texts.expired}]`;
      }
      const email = targetAccount?.email
        ? middleTruncate(targetAccount.email, 20)
        : texts.no_account;
      return `${template.replace("{{email}}", email)}${suffix}`;
    };

    headerItems = [];
    if (isAntigravityTargetInstalled("classic")) {
      headerItems.push({
        label: formatTargetItem(texts.target_app, targets.classic),
        enabled: false,
      });
    }
    if (isAntigravityTargetInstalled("ide")) {
      headerItems.push({
        label: formatTargetItem(texts.target_ide, targets.ide),
        enabled: false,
      });
    }
    if (isAntigravityTargetInstalled("agy")) {
      headerItems.push({
        label: formatTargetItem(texts.target_cli, targets.agy),
        enabled: false,
      });
    }
    if (headerItems.length === 0) {
      headerItems.push({
        label: `${texts.current}: ${texts.no_account}`,
        enabled: false,
      });
    }
  }

  tray.setToolTip(
    account ? `Antigravity Relay (${account.email})` : "Antigravity Relay",
  );

  const handleTraySwitch = async (target: AntigravityAppTarget | "all") => {
    if (target !== "all" && !isAntigravityTargetInstalled(target)) {
      logger.warn(
        `Tray: Cannot switch target ${target} because it is not installed`,
      );
      return;
    }

    await runWithSwitchGuard("cloud-account-switch", async () => {
      try {
        const accounts = await CloudAccountRepo.getAccounts();
        if (!accounts || accounts.length === 0) return;

        const currentId =
          target === "all"
            ? accounts.find((a) => a.is_active)?.id ||
              CloudAccountSettingsStore.getActiveAccountIdForTarget(
                "classic",
              ) ||
              account?.id
            : CloudAccountSettingsStore.getActiveAccountIdForTarget(target) ||
              account?.id;

        // Try to pick next account using AutoSwitchService heuristics
        let next: CloudAccount | null = null;
        if (currentId) {
          next = await AutoSwitchService.findBestAccount(currentId);
        } else {
          next = await AutoSwitchService.findBestAccount("");
        }

        // Fallback to deterministic round robin if all null
        if (!next) {
          let nextIndex = 0;
          if (currentId) {
            const idx = accounts.findIndex((a) => a.id === currentId);
            nextIndex = (idx + 1) % accounts.length;
          }
          next = accounts[nextIndex];
        }

        if (!next) return;

        const switchAccount = await resolveAccountSwitcher();
        if (switchAccount) {
          await switchAccount(next.id, target);
        } else {
          if (target === "all") {
            if (isAntigravityTargetInstalled("classic")) {
              CloudAccountRepo.setActive(next.id, "classic");
            }
            if (isAntigravityTargetInstalled("ide")) {
              CloudAccountRepo.setActive(next.id, "ide");
            }
            if (isAntigravityTargetInstalled("agy")) {
              CloudAccountRepo.setActive(next.id, "agy");
            }
          } else {
            CloudAccountRepo.setActive(next.id, target);
          }
        }
        logger.info(`Tray: Switched ${target} to account ${next.email}`);

        await syncTrayWithActiveAccount();

        if (globalMainWindow && !globalMainWindow.isDestroyed()) {
          globalMainWindow.webContents.send("tray://account-switched", {
            accountId: next.id,
            target,
          });
        }
      } catch (e) {
        logger.error(`Tray: Switch account failed for target ${target}`, e);
      }
    });
  };

  const handleDirectSwitch = async (
    accountId: string,
    target: AntigravityAppTarget,
  ) => {
    if (!isAntigravityTargetInstalled(target)) {
      logger.warn(
        `Tray: Cannot switch target ${target} because it is not installed`,
      );
      return;
    }

    await runWithSwitchGuard("cloud-account-switch", async () => {
      try {
        const switchAccount = await resolveAccountSwitcher();
        if (switchAccount) {
          await switchAccount(accountId, target);
        } else {
          CloudAccountRepo.setActive(accountId, target);
        }
        logger.info(
          `Tray: Directly switched ${target} to account ${accountId}`,
        );

        await syncTrayWithActiveAccount();

        if (globalMainWindow && !globalMainWindow.isDestroyed()) {
          globalMainWindow.webContents.send("tray://account-switched", {
            accountId,
            target,
          });
        }
      } catch (e) {
        logger.error(`Tray: Direct switch failed for target ${target}`, e);
      }
    });
  };

  const accountsForSubmenu =
    lastAccountsList.length > 0 ? lastAccountsList : account ? [account] : [];

  const isClassicInstalled = isAntigravityTargetInstalled("classic");
  const isIdeInstalled = isAntigravityTargetInstalled("ide");
  const isAgyInstalled = isAntigravityTargetInstalled("agy");

  const template: Electron.MenuItemConstructorOptions[] = [
    ...headerItems,
    ...quotaLines.map((line) => ({ label: line, enabled: false })),
    { type: "separator" },
    {
      label: texts.switch_next_all,
      accelerator: process.platform === "darwin" ? "Cmd+N" : "Ctrl+N",
      click: async () => {
        await handleTraySwitch("all");
      },
    },
    {
      label: texts.switch_target_submenu,
      submenu: [
        {
          label: isClassicInstalled
            ? "Antigravity App"
            : `Antigravity App (${texts.not_installed})`,
          enabled: isClassicInstalled,
          submenu: isClassicInstalled
            ? [
                {
                  label: texts.switch_next_app,
                  click: async () => {
                    await handleTraySwitch("classic");
                  },
                },
                ...(accountsForSubmenu.length > 0
                  ? [{ type: "separator" as const }]
                  : []),
                ...accountsForSubmenu.map((acc) => ({
                  label: middleTruncate(acc.email, 24),
                  type: "checkbox" as const,
                  checked: targets.classic?.id === acc.id,
                  click: async () => {
                    await handleDirectSwitch(acc.id, "classic");
                  },
                })),
              ]
            : undefined,
        },
        {
          label: isIdeInstalled
            ? "Antigravity IDE"
            : `Antigravity IDE (${texts.not_installed})`,
          enabled: isIdeInstalled,
          submenu: isIdeInstalled
            ? [
                {
                  label: texts.switch_next_ide,
                  click: async () => {
                    await handleTraySwitch("ide");
                  },
                },
                ...(accountsForSubmenu.length > 0
                  ? [{ type: "separator" as const }]
                  : []),
                ...accountsForSubmenu.map((acc) => ({
                  label: middleTruncate(acc.email, 24),
                  type: "checkbox" as const,
                  checked: targets.ide?.id === acc.id,
                  click: async () => {
                    await handleDirectSwitch(acc.id, "ide");
                  },
                })),
              ]
            : undefined,
        },
        {
          label: isAgyInstalled
            ? "Antigravity CLI"
            : `Antigravity CLI (${texts.not_installed})`,
          enabled: isAgyInstalled,
          submenu: isAgyInstalled
            ? [
                {
                  label: texts.switch_next_cli,
                  click: async () => {
                    await handleTraySwitch("agy");
                  },
                },
                ...(accountsForSubmenu.length > 0
                  ? [{ type: "separator" as const }]
                  : []),
                ...accountsForSubmenu.map((acc) => ({
                  label: middleTruncate(acc.email, 24),
                  type: "checkbox" as const,
                  checked: targets.agy?.id === acc.id,
                  click: async () => {
                    await handleDirectSwitch(acc.id, "agy");
                  },
                })),
              ]
            : undefined,
        },
      ],
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
  lastTargetAccounts = null;
  lastAccountsList = [];
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
