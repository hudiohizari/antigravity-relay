import {
  buildGitHubReleaseFromLatestRedirect,
  buildGitHubReleaseFromPackageJson,
  buildGitHubReleaseFromUpdaterJson,
  buildManualUpdateInfo,
} from "./manualUpdatePolicy";
import axios from "axios";
import type {
  GitHubRelease,
  ManualUpdateCheckResult,
  ManualUpdatePlatform,
  ManualUpdateSnooze,
} from "./types";
import {
  GitHubReleaseSchema,
  ManualUpdateSnoozeSchema,
  PackageJsonVersionSchema,
  UpdaterJsonSchema,
} from "./types";
import { createAxiosHttpClient } from "@/shared/http/axios-json-client";
import {
  getAppSetting,
  setAppSetting,
} from "@/shared/persistence/appSettingsStore";
import { logger } from "@/shared/logging/logger";

const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/hudiohizari/antigravity-relay/releases/latest";
const LATEST_RELEASE_UPDATER_JSON_URL =
  "https://github.com/hudiohizari/antigravity-relay/releases/latest/download/updater.json";
const LATEST_RELEASE_REDIRECT_URL =
  "https://github.com/hudiohizari/antigravity-relay/releases/latest";
const GITHUB_RAW_PACKAGE_JSON_URL =
  "https://raw.githubusercontent.com/hudiohizari/antigravity-relay/main/package.json";
const JSDELIVR_PACKAGE_JSON_URL =
  "https://cdn.jsdelivr.net/gh/hudiohizari/antigravity-relay@main/package.json";
const MANUAL_UPDATE_SNOOZE_KEY = "manual_update_snooze";
const MANUAL_UPDATE_MOCK_VERSION = "9.9.9";
const MANUAL_UPDATE_TIMEOUT_MS = 15_000;

const manualUpdateHttpClient = createAxiosHttpClient(
  axios.create({
    headers: {
      "User-Agent": "AntigravityRelay",
    },
    timeout: MANUAL_UPDATE_TIMEOUT_MS,
  }),
);

function isManualUpdatePlatform(
  platform: NodeJS.Platform,
): platform is ManualUpdatePlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

export function getManualUpdateSnooze(): ManualUpdateSnooze | null {
  return getAppSetting(
    MANUAL_UPDATE_SNOOZE_KEY,
    ManualUpdateSnoozeSchema.nullable(),
    null,
  );
}

export function snoozeManualUpdate(version: string): void {
  setAppSetting(MANUAL_UPDATE_SNOOZE_KEY, {
    version,
    dismissedAt: new Date().toISOString(),
  });
}

export function isManualUpdateMockEnabled(): boolean {
  return process.env.MANUAL_UPDATE_MOCK === "1";
}

export function isManualUpdateForceEnabled(): boolean {
  return process.env.MANUAL_UPDATE_FORCE === "1";
}

async function fetchLatestReleaseFromUpdaterJson(): Promise<GitHubRelease | null> {
  const updaterJson = await manualUpdateHttpClient.requestJson(
    LATEST_RELEASE_UPDATER_JSON_URL,
    {
      operation: "manual-update-updater-json",
      responseSchema: UpdaterJsonSchema,
    },
  );

  return buildGitHubReleaseFromUpdaterJson(updaterJson);
}

async function fetchLatestReleaseFromGitHubApi(): Promise<GitHubRelease | null> {
  return await manualUpdateHttpClient.requestJson(LATEST_RELEASE_API_URL, {
    operation: "manual-update-github-api",
    request: {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
    responseSchema: GitHubReleaseSchema,
  });
}

async function fetchLatestReleaseFromRedirect(): Promise<GitHubRelease | null> {
  const response = await manualUpdateHttpClient.requestRaw(
    LATEST_RELEASE_REDIRECT_URL,
    {
      expectedStatus: (status) => status >= 300 && status < 400,
      operation: "manual-update-github-redirect",
      request: {
        maxRedirects: 0,
      },
    },
  );
  const location = response.headers.location;
  if (typeof location !== "string") {
    return null;
  }

  return buildGitHubReleaseFromLatestRedirect(
    new URL(location, LATEST_RELEASE_REDIRECT_URL).toString(),
  );
}

async function fetchLatestReleaseFromPackageJson(
  url: string,
): Promise<GitHubRelease | null> {
  const packageJson = await manualUpdateHttpClient.requestJson(url, {
    operation: "manual-update-package-json",
    responseSchema: PackageJsonVersionSchema,
  });

  return buildGitHubReleaseFromPackageJson(packageJson);
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  const sources: Array<[string, () => Promise<GitHubRelease | null>]> = [
    ["updater.json", fetchLatestReleaseFromUpdaterJson],
    ["GitHub API", fetchLatestReleaseFromGitHubApi],
    ["GitHub latest redirect", fetchLatestReleaseFromRedirect],
    [
      "GitHub raw package.json",
      () => fetchLatestReleaseFromPackageJson(GITHUB_RAW_PACKAGE_JSON_URL),
    ],
    [
      "jsDelivr package.json",
      () => fetchLatestReleaseFromPackageJson(JSDELIVR_PACKAGE_JSON_URL),
    ],
  ];

  for (const [sourceName, fetchSource] of sources) {
    try {
      const release = await fetchSource();
      if (release) {
        logger.info(`ManualUpdate: Latest release resolved from ${sourceName}`);
        return release;
      }
    } catch (error) {
      logger.warn(
        `ManualUpdate: ${sourceName} check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  return null;
}

export async function checkManualUpdate(
  currentVersion: string,
): Promise<ManualUpdateCheckResult> {
  const platform =
    isManualUpdateMockEnabled() || isManualUpdateForceEnabled()
      ? "linux"
      : process.platform;
  if (!isManualUpdatePlatform(platform)) {
    return { status: "unsupported" };
  }

  if (isManualUpdateMockEnabled()) {
    return {
      status: "available",
      update: {
        version: MANUAL_UPDATE_MOCK_VERSION,
        tagName: `v${MANUAL_UPDATE_MOCK_VERSION}`,
        releaseName: "Mock Release",
        releaseUrl: `https://github.com/hudiohizari/antigravity-relay/releases/tag/v${MANUAL_UPDATE_MOCK_VERSION}`,
        platform,
      },
    };
  }

  try {
    const release = await fetchLatestRelease();
    if (!release) {
      return {
        status: "error",
        message: "GitHub release check failed",
      };
    }
    const update = buildManualUpdateInfo({
      currentVersion,
      platform,
      release,
    });

    if (!update) {
      return { status: "up-to-date" };
    }

    return {
      status: "available",
      update,
    };
  } catch (error) {
    logger.error("ManualUpdate: Failed to check GitHub Releases", error);
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unknown update check error",
    };
  }
}
