import path from "path";
import { describe, expect, it } from "vitest";

import { resolveWindowIconPath } from "@/modules/app-shell/utils/windowIcon";

describe("window icon path resolution", () => {
  it("resolves to images/icon.ico in development on Windows", () => {
    const icon = resolveWindowIconPath({
      inDevelopment: true,
      platform: "win32",
      cwd: path.join("workspace", "app"),
      resourcesPath: path.join("packaged", "resources"),
    });

    expect(icon).toBe(path.join("workspace", "app", "images", "icon.ico"));
  });

  it.each([["linux"], ["darwin"]] as const)(
    "resolves to src/assets/icon.png in development on %s",
    (platform) => {
      const icon = resolveWindowIconPath({
        inDevelopment: true,
        platform,
        cwd: path.join("workspace", "app"),
        resourcesPath: path.join("packaged", "resources"),
      });

      expect(icon).toBe(
        path.join("workspace", "app", "src", "assets", "icon.png"),
      );
    },
  );

  it("resolves to packaged assets/icon.ico in production on Windows", () => {
    const icon = resolveWindowIconPath({
      inDevelopment: false,
      platform: "win32",
      cwd: path.join("workspace", "app"),
      resourcesPath: path.join("packaged", "resources"),
    });

    expect(icon).toBe(path.join("packaged", "resources", "assets", "icon.ico"));
  });

  it.each([["linux"], ["darwin"]] as const)(
    "resolves to packaged assets/icon.png in production on %s",
    (platform) => {
      const icon = resolveWindowIconPath({
        inDevelopment: false,
        platform,
        cwd: path.join("workspace", "app"),
        resourcesPath: path.join("packaged", "resources"),
      });

      expect(icon).toBe(
        path.join("packaged", "resources", "assets", "icon.png"),
      );
    },
  );

  it("falls back to relative assets/icon.png when resourcesPath is missing in production", () => {
    const icon = resolveWindowIconPath({
      inDevelopment: false,
      platform: "linux",
      cwd: path.join("workspace", "app"),
      fallbackDirname: path.join("packaged", "build"),
    });

    expect(icon).toBe(
      path.join("packaged", "build", "..", "assets", "icon.png"),
    );
  });
});
