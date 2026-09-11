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
import {
  RuntimeTargetSettings,
  sanitizeExecutablePath,
  parseArgsInput,
  formatArgsDisplay,
} from "@/modules/antigravity-runtime/components/RuntimeTargetSettings";
import type { AppConfig } from "@/modules/config/types";

const mockSelectAntigravityExecutable = vi.fn();
const mockGetAntigravityArgs = vi.fn();
const mockToast = vi.fn();

vi.mock("@/modules/antigravity-runtime/actions/system", () => ({
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
      if (options?.target) {
        return `${key}:${String(options.target)}`;
      }
      return key;
    },
  }),
}));

describe("sanitizeExecutablePath", () => {
  it("returns null for null, undefined, or empty values", () => {
    expect(sanitizeExecutablePath(null)).toBeNull();
    expect(sanitizeExecutablePath(undefined)).toBeNull();
    expect(sanitizeExecutablePath("")).toBeNull();
    expect(sanitizeExecutablePath("   ")).toBeNull();
    expect(sanitizeExecutablePath('""')).toBeNull();
    expect(sanitizeExecutablePath("''")).toBeNull();
  });

  it("strips double and single quotes from Windows copy as path", () => {
    expect(
      sanitizeExecutablePath(
        '"C:\\Program Files\\Antigravity\\Antigravity.exe"',
      ),
    ).toBe("C:\\Program Files\\Antigravity\\Antigravity.exe");

    expect(sanitizeExecutablePath("'C:\\Tools\\IDE\\antigravity.exe'")).toBe(
      "C:\\Tools\\IDE\\antigravity.exe",
    );

    expect(sanitizeExecutablePath('  "D:\\tools\\agy.exe"  ')).toBe(
      "D:\\tools\\agy.exe",
    );
  });

  it("preserves clean paths without quotes and trims whitespace", () => {
    expect(sanitizeExecutablePath("  /usr/local/bin/agy  ")).toBe(
      "/usr/local/bin/agy",
    );
    expect(sanitizeExecutablePath("/Applications/Antigravity IDE.app")).toBe(
      "/Applications/Antigravity IDE.app",
    );
  });
});

describe("parseArgsInput and formatArgsDisplay", () => {
  it("parses space-delimited and quote-wrapped arguments", () => {
    expect(parseArgsInput("")).toEqual([]);
    expect(parseArgsInput("   ")).toEqual([]);
    expect(parseArgsInput("--flag1 --flag2")).toEqual(["--flag1", "--flag2"]);
    expect(
      parseArgsInput(
        '--user-data-dir "C:\\Program Files\\Data" --profile Default',
      ),
    ).toEqual([
      "--user-data-dir",
      "C:\\Program Files\\Data",
      "--profile",
      "Default",
    ]);
    expect(parseArgsInput("--extensions-dir 'D:\\Custom Ext'")).toEqual([
      "--extensions-dir",
      "D:\\Custom Ext",
    ]);
  });

  it("quotes arguments containing spaces when formatting for display", () => {
    expect(formatArgsDisplay(["--flag1", "--flag2"])).toBe("--flag1 --flag2");
    expect(
      formatArgsDisplay(["--user-data-dir", "C:\\Program Files\\Data"]),
    ).toBe('--user-data-dir "C:\\Program Files\\Data"');
  });
});

describe("RuntimeTargetSettings component", () => {
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
    antigravity_args: ["--user-data-dir", "C:\\Profile"],
    antigravity_ide_executable: "/Applications/Antigravity IDE.app",
    antigravity_ide_args: ["--profile", "Work"],
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

  it("renders all three runtime targets with expected inputs and accessibility attributes", () => {
    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    expect(screen.getByText("settings.runtimes.title")).toBeTruthy();
    expect(screen.getByText("settings.runtimes.app.title")).toBeTruthy();
    expect(screen.getByText("settings.runtimes.ide.title")).toBeTruthy();
    expect(screen.getByText("settings.runtimes.cli.title")).toBeTruthy();

    const appExecInput = screen.getByLabelText(
      "settings.runtimes.app.executable",
    );
    expect(appExecInput).toHaveProperty(
      "value",
      "C:\\Program Files\\Antigravity\\Antigravity.exe",
    );

    const appArgsInput = screen.getByLabelText("settings.runtimes.app.args");
    expect(appArgsInput).toHaveProperty("value", "--user-data-dir C:\\Profile");

    const ideExecInput = screen.getByLabelText(
      "settings.runtimes.ide.executable",
    );
    expect(ideExecInput).toHaveProperty(
      "value",
      "/Applications/Antigravity IDE.app",
    );

    const ideArgsInput = screen.getByLabelText("settings.runtimes.ide.args");
    expect(ideArgsInput).toHaveProperty("value", "--profile Work");

    const cliExecInput = screen.getByLabelText(
      "settings.runtimes.cli.executable",
    );
    expect(cliExecInput).toHaveProperty("value", "/usr/local/bin/agy");

    expect(screen.queryByLabelText("settings.runtimes.cli.args")).toBeNull();
  });

  it("sanitizes pasted Windows path with quotes and saves on blur", async () => {
    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const ideExecInput = screen.getByLabelText(
      "settings.runtimes.ide.executable",
    );
    fireEvent.change(ideExecInput, {
      target: { value: '"D:\\Tools\\Antigravity IDE\\antigravity.exe"' },
    });
    fireEvent.blur(ideExecInput);

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_ide_executable:
            "D:\\Tools\\Antigravity IDE\\antigravity.exe",
        }),
      );
    });
  });

  it("clears executable path and saves null when clicking clear button", async () => {
    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const clearButton = screen.getByLabelText(
      "settings.runtimes.cli.clear_path_aria",
    );
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_cli_executable: null,
        }),
      );
    });
  });

  it("browses for executable and saves selected path", async () => {
    mockSelectAntigravityExecutable.mockResolvedValueOnce(
      "/opt/custom/bin/agy",
    );

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const browseButton = screen.getByLabelText(
      "settings.runtimes.cli.browse_aria",
    );
    fireEvent.click(browseButton);

    await waitFor(() => {
      expect(mockSelectAntigravityExecutable).toHaveBeenCalledWith("cli");
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_cli_executable: "/opt/custom/bin/agy",
        }),
      );
    });
  });

  it("clears launch arguments and saves empty array when clear is clicked", async () => {
    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const clearArgsButton = screen.getByLabelText(
      "settings.runtimes.ide.clear_args_aria",
    );
    fireEvent.click(clearArgsButton);

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_ide_args: [],
        }),
      );
    });
  });

  it("displays warning toast and preserves existing arguments when process is not running", async () => {
    mockGetAntigravityArgs.mockResolvedValueOnce({
      running: false,
      args: [],
    });

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const detectButton = screen.getByLabelText(
      "settings.runtimes.ide.detect_args_aria",
    );
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(mockGetAntigravityArgs).toHaveBeenCalledWith("ide");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.not_running_title",
        }),
      );
    });

    const ideArgsInput = screen.getByLabelText("settings.runtimes.ide.args");
    expect(ideArgsInput).toHaveProperty("value", "--profile Work");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("displays info toast and preserves arguments when process is running with 0 arguments", async () => {
    mockGetAntigravityArgs.mockResolvedValueOnce({
      running: true,
      args: [],
    });

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const detectButton = screen.getByLabelText(
      "settings.runtimes.ide.detect_args_aria",
    );
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(mockGetAntigravityArgs).toHaveBeenCalledWith("ide");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.empty_title",
        }),
      );
    });

    const ideArgsInput = screen.getByLabelText("settings.runtimes.ide.args");
    expect(ideArgsInput).toHaveProperty("value", "--profile Work");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("detects live arguments, populates input, and saves to configuration when custom args detected", async () => {
    mockGetAntigravityArgs.mockResolvedValueOnce({
      running: true,
      args: ["--user-data-dir", "D:\\NewProfile", "--profile", "Release"],
    });

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const detectButton = screen.getByLabelText(
      "settings.runtimes.ide.detect_args_aria",
    );
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(mockGetAntigravityArgs).toHaveBeenCalledWith("ide");
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_ide_args: [
            "--user-data-dir",
            "D:\\NewProfile",
            "--profile",
            "Release",
          ],
        }),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.success_title",
        }),
      );
    });

    const ideArgsInput = screen.getByLabelText("settings.runtimes.ide.args");
    expect(ideArgsInput).toHaveProperty(
      "value",
      "--user-data-dir D:\\NewProfile --profile Release",
    );
  });

  it("displays destructive error toast when detect IPC fails", async () => {
    mockGetAntigravityArgs.mockRejectedValueOnce(
      new Error("Process permission denied"),
    );

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const detectButton = screen.getByLabelText(
      "settings.runtimes.app.detect_args_aria",
    );
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(mockGetAntigravityArgs).toHaveBeenCalledWith("app");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.error_title",
          variant: "destructive",
        }),
      );
    });
  });

  it("handles browsing and clearing for App and IDE executables and args", async () => {
    mockSelectAntigravityExecutable
      .mockResolvedValueOnce("C:\\Custom\\Antigravity.exe")
      .mockResolvedValueOnce("/Custom/IDE.app");

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    // Browse App
    const browseAppBtn = screen.getByLabelText(
      "settings.runtimes.app.browse_aria",
    );
    fireEvent.click(browseAppBtn);
    await waitFor(() => {
      expect(mockSelectAntigravityExecutable).toHaveBeenCalledWith("app");
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_executable: "C:\\Custom\\Antigravity.exe",
        }),
      );
    });

    // Clear App Executable
    const clearAppExecBtn = screen.getByLabelText(
      "settings.runtimes.app.clear_path_aria",
    );
    fireEvent.click(clearAppExecBtn);
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ antigravity_executable: null }),
      );
    });

    // Clear App Args
    const clearAppArgsBtn = screen.getByLabelText(
      "settings.runtimes.app.clear_args_aria",
    );
    fireEvent.click(clearAppArgsBtn);
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ antigravity_args: [] }),
      );
    });

    // Browse IDE
    const browseIdeBtn = screen.getByLabelText(
      "settings.runtimes.ide.browse_aria",
    );
    fireEvent.click(browseIdeBtn);
    await waitFor(() => {
      expect(mockSelectAntigravityExecutable).toHaveBeenCalledWith("ide");
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_ide_executable: "/Custom/IDE.app",
        }),
      );
    });

    // Clear IDE Executable
    const clearIdeExecBtn = screen.getByLabelText(
      "settings.runtimes.ide.clear_path_aria",
    );
    fireEvent.click(clearIdeExecBtn);
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ antigravity_ide_executable: null }),
      );
    });
  });

  it("handles detecting app launch arguments safely across all outcomes", async () => {
    // Process not running
    mockGetAntigravityArgs.mockResolvedValueOnce({ running: false, args: [] });

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const appDetectBtn = screen.getByLabelText(
      "settings.runtimes.app.detect_args_aria",
    );
    fireEvent.click(appDetectBtn);

    await waitFor(() => {
      expect(mockGetAntigravityArgs).toHaveBeenCalledWith("app");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.not_running_title",
        }),
      );
    });
    expect(saveConfigMock).not.toHaveBeenCalled();

    // Process running with empty args
    mockGetAntigravityArgs.mockResolvedValueOnce({ running: true, args: [] });
    fireEvent.click(appDetectBtn);
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.empty_title",
        }),
      );
    });
    expect(saveConfigMock).not.toHaveBeenCalled();

    // Process running with custom args
    mockGetAntigravityArgs.mockResolvedValueOnce({
      running: true,
      args: ["--user-data-dir", "C:\\AppProfile"],
    });
    fireEvent.click(appDetectBtn);
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_args: ["--user-data-dir", "C:\\AppProfile"],
        }),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.success_title",
        }),
      );
    });
  });

  it("triggers blur on Enter key down for inputs", async () => {
    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const appExecInput = screen.getByLabelText(
      "settings.runtimes.app.executable",
    );
    fireEvent.change(appExecInput, { target: { value: "C:\\New\\app.exe" } });
    fireEvent.keyDown(appExecInput, { key: "Enter" });

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ antigravity_executable: "C:\\New\\app.exe" }),
      );
    });

    const appArgsInput = screen.getByLabelText("settings.runtimes.app.args");
    fireEvent.change(appArgsInput, { target: { value: "--profile Dev" } });
    fireEvent.keyDown(appArgsInput, { key: "Enter" });

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ antigravity_args: ["--profile", "Dev"] }),
      );
    });

    const ideExecInput = screen.getByLabelText(
      "settings.runtimes.ide.executable",
    );
    fireEvent.change(ideExecInput, { target: { value: "/new/ide.app" } });
    fireEvent.keyDown(ideExecInput, { key: "Enter" });

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_ide_executable: "/new/ide.app",
        }),
      );
    });

    const ideArgsInput = screen.getByLabelText("settings.runtimes.ide.args");
    fireEvent.change(ideArgsInput, { target: { value: "--data D:\\Data" } });
    fireEvent.keyDown(ideArgsInput, { key: "Enter" });

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          antigravity_ide_args: ["--data", "D:\\Data"],
        }),
      );
    });

    const cliExecInput = screen.getByLabelText(
      "settings.runtimes.cli.executable",
    );
    fireEvent.change(cliExecInput, { target: { value: "/bin/agy" } });
    fireEvent.keyDown(cliExecInput, { key: "Enter" });

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ antigravity_cli_executable: "/bin/agy" }),
      );
    });
  });

  it("displays destructive error toast when IDE detect IPC fails", async () => {
    mockGetAntigravityArgs.mockRejectedValueOnce(
      new Error("IDE inspect failed"),
    );

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const detectButton = screen.getByLabelText(
      "settings.runtimes.ide.detect_args_aria",
    );
    fireEvent.click(detectButton);

    await waitFor(() => {
      expect(mockGetAntigravityArgs).toHaveBeenCalledWith("ide");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.runtimes.toast.error_title",
          variant: "destructive",
        }),
      );
    });
  });

  it("does not update config if browse selection is canceled", async () => {
    mockSelectAntigravityExecutable.mockResolvedValueOnce(null);

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const browseAppBtn = screen.getByLabelText(
      "settings.runtimes.app.browse_aria",
    );
    fireEvent.click(browseAppBtn);

    await waitFor(() => {
      expect(mockSelectAntigravityExecutable).toHaveBeenCalledWith("app");
    });
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("prevents duplicate concurrent detection calls while one is in-flight", async () => {
    let resolveIpc: (val: { running: boolean; args: string[] }) => void;
    const pendingPromise = new Promise<{ running: boolean; args: string[] }>(
      (resolve) => {
        resolveIpc = resolve;
      },
    );
    mockGetAntigravityArgs.mockReturnValueOnce(pendingPromise);

    render(
      <RuntimeTargetSettings config={baseConfig} saveConfig={saveConfigMock} />,
    );

    const detectButton = screen.getByLabelText(
      "settings.runtimes.ide.detect_args_aria",
    );
    fireEvent.click(detectButton);

    // Button should now be busy and disabled
    expect(detectButton.getAttribute("aria-busy")).toBe("true");
    expect(detectButton.hasAttribute("disabled")).toBe(true);

    // Clicking again should not call IPC again
    fireEvent.click(detectButton);
    expect(mockGetAntigravityArgs).toHaveBeenCalledTimes(1);

    // Resolve IPC
    resolveIpc!({ running: true, args: ["--profile", "ConcurrentTest"] });

    await waitFor(() => {
      expect(detectButton.getAttribute("aria-busy")).toBe("false");
      expect(detectButton.hasAttribute("disabled")).toBe(false);
    });
  });

  it("renders without props and defaults to hook config", () => {
    render(<RuntimeTargetSettings />);
    expect(screen.getByText("settings.runtimes.title")).toBeTruthy();
  });
});
