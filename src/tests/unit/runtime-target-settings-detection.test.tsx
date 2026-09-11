// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { RuntimeTargetSettings } from "@/modules/antigravity-runtime/components/RuntimeTargetSettings";
import {
  RuntimeBatchConflictDialog,
  BatchConflictItem,
} from "@/modules/antigravity-runtime/components/RuntimeBatchConflictDialog";
import { RuntimeSingleConflictDialog } from "@/modules/antigravity-runtime/components/RuntimeSingleConflictDialog";
import type { AppConfig } from "@/modules/config/types";
import type { DetectedExecutableResult } from "@/shared/platform/paths";

const mockDetectAntigravityExecutable = vi.fn();
const mockDetectAllAntigravityExecutables = vi.fn();
const mockSelectAntigravityExecutable = vi.fn();
const mockGetAntigravityArgs = vi.fn();
const mockToast = vi.fn();

vi.mock("@/modules/antigravity-runtime/actions/system", () => ({
  detectAntigravityExecutable: (...args: unknown[]) =>
    mockDetectAntigravityExecutable(...args),
  detectAllAntigravityExecutables: (...args: unknown[]) =>
    mockDetectAllAntigravityExecutables(...args),
  selectAntigravityExecutable: (...args: unknown[]) =>
    mockSelectAntigravityExecutable(...args),
  getAntigravityArgs: (...args: unknown[]) => mockGetAntigravityArgs(...args),
}));

vi.mock("@/modules/config/hooks/useAppConfig", () => ({
  useAppConfig: () => ({
    config: null,
    saveConfig: vi.fn(),
    isLoading: false,
    isSaving: false,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let result = key;
      if (options?.target) {
        result += `:${String(options.target)}`;
      }
      if (options?.path) {
        result += `:${String(options.path)}`;
      }
      if (options?.count !== undefined) {
        result += `:${String(options.count)}`;
      }
      return result;
    },
  }),
}));

describe("RuntimeTargetSettings - Target Executable Auto-Detection", () => {
  const baseConfig: AppConfig = {
    theme: "system",
    language: "en",
    auto_refresh: true,
    auto_sync: true,
    auto_startup: false,
    start_in_tray: false,
    quota_alert_enabled: false,
    quota_alert_threshold: 10,
    antigravity_executable: "C:\\Program Files\\Antigravity\\Antigravity.exe",
    antigravity_args: [],
    antigravity_ide_executable: "/Applications/Antigravity IDE.app",
    antigravity_ide_args: [],
    antigravity_cli_executable: "/usr/local/bin/agy",
  } as unknown as AppConfig;

  let saveConfigMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    saveConfigMock = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe("UI Rendering & Action Buttons", () => {
    it("renders Auto-Detect All button in CardHeader with aria attributes", () => {
      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      expect(bulkButton).toBeTruthy();
      expect(bulkButton.getAttribute("aria-busy")).toBe("false");
      expect(bulkButton).not.toHaveProperty("disabled", true);
      expect(
        screen.getByText("settings.runtimes.auto_detect_all"),
      ).toBeTruthy();
    });

    it("renders row-level Detect buttons before Browse with Search icon and proper ARIA labels", () => {
      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      const ideDetectBtn = screen.getByLabelText(
        "settings.runtimes.ide.detect_exec_aria",
      );
      const cliDetectBtn = screen.getByLabelText(
        "settings.runtimes.cli.detect_exec_aria",
      );

      expect(appDetectBtn).toBeTruthy();
      expect(ideDetectBtn).toBeTruthy();
      expect(cliDetectBtn).toBeTruthy();

      expect(appDetectBtn.getAttribute("aria-busy")).toBe("false");
      expect(ideDetectBtn.getAttribute("aria-busy")).toBe("false");
      expect(cliDetectBtn.getAttribute("aria-busy")).toBe("false");

      // Verify buttons contain Detect text
      const detectLabels = screen.getAllByText("settings.runtimes.detect_exec");
      expect(detectLabels.length).toBe(3);
    });
  });

  describe("Row-Level Executable Detection", () => {
    it("auto-populates and saves immediately when current path is empty", async () => {
      const configWithEmptyApp: AppConfig = {
        ...baseConfig,
        antigravity_executable: "",
      };

      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath:
          "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
        source: "filesystem",
        configuredPath: null,
        configuredPathExists: false,
        alreadySet: false,
        status: "detected",
      };
      mockDetectAntigravityExecutable.mockResolvedValueOnce(mockResult);

      render(
        <RuntimeTargetSettings
          config={configWithEmptyApp}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      fireEvent.click(appDetectBtn);

      await waitFor(() => {
        expect(mockDetectAntigravityExecutable).toHaveBeenCalledWith({
          target: "app",
          bypassConfig: true,
        });
        expect(saveConfigMock).toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_executable:
              "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
          }),
        );
      });

      const appInput = screen.getByLabelText(
        "settings.runtimes.app.executable",
      );
      expect(appInput).toHaveProperty(
        "value",
        "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
      );

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.exec_detected_title",
        }),
      );
    });

    it("auto-populates and saves immediately when existing path does not exist on disk", async () => {
      const configWithStalePath: AppConfig = {
        ...baseConfig,
        antigravity_ide_executable: "/non/existent/path/to/ide",
      };

      const mockResult: DetectedExecutableResult = {
        target: "ide",
        detectedPath:
          "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
        source: "filesystem",
        configuredPath: "/non/existent/path/to/ide",
        configuredPathExists: false, // does NOT exist on disk
        alreadySet: false,
        status: "detected",
      };
      mockDetectAntigravityExecutable.mockResolvedValueOnce(mockResult);

      render(
        <RuntimeTargetSettings
          config={configWithStalePath}
          saveConfig={saveConfigMock}
        />,
      );

      const ideDetectBtn = screen.getByLabelText(
        "settings.runtimes.ide.detect_exec_aria",
      );
      fireEvent.click(ideDetectBtn);

      await waitFor(() => {
        expect(saveConfigMock).toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_ide_executable:
              "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
          }),
        );
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.exec_detected_title",
        }),
      );
    });

    it("displays already configured info toast when detected path matches current setting", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
        source: "filesystem",
        configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
        configuredPathExists: true,
        alreadySet: true,
        status: "already_set",
      };
      mockDetectAntigravityExecutable.mockResolvedValueOnce(mockResult);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      fireEvent.click(appDetectBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_already_set_title",
          }),
        );
      });

      expect(saveConfigMock).not.toHaveBeenCalled();
    });

    it("displays warning toast and preserves existing configuration when no binary is found", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "cli",
        detectedPath: null,
        source: "none",
        configuredPath: "/usr/local/bin/agy",
        configuredPathExists: true,
        alreadySet: false,
        status: "not_found",
      };
      mockDetectAntigravityExecutable.mockResolvedValueOnce(mockResult);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const cliDetectBtn = screen.getByLabelText(
        "settings.runtimes.cli.detect_exec_aria",
      );
      fireEvent.click(cliDetectBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_not_found_title",
          }),
        );
      });

      expect(saveConfigMock).not.toHaveBeenCalled();
      const cliInput = screen.getByLabelText(
        "settings.runtimes.cli.executable",
      );
      expect(cliInput).toHaveProperty("value", "/usr/local/bin/agy");
    });

    it("opens single conflict dialog when a differing valid path exists, supporting Keep Current", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath: "C:\\NewInstall\\Antigravity\\antigravity.exe",
        source: "process",
        configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
        configuredPathExists: true,
        alreadySet: false,
        status: "detected",
      };
      mockDetectAntigravityExecutable.mockResolvedValueOnce(mockResult);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      fireEvent.click(appDetectBtn);

      // Verify dialog opens
      await waitFor(() => {
        expect(
          screen.getByText("settings.runtimes.dialog.replace_title"),
        ).toBeTruthy();
      });

      // Click Keep Current
      const keepBtn = screen.getByText("settings.runtimes.dialog.keep_current");
      fireEvent.click(keepBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_preserved_title",
          }),
        );
      });

      expect(saveConfigMock).not.toHaveBeenCalled();
    });

    it("opens single conflict dialog when differing path exists and replaces path on confirm", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath: "C:\\NewInstall\\Antigravity\\antigravity.exe",
        source: "process",
        configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
        configuredPathExists: true,
        alreadySet: false,
        status: "detected",
      };
      mockDetectAntigravityExecutable.mockResolvedValueOnce(mockResult);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      fireEvent.click(appDetectBtn);

      await waitFor(() => {
        expect(
          screen.getByText("settings.runtimes.dialog.replace_title"),
        ).toBeTruthy();
      });

      // Click Replace button
      const replaceBtn = screen.getByText(
        "settings.runtimes.dialog.replace_all",
      );
      fireEvent.click(replaceBtn);

      await waitFor(() => {
        expect(saveConfigMock).toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_executable:
              "C:\\NewInstall\\Antigravity\\antigravity.exe",
          }),
        );
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_detected_title",
          }),
        );
      });

      const appInput = screen.getByLabelText(
        "settings.runtimes.app.executable",
      );
      expect(appInput).toHaveProperty(
        "value",
        "C:\\NewInstall\\Antigravity\\antigravity.exe",
      );
    });
  });

  describe("Mutual Disabling and Debouncing", () => {
    it("mutually disables all detect buttons when any detection scan is in flight", async () => {
      let resolvePromise!: (val: DetectedExecutableResult) => void;
      const pendingPromise = new Promise<DetectedExecutableResult>(
        (resolve) => {
          resolvePromise = resolve;
        },
      );
      mockDetectAntigravityExecutable.mockReturnValueOnce(pendingPromise);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      const ideDetectBtn = screen.getByLabelText(
        "settings.runtimes.ide.detect_exec_aria",
      );
      const cliDetectBtn = screen.getByLabelText(
        "settings.runtimes.cli.detect_exec_aria",
      );
      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );

      // Trigger app detection
      fireEvent.click(appDetectBtn);

      // Verify mutual disabling
      expect(appDetectBtn).toHaveProperty("disabled", true);
      expect(appDetectBtn.getAttribute("aria-busy")).toBe("true");
      expect(ideDetectBtn).toHaveProperty("disabled", true);
      expect(cliDetectBtn).toHaveProperty("disabled", true);
      expect(bulkButton).toHaveProperty("disabled", true);

      // Attempt second click on bulkButton - debounced/dropped
      fireEvent.click(bulkButton);
      expect(mockDetectAllAntigravityExecutables).not.toHaveBeenCalled();

      // Resolve pending detection
      resolvePromise({
        target: "app",
        detectedPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
        source: "filesystem",
        configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
        configuredPathExists: true,
        alreadySet: true,
        status: "already_set",
      });

      await waitFor(() => {
        expect(appDetectBtn).toHaveProperty("disabled", false);
        expect(appDetectBtn.getAttribute("aria-busy")).toBe("false");
        expect(ideDetectBtn).toHaveProperty("disabled", false);
        expect(cliDetectBtn).toHaveProperty("disabled", false);
        expect(bulkButton).toHaveProperty("disabled", false);
      });
    });

    it("resets active detection when detection throws an exception", async () => {
      mockDetectAntigravityExecutable.mockRejectedValueOnce(
        new Error("IPC communication failure"),
      );

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const appDetectBtn = screen.getByLabelText(
        "settings.runtimes.app.detect_exec_aria",
      );
      fireEvent.click(appDetectBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "destructive",
          }),
        );
        expect(appDetectBtn).toHaveProperty("disabled", false);
      });
    });
  });

  describe('Bulk "Auto-Detect All" Action', () => {
    it("applies clean/missing targets immediately with a single atomic saveConfig", async () => {
      const emptyConfig: AppConfig = {
        ...baseConfig,
        antigravity_executable: "",
        antigravity_ide_executable: "",
        antigravity_cli_executable: "",
      };

      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath:
            "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
          source: "filesystem",
          configuredPath: null,
          configuredPathExists: false,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "ide",
          detectedPath:
            "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
          source: "filesystem",
          configuredPath: null,
          configuredPathExists: false,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "cli",
          detectedPath: "/usr/local/bin/agy",
          source: "filesystem",
          configuredPath: null,
          configuredPathExists: false,
          alreadySet: false,
          status: "detected",
        },
      ];
      mockDetectAllAntigravityExecutables.mockResolvedValueOnce(mockResults);

      render(
        <RuntimeTargetSettings
          config={emptyConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      fireEvent.click(bulkButton);

      await waitFor(() => {
        expect(mockDetectAllAntigravityExecutables).toHaveBeenCalledWith({
          bypassConfig: true,
        });
        // Single atomic commit for all 3 targets
        expect(saveConfigMock).toHaveBeenCalledTimes(1);
        expect(saveConfigMock).toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_executable:
              "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
            antigravity_ide_executable:
              "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
            antigravity_cli_executable: "/usr/local/bin/agy",
          }),
        );
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.exec_bulk_summary_title",
        }),
      );
    });

    it("displays unchanged toast when all detected targets are already configured", async () => {
      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
          source: "filesystem",
          configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
          configuredPathExists: true,
          alreadySet: true,
          status: "already_set",
        },
        {
          target: "ide",
          detectedPath: "/Applications/Antigravity IDE.app",
          source: "filesystem",
          configuredPath: "/Applications/Antigravity IDE.app",
          configuredPathExists: true,
          alreadySet: true,
          status: "already_set",
        },
        {
          target: "cli",
          detectedPath: "/usr/local/bin/agy",
          source: "filesystem",
          configuredPath: "/usr/local/bin/agy",
          configuredPathExists: true,
          alreadySet: true,
          status: "already_set",
        },
      ];
      mockDetectAllAntigravityExecutables.mockResolvedValueOnce(mockResults);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      fireEvent.click(bulkButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_bulk_summary_title",
            description: "settings.runtimes.toast.exec_bulk_unchanged_desc",
          }),
        );
      });

      expect(saveConfigMock).not.toHaveBeenCalled();
    });

    it("displays none detected toast when no runtimes are found on the system", async () => {
      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath: null,
          source: "none",
          configuredPath: null,
          configuredPathExists: false,
          alreadySet: false,
          status: "not_found",
        },
        {
          target: "ide",
          detectedPath: null,
          source: "none",
          configuredPath: null,
          configuredPathExists: false,
          alreadySet: false,
          status: "not_found",
        },
        {
          target: "cli",
          detectedPath: null,
          source: "none",
          configuredPath: null,
          configuredPathExists: false,
          alreadySet: false,
          status: "not_found",
        },
      ];
      mockDetectAllAntigravityExecutables.mockResolvedValueOnce(mockResults);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      fireEvent.click(bulkButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_not_found_title",
            description: "settings.runtimes.toast.exec_bulk_none_desc",
          }),
        );
      });

      expect(saveConfigMock).not.toHaveBeenCalled();
    });

    it("opens Unified Batch Conflict Resolution Dialog when differing paths exist, handling Replace All", async () => {
      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath: "C:\\NewAntigravity\\antigravity.exe",
          source: "filesystem",
          configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
          configuredPathExists: true,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "ide",
          detectedPath: "/opt/Antigravity IDE/antigravity-ide",
          source: "filesystem",
          configuredPath: "/Applications/Antigravity IDE.app",
          configuredPathExists: true,
          alreadySet: false,
          status: "detected",
        },
      ];
      mockDetectAllAntigravityExecutables.mockResolvedValueOnce(mockResults);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      fireEvent.click(bulkButton);

      // Verify Batch Conflict Dialog opens
      await waitFor(() => {
        expect(
          screen.getByText("settings.runtimes.dialog.batch_title"),
        ).toBeTruthy();
        expect(
          screen.getByText("settings.runtimes.dialog.batch_desc"),
        ).toBeTruthy();
      });

      // Verify items are rendered
      expect(
        screen.getByText("C:\\Program Files\\Antigravity\\Antigravity.exe"),
      ).toBeTruthy();
      expect(
        screen.getByText("C:\\NewAntigravity\\antigravity.exe"),
      ).toBeTruthy();

      // Click "Replace All"
      const replaceAllBtn = screen.getByText(
        "settings.runtimes.dialog.replace_all",
      );
      fireEvent.click(replaceAllBtn);

      await waitFor(() => {
        expect(saveConfigMock).toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_executable: "C:\\NewAntigravity\\antigravity.exe",
            antigravity_ide_executable: "/opt/Antigravity IDE/antigravity-ide",
          }),
        );
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_bulk_summary_title",
          }),
        );
      });
    });

    it("handles Replace Selected in Unified Batch Conflict Resolution Dialog", async () => {
      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath: "C:\\NewAntigravity\\antigravity.exe",
          source: "filesystem",
          configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
          configuredPathExists: true,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "ide",
          detectedPath: "/opt/Antigravity IDE/antigravity-ide",
          source: "filesystem",
          configuredPath: "/Applications/Antigravity IDE.app",
          configuredPathExists: true,
          alreadySet: false,
          status: "detected",
        },
      ];
      mockDetectAllAntigravityExecutables.mockResolvedValueOnce(mockResults);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      fireEvent.click(bulkButton);

      await waitFor(() => {
        expect(
          screen.getByText("settings.runtimes.dialog.batch_title"),
        ).toBeTruthy();
      });

      // Deselect ide row checkbox
      const ideCheckbox = screen.getByLabelText("settings.runtimes.target_ide");
      fireEvent.click(ideCheckbox);

      // Now 1 is selected -> "Replace Selected" button appears
      const replaceSelectedBtn = await screen.findByText(
        /settings\.runtimes\.dialog\.replace_selected/,
      );
      fireEvent.click(replaceSelectedBtn);

      await waitFor(() => {
        // App is updated, but IDE remains unchanged
        expect(saveConfigMock).toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_executable: "C:\\NewAntigravity\\antigravity.exe",
          }),
        );
        expect(saveConfigMock).not.toHaveBeenCalledWith(
          expect.objectContaining({
            antigravity_ide_executable: "/opt/Antigravity IDE/antigravity-ide",
          }),
        );
      });
    });

    it("handles Keep Current in Unified Batch Conflict Resolution Dialog", async () => {
      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath: "C:\\NewAntigravity\\antigravity.exe",
          source: "filesystem",
          configuredPath: "C:\\Program Files\\Antigravity\\Antigravity.exe",
          configuredPathExists: true,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "ide",
          detectedPath: "/opt/Antigravity IDE/antigravity-ide",
          source: "filesystem",
          configuredPath: "/Applications/Antigravity IDE.app",
          configuredPathExists: true,
          alreadySet: false,
          status: "detected",
        },
      ];
      mockDetectAllAntigravityExecutables.mockResolvedValueOnce(mockResults);

      render(
        <RuntimeTargetSettings
          config={baseConfig}
          saveConfig={saveConfigMock}
        />,
      );

      const bulkButton = screen.getByLabelText(
        "settings.runtimes.auto_detect_all_aria",
      );
      fireEvent.click(bulkButton);

      await waitFor(() => {
        expect(
          screen.getByText("settings.runtimes.dialog.batch_title"),
        ).toBeTruthy();
      });

      const keepAllBtn = screen.getByText(
        "settings.runtimes.dialog.keep_current",
      );
      fireEvent.click(keepAllBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "settings.runtimes.toast.exec_preserved_title",
          }),
        );
      });

      expect(saveConfigMock).not.toHaveBeenCalled();
    });
  });
});

describe("RuntimeBatchConflictDialog Component Direct Tests", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleConflicts: BatchConflictItem[] = [
    {
      targetKey: "app",
      targetName: "Antigravity App",
      currentPath: "/opt/old/antigravity",
      detectedPath: "/opt/new/antigravity",
    },
    {
      targetKey: "cli",
      targetName: "Antigravity CLI (agy)",
      currentPath: "/usr/bin/agy",
      detectedPath: "/usr/local/bin/agy",
    },
  ];

  it("handles master Select All checkbox toggle", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();

    render(
      <RuntimeBatchConflictDialog
        open={true}
        conflicts={sampleConflicts}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    const selectAllCheckbox = screen.getByLabelText("accounts.batch.selectAll");
    expect(selectAllCheckbox).toBeTruthy();

    // Toggle all off
    fireEvent.click(selectAllCheckbox);

    // Toggle all on
    fireEvent.click(selectAllCheckbox);

    const replaceAllBtn = screen.getByText(
      "settings.runtimes.dialog.replace_all",
    );
    fireEvent.click(replaceAllBtn);

    expect(onConfirm).toHaveBeenCalledWith(["app", "cli"]);
  });

  it("dismisses on cancel / keep current click", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();

    render(
      <RuntimeBatchConflictDialog
        open={true}
        conflicts={sampleConflicts}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    const keepBtn = screen.getByText("settings.runtimes.dialog.keep_current");
    fireEvent.click(keepBtn);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("RuntimeSingleConflictDialog Component Direct Tests", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders side-by-side comparison and calls onConfirm when replaced", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();

    render(
      <RuntimeSingleConflictDialog
        open={true}
        targetName="Antigravity App"
        currentPath="/opt/old/antigravity"
        detectedPath="/opt/new/antigravity"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("/opt/old/antigravity")).toBeTruthy();
    expect(screen.getByText("/opt/new/antigravity")).toBeTruthy();

    const replaceBtn = screen.getByText("settings.runtimes.dialog.replace_all");
    fireEvent.click(replaceBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when user clicks keep current", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();

    render(
      <RuntimeSingleConflictDialog
        open={true}
        targetName="Antigravity App"
        currentPath="/opt/old/antigravity"
        detectedPath="/opt/new/antigravity"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    const keepBtn = screen.getByText("settings.runtimes.dialog.keep_current");
    fireEvent.click(keepBtn);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
