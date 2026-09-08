import type {
  ManualUpdateInfo,
  ManualUpdatePlatform,
  UpdateNotificationState,
} from "./types";

const RELEASE_TAG_URL_PREFIX =
  "https://github.com/hudiohizari/antigravity-relay/releases/tag/";

interface BuildElectronUpdaterNotificationInput {
  state: UpdateNotificationState;
  platform: ManualUpdatePlatform;
  version: string;
  releaseName?: string | null;
}

export function buildElectronUpdaterNotification({
  state,
  platform,
  version,
  releaseName,
}: BuildElectronUpdaterNotificationInput): ManualUpdateInfo {
  const tagName = version.startsWith("v") ? version : `v${version}`;

  return {
    version,
    tagName,
    releaseName: releaseName || tagName,
    releaseUrl: `${RELEASE_TAG_URL_PREFIX}${tagName}`,
    platform,
    source: "electron-updater",
    state,
  };
}
