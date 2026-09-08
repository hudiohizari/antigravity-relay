const WINDOWS_UPDATE_BASE_URL =
  "https://raw.githubusercontent.com/hudiohizari/antigravity-relay/release-updates";

export function getWindowsUpdateBaseUrl({
  platform = process.platform,
  arch = process.arch,
}: {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
} = {}) {
  return `${WINDOWS_UPDATE_BASE_URL}/${platform}/${arch}`;
}
