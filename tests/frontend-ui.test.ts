import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "../src/renderer/locales/en.json";
import id from "../src/renderer/locales/id.json";
import { I18nProvider } from "../src/renderer/locales/i18n";
import { QuotaBar } from "../src/renderer/components/QuotaBar";
import { AccountCard } from "../src/renderer/components/AccountCard";
import { AutoSwitchSettings } from "../src/renderer/components/AutoSwitchSettings";
import { SnapshotModal } from "../src/renderer/components/SnapshotModal";
import { Settings } from "../src/renderer/pages/Settings";
import type {
  GoogleAccount,
  QuotaData,
  AutoSwitchConfig,
  SnapshotMetadata,
} from "../src/shared/types";

describe("Frontend Copy Catalogs & Token Architecture", () => {
  describe("i18n Catalog Symmetry and Parity", () => {
    function getAllKeys(obj: Record<string, unknown>, prefix = ""): string[] {
      let keys: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          keys = keys.concat(
            getAllKeys(value as Record<string, unknown>, fullKey),
          );
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    }

    const enKeys = getAllKeys(en as unknown as Record<string, unknown>).sort();
    const idKeys = getAllKeys(id as unknown as Record<string, unknown>).sort();

    it("should have identical key counts in English and Indonesian catalogs", () => {
      expect(enKeys.length).toBe(idKeys.length);
      expect(enKeys.length).toBeGreaterThanOrEqual(40);
    });

    it("should have 100% key parity between en.json and id.json", () => {
      expect(enKeys).toEqual(idKeys);
    });

    it("should have non-empty string values for all leaves in both catalogs", () => {
      for (const key of enKeys) {
        const resolve = (obj: Record<string, unknown>, p: string): unknown =>
          p
            .split(".")
            .reduce<unknown>(
              (acc, part) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string, unknown>)[part]
                  : undefined,
              obj,
            );

        const enVal = resolve(en as unknown as Record<string, unknown>, key);
        const idVal = resolve(id as unknown as Record<string, unknown>, key);

        expect(typeof enVal).toBe("string");
        expect((enVal as string).trim().length).toBeGreaterThan(0);
        expect(typeof idVal).toBe("string");
        expect((idVal as string).trim().length).toBeGreaterThan(0);
      }
    });

    it("should use standard hyphens or commas only and zero em/en dashes", () => {
      for (const key of enKeys) {
        const resolve = (obj: Record<string, unknown>, p: string): string =>
          p
            .split(".")
            .reduce<unknown>(
              (acc, part) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string, unknown>)[part]
                  : undefined,
              obj,
            ) as string;

        const enVal = resolve(en as unknown as Record<string, unknown>, key);
        const idVal = resolve(id as unknown as Record<string, unknown>, key);

        expect(enVal).not.toContain("—");
        expect(enVal).not.toContain("–");
        expect(idVal).not.toContain("—");
        expect(idVal).not.toContain("–");
      }
    });
  });

  describe("DTCG Design Tokens Verification", () => {
    const tokensCssPath = path.resolve(
      __dirname,
      "../src/renderer/styles/tokens.css",
    );
    const tokensContent = fs.readFileSync(tokensCssPath, "utf-8");

    it("should declare all required semantic background surfaces", () => {
      expect(tokensContent).toContain("--bg-canvas");
      expect(tokensContent).toContain("--bg-surface");
      expect(tokensContent).toContain("--bg-surface-elevated");
      expect(tokensContent).toContain("--bg-subtle");
    });

    it("should declare WCAG AA focus border token matching emerald", () => {
      expect(tokensContent).toContain(
        "--border-focus: var(--primitive-color-emerald-500)",
      );
      expect(tokensContent).toContain("--outline-focus-width: 2px");
      expect(tokensContent).toContain("--outline-focus-offset: 2px");
    });

    it("should enforce minimum 44px touch targets", () => {
      expect(tokensContent).toContain("--target-min-width: 44px");
      expect(tokensContent).toContain("--target-min-height: 44px");
      expect(tokensContent).toContain("--target-clearance: 8px");
    });

    it("should declare fluid typography clamp scales", () => {
      expect(tokensContent).toContain("--primitive-font-size-xs: clamp");
      expect(tokensContent).toContain("--primitive-font-size-base: clamp");
      expect(tokensContent).toContain("--primitive-font-size-2xl: clamp");
    });

    it("should declare macOS titlebar traffic lights clearance (min 76px)", () => {
      expect(tokensContent).toContain("--comp-titlebar-padding-left: 76px");
    });
  });

  describe("Anti-AI Slop & Clean Codebase Invariants", () => {
    const rendererDir = path.resolve(__dirname, "../src/renderer");

    function getFiles(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(getFiles(fullPath));
        } else {
          results.push(fullPath);
        }
      }
      return results;
    }

    const rendererFiles = getFiles(rendererDir);

    it("should contain zero workflow or task tracking metadata in source code", () => {
      const taskMetadataRegex = /(TASK-\d+|AC-\d+)/gi;

      for (const file of rendererFiles) {
        const content = fs.readFileSync(file, "utf-8");
        const matches = content.match(taskMetadataRegex);
        expect(
          matches,
          `File ${path.relative(rendererDir, file)} contains task tracking metadata: ${matches?.join(", ")}`,
        ).toBeNull();
      }
    });

    it("should contain zero inline style attributes (style=) in renderer components", () => {
      const componentFiles = rendererFiles.filter(
        (f) => f.endsWith(".tsx") || f.endsWith(".jsx"),
      );

      for (const file of componentFiles) {
        const content = fs.readFileSync(file, "utf-8");
        const inlineStyleRegex = /style\s*=\s*\{/g;
        const matches = content.match(inlineStyleRegex);
        expect(
          matches,
          `Component ${path.relative(rendererDir, file)} contains banned inline style="..."`,
        ).toBeNull();
      }
    });
  });

  describe("Desktop UI Component Architecture & Verification", () => {
    function renderWithI18n(
      element: React.ReactElement,
      locale: "en" | "id" = "en",
    ): string {
      return renderToStaticMarkup(
        React.createElement(I18nProvider, {
          defaultLocale: locale,
          children: element,
        }),
      );
    }

    it("should render QuotaBar with color-coded model progress meters and ARIA progressbar roles", () => {
      const mockQuota: QuotaData = {
        models: {
          "gemini-2.0-flash": {
            percentage: 82,
            remainingQueries: 4100,
            totalQueries: 5000,
            resetTime: new Date(Date.now() + 19320000).toISOString(),
          },
          "gemini-1.5-pro": {
            percentage: 34,
            remainingQueries: 340,
            totalQueries: 1000,
            resetTime: new Date(Date.now() + 3900000).toISOString(),
          },
          "claude-3-5-sonnet-vertex": {
            percentage: 9,
            remainingQueries: 45,
            totalQueries: 500,
            resetTime: new Date(Date.now() + 2880000).toISOString(),
          },
        },
        source: "api",
      };

      const html = renderWithI18n(
        React.createElement(QuotaBar, { quota: mockQuota }),
      );

      // Model labels
      expect(html).toContain("Gemini 2.0 Flash");
      expect(html).toContain("Gemini 1.5 Pro");
      expect(html).toContain("Claude 3.5 Sonnet (Vertex)");

      // ARIA semantics
      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-valuenow="82"');
      expect(html).toContain('aria-valuenow="34"');
      expect(html).toContain('aria-valuenow="9"');

      // DTCG Status Token Fills
      expect(html).toContain("fill-[var(--status-quota-healthy)]");
      expect(html).toContain("fill-[var(--status-quota-warning)]");
      expect(html).toContain("fill-[var(--status-quota-exhausted)]");
    });

    it("should render QuotaBar with purple cooldown fill and cached telemetry indicator", () => {
      const cachedQuota: QuotaData = {
        models: {
          "gemini-2.0-flash": {
            percentage: 0,
            resetTime: new Date(Date.now() + 900000).toISOString(),
          },
        },
        source: "cached",
      };

      const html = renderWithI18n(
        React.createElement(QuotaBar, {
          quota: cachedQuota,
          isRateLimited: true,
        }),
      );

      expect(html).toContain("Cached Data");
      expect(html).toContain("fill-[var(--status-quota-cooldown)]");
      expect(html).toContain("animate-pulse");
    });

    it("should render QuotaBar with dynamic model display names matching Google Code Assist", () => {
      const dynamicQuota: QuotaData = {
        models: {
          "gemini-3.1-pro": {
            modelId: "gemini-3.1-pro",
            displayName: "Gemini 3.1 Pro",
            percentage: 85,
            resetTime: new Date(Date.now() + 3600000).toISOString(),
          },
          "claude-sonnet-4-6": {
            modelId: "claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            percentage: 90,
            resetTime: new Date(Date.now() + 3600000).toISOString(),
          },
        },
        source: "api",
      };

      const html = renderWithI18n(
        React.createElement(QuotaBar, { quota: dynamicQuota }),
      );

      expect(html).toContain("Gemini 3.1 Pro");
      expect(html).toContain("Claude Sonnet 4.6");
      expect(html).toContain('aria-label="Gemini 3.1 Pro quota remaining 85%"');
      expect(html).toContain(
        'aria-label="Claude Sonnet 4.6 quota remaining 90%"',
      );
    });

    it("should render AccountCard with integrated QuotaBar, cooldown badge, and manual switch CTA", () => {
      const healthyAccount: GoogleAccount = {
        id: "acc-healthy-1",
        email: "bot.runner@gmail.com",
        status: "disabled",
        tokens: {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        quota: {
          models: {
            "gemini-2.0-flash": {
              percentage: 75,
              resetTime: new Date(Date.now() + 3600000).toISOString(),
            },
          },
          source: "api",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const htmlHealthy = renderWithI18n(
        React.createElement(AccountCard, {
          account: healthyAccount,
          isActive: false,
          isRefreshing: false,
          isDeleting: false,
          onRefreshToken: async () => true,
          onRemoveRequest: () => {},
        }),
      );

      expect(htmlHealthy).toContain("bot.runner@gmail.com");
      expect(htmlHealthy).toContain("Switch Now");
      expect(htmlHealthy).toContain("Gemini 2.0 Flash");

      // Rate-limited account with cooldown badge
      const rateLimitedAccount: GoogleAccount = {
        ...healthyAccount,
        status: "rate_limited",
      };

      const htmlCooldown = renderWithI18n(
        React.createElement(AccountCard, {
          account: rateLimitedAccount,
          isActive: false,
          isRefreshing: false,
          isDeleting: false,
          rateLimitState: {
            accountId: rateLimitedAccount.id,
            isRateLimited: true,
            cooldownUntil: Date.now() + 824000,
            retryCount: 1,
          },
          onRefreshToken: async () => true,
          onRemoveRequest: () => {},
        }),
      );

      expect(htmlCooldown).toContain('role="timer"');
      expect(htmlCooldown).toContain("Cooldown:");
      expect(htmlCooldown).toContain("In Cooldown");
    });

    it("should render AccountCard with avatar image and no-referrer policy", () => {
      const accountWithAvatar: GoogleAccount = {
        id: "acc-avatar-1",
        email: "alice@example.com",
        avatarUrl: "https://lh3.googleusercontent.com/a/mock-avatar-photo",
        status: "active",
        tokens: {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const htmlWithAvatar = renderWithI18n(
        React.createElement(AccountCard, {
          account: accountWithAvatar,
          isActive: true,
          isRefreshing: false,
          isDeleting: false,
          onRefreshToken: async () => true,
          onRemoveRequest: () => {},
        }),
      );

      expect(htmlWithAvatar).toContain('referrerPolicy="no-referrer"');
      expect(htmlWithAvatar).toContain(
        "https://lh3.googleusercontent.com/a/mock-avatar-photo",
      );

      const accountWithoutAvatar: GoogleAccount = {
        ...accountWithAvatar,
        avatarUrl: undefined,
      };

      const htmlWithoutAvatar = renderWithI18n(
        React.createElement(AccountCard, {
          account: accountWithoutAvatar,
          isActive: false,
          isRefreshing: false,
          isDeleting: false,
          onRefreshToken: async () => true,
          onRemoveRequest: () => {},
        }),
      );

      expect(htmlWithoutAvatar).not.toContain("<img");
      expect(htmlWithoutAvatar).toContain("A");
    });

    it("should render AutoSwitchSettings with threshold slider, evaluation interval, and manual switch action", () => {
      const mockConfig: AutoSwitchConfig = {
        enabled: true,
        minQuotaThresholdPercent: 15,
        pollIntervalMs: 300000,
        rateLimitCooldownMs: 900000,
        autoRelaunchProcesses: true,
        preferredModels: ["gemini-2.0-flash", "gemini-1.5-pro"],
      };

      const mockAccounts: GoogleAccount[] = [
        {
          id: "acc-1",
          email: "alex.dev@gmail.com",
          status: "active",
          tokens: {
            access_token: "t",
            refresh_token: "r",
            expires_in: 3600,
            expiry_timestamp: Date.now() + 3600000,
            token_type: "Bearer",
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const html = renderWithI18n(
        React.createElement(AutoSwitchSettings, {
          config: mockConfig,
          accounts: mockAccounts,
          isSaving: false,
          isSwitching: false,
          switchingAccountId: null,
          lastSwitchResult: null,
          poolExhaustedReason: null,
          onSaveConfig: async () => true,
          onManualSwitch: async () => true,
        }),
      );

      expect(html).toContain("Auto-Switching Engine");
      expect(html).toContain('role="switch"');
      expect(html).toContain('type="range"');
      expect(html).toContain("Minimum Quota Threshold");
      expect(html).toContain("Evaluation Polling Interval");
      expect(html).toContain("Rate-Limit Cooldown Duration");
      expect(html).toContain("Auto-Relaunch Services");
      expect(html).toContain("80% remaining quota + 20% least-recently-used");
      expect(html).toContain("Save Switcher Settings");
      expect(html).toContain("Restore Defaults");
    });

    it("should render SnapshotModal with encrypted snapshots listing, AES-256-GCM descriptors, and actions", () => {
      const mockSnapshots: SnapshotMetadata[] = [
        {
          id: "snap-pre-refactor",
          name: "Pre-Refactor Pool",
          description: "Stable baseline before test suite",
          createdAt: Date.now() - 3600000,
          accountCount: 4,
          activeAccountEmail: "alex.dev@gmail.com",
          sizeBytes: 4300,
        },
      ];

      const html = renderWithI18n(
        React.createElement(SnapshotModal, {
          isOpen: true,
          onClose: () => {},
          snapshots: mockSnapshots,
          isLoading: false,
          isCreating: false,
          restoringId: null,
          deletingId: null,
          onCreateSnapshot: async () => true,
          onRestoreSnapshot: async () => true,
          onDeleteSnapshot: async () => true,
        }),
      );

      expect(html).toContain("Account Snapshots");
      expect(html).toContain("Pre-Refactor Pool");
      expect(html).toContain("AES-256-GCM");
      expect(html).toContain("4 accounts saved");
      expect(html).toContain("alex.dev@gmail.com");
      expect(html).toContain("Restore");
      expect(html).toContain("Create Snapshot");
    });

    it("should render empty state in SnapshotModal when no snapshots exist", () => {
      const html = renderWithI18n(
        React.createElement(SnapshotModal, {
          isOpen: true,
          onClose: () => {},
          snapshots: [],
          isLoading: false,
          isCreating: false,
          restoringId: null,
          deletingId: null,
          onCreateSnapshot: async () => true,
          onRestoreSnapshot: async () => true,
          onDeleteSnapshot: async () => true,
        }),
      );

      expect(html).toContain("No snapshots found");
      expect(html).toContain("Save an encrypted snapshot");
    });

    it("should render Settings page with all configuration sections and action bar", () => {
      const html = renderWithI18n(React.createElement(Settings));

      // Page Title & Subtitle
      expect(html).toContain("Application Settings");
      expect(html).toContain(
        "Manage persistent configurations, OAuth credentials, process discovery, and desktop preferences",
      );

      // Section 1: General Preferences
      expect(html).toContain("General Preferences");
      expect(html).toContain("Theme");
      expect(html).toContain("Interface Language");
      expect(html).toContain("Minimize to System Tray on Close");
      expect(html).toContain("Launch at System Startup");

      // Section 2: Google OAuth Credentials
      expect(html).toContain("Google OAuth Credentials");
      expect(html).toContain("Client ID");
      expect(html).toContain("Client Secret");
      expect(html).toContain("Encrypted on disk with AES-256-GCM");
      expect(html).toContain('aria-label="Show client secret"');

      // Section 3: Binary Paths & Process Discovery
      expect(html).toContain("Binary Paths &amp; Process Discovery");
      expect(html).toContain("Antigravity Daemon Binary (agy)");
      expect(html).toContain("Antigravity IDE Executable");
      expect(html).toContain("Browse...");
      expect(html).toContain("Auto-Detect");

      // Section 4: Network & Remote Tethering
      expect(html).toContain("Network &amp; Remote Tethering");
      expect(html).toContain("Local Relay Server Port");
      expect(html).toContain("Cloudflare Named Tunnel Token (Optional)");
      expect(html).toContain('aria-label="Show tunnel token"');

      // Section 5: Desktop Notifications
      expect(html).toContain("Desktop Notifications");
      expect(html).toContain("Enable Desktop Notifications");
      expect(html).toContain("Account Auto-Switch Events");
      expect(html).toContain("Rate Limit Cooldown Alerts");
      expect(html).toContain("Service Crashes &amp; Process Alerts");

      // Section 6: Action Bar & Reset Dialog
      expect(html).toContain("Reset to Defaults");
      expect(html).toContain("Save Settings");
      expect(html).toContain("Reset All Settings to Defaults?");
      expect(html).toContain(
        "This will restore standard ports, default binary discovery, and clear custom OAuth credentials. Continue?",
      );
    });

    it("should render Settings with Indonesian locale correctly", () => {
      const html = renderWithI18n(React.createElement(Settings), "id");

      expect(html).toContain("Pengaturan Aplikasi");
      expect(html).toContain("Preferensi Umum");
      expect(html).toContain("Kredensial OAuth Google");
      expect(html).toContain("Jalur Biner &amp; Penemuan Proses");
      expect(html).toContain("Jaringan &amp; Penambatan Jarak Jauh");
      expect(html).toContain("Pemberitahuan Desktop");
      expect(html).toContain("Simpan Pengaturan");
      expect(html).toContain("Kembalikan ke Default");
    });

    it("should enforce WCAG 2.2 AA touch targets, focus outlines, and ARIA switch roles in Settings", () => {
      const html = renderWithI18n(React.createElement(Settings));

      // Minimum 44px touch targets
      expect(html).toContain("min-h-[44px]");
      expect(html).toContain("min-w-[44px]");

      // High-contrast emerald focus outlines
      expect(html).toContain("focus-visible:ring-[var(--border-focus)]");

      // Semantic Switch roles & states
      expect(html).toContain('role="switch"');
      expect(html).toContain('aria-checked="true"');

      // Accessible Secret show/hide toggles
      expect(html).toContain('aria-pressed="false"');

      // Screen-reader live region
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    });
  });
});
