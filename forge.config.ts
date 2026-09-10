import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { execSync } from "child_process";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { stringify as yamlStringify } from "yaml";
import { getArtifactFileName } from "./src/shared/packaging/artifactNames";
import { packageIgnorePatterns } from "./src/shared/packaging/forgeIgnore";
import { normalizeSquirrelArtifacts } from "./src/shared/packaging/squirrelArtifacts";
import { shouldIncludeInElectronUpdaterMetadata } from "./src/shared/packaging/updateMetadata";

const nativeModules = [
  "better-sqlite3",
  "keytar",
  "bindings",
  "file-uri-to-path",
];

const artifactRegex = /.*\.(?:exe|dmg|AppImage|zip|deb|rpm|msi)$/;

const platformNamesMap: Record<string, string> = {
  darwin: "mac",
  linux: "linux",
  win32: "windows",
};

function normalizeArtifactName(value?: string) {
  if (!value) {
    return "app";
  }

  return value
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-zA-Z0-9.]/g, "")
    .replace(/\.+/g, ".");
}

function mapArchName(arch: string, mapping: Record<string, string>) {
  return mapping[arch] || arch;
}

function getUpdateYmlFileName(platform: string, arch: string): string | null {
  if (platform === "win32") {
    return "latest.yml";
  }

  if (platform === "darwin") {
    return "latest-mac.yml";
  }

  if (platform === "linux") {
    return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
  }

  return null;
}

function getChecksumArchLabel(platform: string, arch: string) {
  if (platform === "linux") {
    return mapArchName(arch, { x64: "amd64", arm64: "aarch64" });
  }

  if (platform === "darwin") {
    return mapArchName(arch, {
      x64: "x64",
      arm64: "arm64",
      universal: "universal",
    });
  }

  if (platform === "win32") {
    return mapArchName(arch, { x64: "x64", arm64: "arm64" });
  }

  return arch;
}

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
    packageAfterCopy: async (
      _config,
      buildPath,
      _electronVersion,
      platform,
      _arch,
    ) => {
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

      if (platform === "win32") {
        const koffiSrc = path.join(process.cwd(), "node_modules", "koffi");
        if (fs.existsSync(koffiSrc)) {
          fs.cpSync(koffiSrc, path.join(nodeModulesPath, "koffi"), {
            recursive: true,
          });
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
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform === "darwin") {
        for (const outputPath of packageResult.outputPaths) {
          const appPath = outputPath.endsWith(".app")
            ? outputPath
            : path.join(outputPath, "Antigravity Relay.app");
          if (fs.existsSync(appPath)) {
            try {
              execSync(`codesign --force --deep --sign - "${appPath}"`);
            } catch (err) {
              console.warn("Ad-hoc codesigning warning:", err);
            }
          }
        }
      }
    },
    preMake: async () => {
      const winstallerVendor = path.resolve(
        process.cwd(),
        "node_modules/electron-winstaller/vendor",
      );
      if (fs.existsSync(winstallerVendor)) {
        const hostArch = process.arch === "arm64" ? "arm64" : "x64";
        let exeSrc = path.join(winstallerVendor, `7z-${hostArch}.exe`);
        let dllSrc = path.join(winstallerVendor, `7z-${hostArch}.dll`);
        if (!fs.existsSync(exeSrc)) {
          exeSrc = path.join(winstallerVendor, "7z-x64.exe");
        }
        if (!fs.existsSync(dllSrc)) {
          dllSrc = path.join(winstallerVendor, "7z-x64.dll");
        }
        const exeDst = path.join(winstallerVendor, "7z.exe");
        const dllDst = path.join(winstallerVendor, "7z.dll");
        if (fs.existsSync(exeSrc) && !fs.existsSync(exeDst)) {
          fs.copyFileSync(exeSrc, exeDst);
        }
        if (fs.existsSync(dllSrc) && !fs.existsSync(dllDst)) {
          fs.copyFileSync(dllSrc, dllDst);
        }
      }

      if (process.platform === "darwin") {
        const aliasNodePath = path.resolve(
          process.cwd(),
          "node_modules/macos-alias/build/Release/volume.node",
        );
        if (!fs.existsSync(aliasNodePath)) {
          try {
            const { execSync } = await import("child_process");
            execSync("npx --yes node-gyp rebuild", {
              cwd: path.resolve(process.cwd(), "node_modules/macos-alias"),
              stdio: "inherit",
            });
          } catch (err) {
            console.warn("Failed to rebuild macos-alias:", err);
          }
        }
      }
    },
    postMake: async (_config, makeResults) => {
      if (!makeResults?.length) {
        return makeResults;
      }

      const ymlByTarget = new Map<
        string,
        {
          basePath: string;
          fileName: string;
          yml: {
            version?: string;
            files: {
              url: string;
              sha512: string;
              size: number;
            }[];
            path?: string;
            sha512?: string;
            releaseDate?: string;
          };
        }
      >();
      const checksumByTarget = new Map<
        string,
        {
          basePath: string;
          fileName: string;
          lines: string[];
        }
      >();

      makeResults = makeResults.map((result) => {
        const productName = normalizeArtifactName(
          result.packageJSON.productName || result.packageJSON.name,
        );
        const platformName =
          platformNamesMap[result.platform] || result.platform;
        const version = result.packageJSON.version;
        const platformKey = result.platform;
        const archKey = result.arch;
        const updateFileName = getUpdateYmlFileName(platformKey, archKey);
        const updateKey = updateFileName ? `${platformKey}-${archKey}` : null;
        const checksumKey = `${platformKey}-${archKey}`;
        const checksumArchLabel = getChecksumArchLabel(platformKey, archKey);
        const checksumFileName = `sha256sums-${platformName}-${checksumArchLabel}.txt`;

        if (!checksumByTarget.has(checksumKey)) {
          checksumByTarget.set(checksumKey, {
            basePath: "",
            fileName: checksumFileName,
            lines: [],
          });
        }

        if (updateFileName && updateKey && !ymlByTarget.has(updateKey)) {
          ymlByTarget.set(updateKey, {
            basePath: "",
            fileName: updateFileName,
            yml: {
              version,
              files: [],
            },
          });
        }

        const updateState = updateKey ? ymlByTarget.get(updateKey)! : null;
        const checksumState = checksumByTarget.get(checksumKey)!;

        result.artifacts = normalizeSquirrelArtifacts({
          artifacts: result.artifacts,
          platform: platformKey,
          arch: archKey,
        })
          .map((artifact) => {
            if (!artifact) {
              return null;
            }

            if (!checksumState.basePath) {
              checksumState.basePath = path.dirname(artifact);
            }

            if (updateState && !updateState.basePath) {
              updateState.basePath = path.dirname(artifact);
            }

            let currentArtifact = artifact;
            const extension = path.extname(artifact);

            if (artifactRegex.test(artifact)) {
              let archLabel = archKey;
              if (platformKey === "linux" && extension === ".rpm") {
                archLabel = mapArchName(archKey, {
                  x64: "x86_64",
                  arm64: "aarch64",
                });
              } else if (platformKey === "linux" && extension === ".deb") {
                archLabel = mapArchName(archKey, {
                  x64: "amd64",
                  arm64: "arm64",
                });
              } else if (platformKey === "linux" && extension === ".AppImage") {
                archLabel = mapArchName(archKey, {
                  x64: "amd64",
                  arm64: "aarch64",
                });
              } else if (platformKey === "darwin") {
                archLabel = mapArchName(archKey, {
                  x64: "x64",
                  arm64: "arm64",
                  universal: "universal",
                });
              } else if (platformKey === "win32") {
                archLabel = mapArchName(archKey, {
                  x64: "x64",
                  arm64: "arm64",
                });
              }

              const newArtifact = path.join(
                path.dirname(artifact),
                getArtifactFileName({
                  baseName: productName,
                  version,
                  arch: archLabel,
                  extension,
                }),
              );

              if (newArtifact !== artifact) {
                fs.renameSync(artifact, newArtifact);
              }
              currentArtifact = newArtifact;
            }

            if (
              currentArtifact.endsWith(".exe") ||
              currentArtifact.endsWith(".nupkg") ||
              currentArtifact.endsWith(".dmg") ||
              currentArtifact.endsWith(".zip") ||
              currentArtifact.endsWith(".deb") ||
              currentArtifact.endsWith(".rpm") ||
              currentArtifact.endsWith(".AppImage") ||
              currentArtifact.endsWith(".msi")
            ) {
              try {
                const fileData = fs.readFileSync(currentArtifact);
                const hash = crypto
                  .createHash("sha512")
                  .update(fileData)
                  .digest("base64");
                const sha256 = crypto
                  .createHash("sha256")
                  .update(fileData)
                  .digest("hex");
                const { size } = fs.statSync(currentArtifact);

                if (
                  updateState &&
                  shouldIncludeInElectronUpdaterMetadata({
                    platform: platformKey,
                    extension,
                  })
                ) {
                  updateState.yml.files.push({
                    url: path.basename(currentArtifact),
                    sha512: hash,
                    size,
                  });
                  if (!updateState.yml.path) {
                    updateState.yml.path = path.basename(currentArtifact);
                    updateState.yml.sha512 = hash;
                  }
                }

                checksumState.lines.push(
                  `${sha256}  ${path.basename(currentArtifact)}`,
                );
              } catch {
                console.error(`Failed to hash ${currentArtifact}`);
              }
            }

            return currentArtifact;
          })
          .filter((artifact): artifact is string => artifact !== null);

        return result;
      });

      const releaseDate = new Date().toISOString();
      for (const [updateKey, updateState] of ymlByTarget.entries()) {
        if (!updateState.basePath) {
          continue;
        }

        updateState.yml.releaseDate = releaseDate;
        const ymlPath = path.join(updateState.basePath, updateState.fileName);
        fs.writeFileSync(ymlPath, yamlStringify(updateState.yml));

        const [platform, arch] = updateKey.split("-");
        const sampleResult = makeResults.find(
          (result) => result.platform === platform && result.arch === arch,
        );
        if (!sampleResult) {
          continue;
        }

        makeResults.push({
          artifacts: [ymlPath],
          platform: sampleResult.platform,
          arch: sampleResult.arch,
          packageJSON: sampleResult.packageJSON,
        });
      }

      for (const [checksumKey, checksumState] of checksumByTarget.entries()) {
        if (!checksumState.basePath || checksumState.lines.length === 0) {
          continue;
        }

        const checksumPath = path.join(
          checksumState.basePath,
          checksumState.fileName,
        );
        fs.writeFileSync(checksumPath, `${checksumState.lines.join("\n")}\n`);

        const [platform, arch] = checksumKey.split("-");
        const sampleResult = makeResults.find(
          (result) => result.platform === platform && result.arch === arch,
        );
        if (!sampleResult) {
          continue;
        }

        makeResults.push({
          artifacts: [checksumPath],
          platform: sampleResult.platform,
          arch: sampleResult.arch,
          packageJSON: sampleResult.packageJSON,
        });
      }

      return makeResults;
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
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "hudiohizari",
          name: "antigravity-relay",
        },
        draft: true,
        prerelease: false,
      },
    },
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
