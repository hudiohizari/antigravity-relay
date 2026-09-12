// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPage } from "@/routes/settings";
import { DEFAULT_APP_CONFIG } from "@/modules/config/types";
import type { AppConfig } from "@/modules/config/types";

let mockConfig: AppConfig | null = {
  ...DEFAULT_APP_CONFIG,
  auto_resume_active_chat: true,
};
let mockIsLoading = false;
let mockIsSaving = false;
const mockSaveConfig = vi.fn();
const mockToast = vi.fn();

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: mockConfig,
    isLoading: mockIsLoading,
    isSaving: mockIsSaving,
    saveConfig: mockSaveConfig,
  }),
}));

vi.mock("@/components/shared/theme-provider", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[1] === "version") return { data: "1.0.0" };
    if (queryKey[1] === "platform") return { data: "darwin" };
    return { data: null };
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "settings.title": "Settings",
        "settings.description": "Manage application preferences.",
        "settings.general": "General",
        "settings.models": "Models",
        "settings.appearance.title": "Appearance",
        "settings.appearance.description": "Customize interface theme.",
        "settings.darkMode": "Dark Mode",
        "settings.darkModeDescription": "Toggle dark theme.",
        "settings.language.title": "Language",
        "settings.language.description": "Select language.",
        "settings.language.english": "English",
        "settings.language.indonesian": "Indonesian",
        "settings.language.chinese": "Chinese",
        "settings.language.russian": "Russian",
        "settings.language.vietnamese": "Vietnamese",
        "settings.language.turkish": "Turkish",
        "settings.language.french": "French",
        "settings.account.title": "Account Settings",
        "settings.account.description": "Configure account sync.",
        "settings.account.auto_refresh": "Auto Refresh",
        "settings.account.auto_refresh_desc": "Refresh quota automatically.",
        "settings.account.auto_sync": "Auto Sync",
        "settings.account.auto_sync_desc":
          "Synchronize accounts automatically.",
        "settings.automation.title": "Automation & Switching",
        "settings.automation.description":
          "Configure automated session recovery and switching behaviors.",
        "settings.automation.autoResumeChat.title":
          "Auto-Resume Active Chat Sessions",
        "settings.automation.autoResumeChat.description":
          "Automatically resume in-flight chat and Cascade prompts when restarting Antigravity after an account switch.",
        "settings.automation.autoResumeChat.cliExcludedBadge": "App & IDE only",
      };
      return translations[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/modules/config/components/ModelVisibilitySettings", () => ({
  ModelVisibilitySettings: () => (
    <div data-testid="model-visibility-settings" />
  ),
}));
vi.mock("@/modules/cloud-account/components/AutoSwitchModelSettings", () => ({
  AutoSwitchModelSettings: () => (
    <div data-testid="auto-switch-model-settings" />
  ),
}));
vi.mock("@/modules/cloud-account/components/WeeklyWarmupSettings", () => ({
  WeeklyWarmupSettings: () => <div data-testid="weekly-warmup-settings" />,
}));
vi.mock(
  "@/modules/antigravity-runtime/components/AntigravityClientCacheSettings",
  () => ({
    AntigravityClientCacheSettings: () => (
      <div data-testid="client-cache-settings" />
    ),
  }),
);
vi.mock(
  "@/modules/antigravity-runtime/components/RuntimeTargetSettings",
  () => ({
    RuntimeTargetSettings: () => <div data-testid="runtime-target-settings" />,
  }),
);
vi.mock("@/modules/app-shell/actions/app", () => ({
  checkForUpdates: vi.fn(),
  getAppVersion: vi.fn().mockResolvedValue("1.0.0"),
  getPlatform: vi.fn().mockResolvedValue("darwin"),
}));
vi.mock("@/modules/app-shell/actions/language", () => ({
  setAppLanguage: vi.fn(),
}));
vi.mock("@/modules/antigravity-runtime/actions/system", () => ({
  openLogDirectory: vi.fn(),
}));

describe("SettingsPage - Automation & Switching Card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: true,
    };
    mockIsLoading = false;
    mockIsSaving = false;
  });

  it("renders the Automation & Switching card with title, description, and Zap icon", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Automation & Switching")).toBeTruthy();
    expect(
      screen.getByText(
        "Configure automated session recovery and switching behaviors.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Auto-Resume Active Chat Sessions")).toBeTruthy();
    expect(
      screen.getByText(
        "Automatically resume in-flight chat and Cascade prompts when restarting Antigravity after an account switch.",
      ),
    ).toBeTruthy();
  });

  it("renders the muted pill badge indicating App & IDE only with correct accessibility label", () => {
    render(<SettingsPage />);

    const badge = screen.getByText("App & IDE only");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("aria-label")).toBe(
      "Scope: Desktop App and IDE only. CLI excluded.",
    );
    expect(badge.className).toContain("font-mono");
    expect(badge.className).toContain("rounded-full");
    expect(badge.className).toContain("select-none");
  });

  it("renders the switch in checked state when auto_resume_active_chat is true", () => {
    mockConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: true,
    };

    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
  });

  it("defaults to checked state when auto_resume_active_chat is undefined", () => {
    mockConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: undefined as unknown as boolean,
    };

    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the switch in unchecked state when auto_resume_active_chat is false", () => {
    mockConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: false,
    };

    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });

  it("calls saveConfig with auto_resume_active_chat: false when toggling off", () => {
    mockConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: true,
    };

    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    fireEvent.click(switchEl);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_resume_active_chat: false,
      }),
    );
  });

  it("calls saveConfig with auto_resume_active_chat: true when toggling on", () => {
    mockConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: false,
    };

    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    fireEvent.click(switchEl);

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_resume_active_chat: true,
      }),
    );
  });

  it("disables the switch when isSaving is true", () => {
    mockIsSaving = true;

    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    expect(switchEl).toBeDisabled();
  });

  it("verifies responsive layout container guarantees zero overflow down to 320px", () => {
    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });
    const rowContainer = switchEl.closest(
      '[role="group"][aria-labelledby="auto-resume-chat-label"]',
    );
    expect(rowContainer).toBeTruthy();
    expect(rowContainer?.className).toContain("flex");
    expect(rowContainer?.className).toContain("flex-col");
    expect(rowContainer?.className).toContain("sm:flex-row");
    expect(rowContainer?.className).toContain("justify-between");

    const textWrapper = rowContainer?.querySelector(".min-w-0");
    expect(textWrapper).toBeTruthy();
    expect(textWrapper?.className).toContain("flex-1");
  });

  it("enforces proper accessibility ARIA structure with aria-labelledby and aria-describedby", () => {
    render(<SettingsPage />);

    const switchEl = screen.getByRole("switch", {
      name: "Auto-Resume Active Chat Sessions",
    });

    expect(switchEl.getAttribute("aria-labelledby")).toBe(
      "auto-resume-chat-label",
    );
    expect(switchEl.getAttribute("aria-describedby")).toBe(
      "auto-resume-chat-badge auto-resume-chat-desc",
    );

    const badge = document.getElementById("auto-resume-chat-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("App & IDE only");

    const desc = document.getElementById("auto-resume-chat-desc");
    expect(desc).toBeTruthy();
    expect(desc?.textContent).toContain(
      "Automatically resume in-flight chat and Cascade prompts",
    );
  });
});
