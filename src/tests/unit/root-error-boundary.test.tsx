// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RootErrorBoundary } from "@/components/layout/RootErrorBoundary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "error.rootBoundary.title": "Application Encountered an Error",
        "error.rootBoundary.description":
          "A critical unexpected error occurred. You can reload the application window to restore normal operation.",
        "error.rootBoundary.reload": "Reload Application",
        "error.rootBoundary.copyDetails": "Copy Error Details",
        "error.rootBoundary.detailsCopied":
          "Error details copied to clipboard.",
        "error.rootBoundary.viewDetails": "View Technical Diagnostics",
      };
      return translations[key] ?? key;
    },
  }),
}));

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error(
      "Fatal initialization crash with token ya29.a0AfH6SMD_secret and Bearer secret123",
    );
  }
  return <div data-testid="child-content">Normal Content</div>;
}

describe("RootErrorBoundary", () => {
  const originalLocation = window.location;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Silence expected console.error from React error boundary
    vi.spyOn(console, "error").mockImplementation(() => {});

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        reload: vi.fn(),
      },
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("renders children cleanly when no error is thrown", () => {
    render(
      <RootErrorBoundary>
        <Bomb shouldThrow={false} />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("Normal Content")).toBeInTheDocument();
  });

  it("catches render errors and displays localized alert dialog", () => {
    render(
      <RootErrorBoundary>
        <Bomb shouldThrow={true} />
      </RootErrorBoundary>,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("heading", {
        name: /Application Encountered an Error/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You can reload the application window/i),
    ).toBeInTheDocument();
  });

  it("sanitizes sensitive tokens in the diagnostic preview", () => {
    render(
      <RootErrorBoundary>
        <Bomb shouldThrow={true} />
      </RootErrorBoundary>,
    );

    const details = screen.getByText("View Technical Diagnostics");
    expect(details).toBeInTheDocument();

    const pre = screen.getByText(/Fatal initialization crash/);
    expect(pre.textContent).toContain("[REDACTED_OAUTH_TOKEN]");
    expect(pre.textContent).toContain("Bearer [REDACTED]");
    expect(pre.textContent).not.toContain("ya29.a0AfH6SMD_secret");
    expect(pre.textContent).not.toContain("secret123");
  });

  it("invokes window.location.reload on reload button click", () => {
    render(
      <RootErrorBoundary>
        <Bomb shouldThrow={true} />
      </RootErrorBoundary>,
    );

    const reloadBtn = screen.getByRole("button", {
      name: /Reload Application/i,
    });
    fireEvent.click(reloadBtn);

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("copies sanitized error details to clipboard and displays confirmation", async () => {
    render(
      <RootErrorBoundary>
        <Bomb shouldThrow={true} />
      </RootErrorBoundary>,
    );

    const copyBtn = screen.getByRole("button", { name: /Copy Error Details/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("[REDACTED_OAUTH_TOKEN]"),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Error details copied to clipboard."),
      ).toBeInTheDocument();
    });
  });

  it("renders custom fallback node when provided", () => {
    render(
      <RootErrorBoundary
        fallback={<div data-testid="custom-fallback">Custom</div>}
      >
        <Bomb shouldThrow={true} />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
  });

  it("logs to window.electron.logError when electron bridge is present", () => {
    const logErrorMock = vi.fn();
    (
      window as unknown as { electron: { logError: typeof logErrorMock } }
    ).electron = {
      logError: logErrorMock,
    };

    render(
      <RootErrorBoundary>
        <Bomb shouldThrow={true} />
      </RootErrorBoundary>,
    );

    expect(logErrorMock).toHaveBeenCalledWith(
      "Unhandled React error caught in RootErrorBoundary",
      expect.objectContaining({
        error: expect.stringContaining("Fatal initialization crash"),
      }),
    );

    delete (window as unknown as { electron?: unknown }).electron;
  });
});
