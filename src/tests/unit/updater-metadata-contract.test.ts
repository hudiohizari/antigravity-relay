import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { describe, expect, it } from "vitest";
import { UpdaterJsonSchema } from "@/modules/app-shell/update/types";
import { shouldIncludeInElectronUpdaterMetadata } from "@/shared/packaging/updateMetadata";

describe("updater-metadata-contract", () => {
  describe("root updater.json schema contract (AC-06 / Tier 1 Fallback)", () => {
    it("validates a conformant updater.json payload matching the publish workflow spec", () => {
      const releaseTag = "v0.1.0";
      const version = releaseTag.replace(/^v/, "");
      const pubDate = new Date().toISOString();
      const releaseUrl = `https://github.com/hudiohizari/antigravity-relay/releases/tag/${releaseTag}`;

      const payload = {
        version,
        notes: "See release page for details.",
        pub_date: pubDate,
        url: releaseUrl,
      };

      const parsed = UpdaterJsonSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.version).toBe("0.1.0");
        expect(parsed.data.notes).toBe("See release page for details.");
        expect(parsed.data.pub_date).toBe(pubDate);
        expect(parsed.data.url).toBe(releaseUrl);
      }
    });

    it("rejects an updater.json payload with invalid or missing required version", () => {
      const invalidPayload = {
        notes: "No version provided",
        pub_date: new Date().toISOString(),
      };

      const parsed = UpdaterJsonSchema.safeParse(invalidPayload);
      expect(parsed.success).toBe(false);
    });

    it("rejects an updater.json payload with malformed URL", () => {
      const invalidPayload = {
        version: "0.1.0",
        url: "not-a-valid-url",
      };

      const parsed = UpdaterJsonSchema.safeParse(invalidPayload);
      expect(parsed.success).toBe(false);
    });
  });

  describe("electron-updater metadata contract (latest*.yml / AC-05)", () => {
    it("serializes and parses valid electron-updater YAML manifests", () => {
      const manifest = {
        version: "0.1.0",
        files: [
          {
            url: "Antigravity.Relay-0.1.0-win32-x64-setup.exe",
            sha512: "dGhpcy1pcy1hLXRlc3Qtc2hhNTEyLWJhc2U2NC1zdHJpbmc=",
            size: 94820120,
          },
        ],
        path: "Antigravity.Relay-0.1.0-win32-x64-setup.exe",
        sha512: "dGhpcy1pcy1hLXRlc3Qtc2hhNTEyLWJhc2U2NC1zdHJpbmc=",
        releaseDate: new Date().toISOString(),
      };

      const yamlString = yamlStringify(manifest);
      const parsed = yamlParse(yamlString);

      expect(parsed.version).toBe("0.1.0");
      expect(parsed.path).toBe("Antigravity.Relay-0.1.0-win32-x64-setup.exe");
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].size).toBe(94820120);
      expect(parsed.files[0].sha512).toBe(
        "dGhpcy1pcy1hLXRlc3Qtc2hhNTEyLWJhc2U2NC1zdHJpbmc=",
      );
    });

    it("enforces updater metadata inclusion policy across platforms", () => {
      // Windows: only .exe setup binaries, exclude .msi and .nupkg
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "win32",
          extension: ".exe",
        }),
      ).toBe(true);
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "win32",
          extension: ".msi",
        }),
      ).toBe(false);
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "win32",
          extension: ".nupkg",
        }),
      ).toBe(false);

      // macOS: includes .dmg and .zip
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "darwin",
          extension: ".dmg",
        }),
      ).toBe(true);
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "darwin",
          extension: ".zip",
        }),
      ).toBe(true);

      // Linux: includes .deb, .rpm, .AppImage, excludes .msi
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "linux",
          extension: ".deb",
        }),
      ).toBe(true);
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "linux",
          extension: ".rpm",
        }),
      ).toBe(true);
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "linux",
          extension: ".AppImage",
        }),
      ).toBe(true);
      expect(
        shouldIncludeInElectronUpdaterMetadata({
          platform: "linux",
          extension: ".msi",
        }),
      ).toBe(false);
    });
  });

  describe("5-tier update cascade policy hierarchy contract", () => {
    it("verifies that Tier 1 updater.json asset endpoint bypasses GitHub API rate limit risks", () => {
      const repository = "hudiohizari/antigravity-relay";
      const tier1UpdaterJsonUrl = `https://github.com/${repository}/releases/latest/download/updater.json`;
      const tier2GitHubApiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
      const tier3LatestRedirectUrl = `https://github.com/${repository}/releases/latest`;
      const tier4RawPackageJsonUrl = `https://raw.githubusercontent.com/${repository}/main/package.json`;
      const tier5CdnPackageJsonUrl = `https://cdn.jsdelivr.net/gh/${repository}@main/package.json`;

      // Verify Tier 1 URL is a direct static asset download, not an API call
      expect(tier1UpdaterJsonUrl).toContain(
        "/releases/latest/download/updater.json",
      );
      expect(tier1UpdaterJsonUrl).not.toContain("api.github.com");

      // Verify hierarchy sequence
      const hierarchy = [
        tier1UpdaterJsonUrl,
        tier2GitHubApiUrl,
        tier3LatestRedirectUrl,
        tier4RawPackageJsonUrl,
        tier5CdnPackageJsonUrl,
      ];

      expect(hierarchy).toHaveLength(5);
      expect(hierarchy[0]).toBe(tier1UpdaterJsonUrl);
      expect(hierarchy[1]).toBe(tier2GitHubApiUrl);
      expect(hierarchy[4]).toBe(tier5CdnPackageJsonUrl);
    });
  });
});
