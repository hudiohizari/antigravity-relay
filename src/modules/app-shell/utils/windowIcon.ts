import path from "path";

export interface WindowIconPathOptions {
  inDevelopment: boolean;
  platform: NodeJS.Platform;
  cwd: string;
  resourcesPath?: string;
  fallbackDirname?: string;
}

export function resolveWindowIconPath({
  inDevelopment,
  platform,
  cwd,
  resourcesPath,
  fallbackDirname,
}: WindowIconPathOptions): string {
  if (inDevelopment) {
    return platform === "win32"
      ? path.join(cwd, "images/icon.ico")
      : path.join(cwd, "src/assets/icon.png");
  }

  if (resourcesPath) {
    if (platform === "win32") {
      return path.join(resourcesPath, "assets/icon.ico");
    }
    return path.join(resourcesPath, "assets/icon.png");
  }

  return path.join(fallbackDirname || "", "../assets/icon.png");
}
