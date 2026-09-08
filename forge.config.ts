import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import * as fs from "fs";
import * as path from "path";
import { packageIgnorePatterns } from "./src/shared/packaging/forgeIgnore";

const nativeModules = [
  "better-sqlite3",
  "keytar",
  "bindings",
  "file-uri-to-path",
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/{better-sqlite3,keytar,ps-list}/**/*",
    },
    name: "Antigravity Relay",
    executableName: "antigravity-relay",
    icon: "images/icon",
    extraResource: ["src/assets"],
    ignore: packageIgnorePatterns,
    prune: true,
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const nodeModulesPath = path.join(buildPath, "node_modules");
      if (!fs.existsSync(nodeModulesPath)) {
        fs.mkdirSync(nodeModulesPath, { recursive: true });
      }

      for (const moduleName of nativeModules) {
        const srcPath = path.join(process.cwd(), "node_modules", moduleName);
        const destPath = path.join(nodeModulesPath, moduleName);
        if (fs.existsSync(srcPath)) {
          fs.cpSync(srcPath, destPath, { recursive: true });
        }
      }

      const assetsSrc = path.join(process.cwd(), "src", "assets");
      const assetsDest = path.join(buildPath, "resources", "assets");
      if (fs.existsSync(assetsSrc)) {
        if (!fs.existsSync(assetsDest)) {
          fs.mkdirSync(assetsDest, { recursive: true });
        }
        fs.cpSync(assetsSrc, assetsDest, { recursive: true });
      }
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: "images/icon.ico",
    }),
    new MakerDMG(
      {
        overwrite: true,
        icon: "images/icon.icns",
        iconSize: 160,
      },
      ["darwin"],
    ),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    new AutoUnpackNativesPlugin({}),
  ],
};

export default config;
