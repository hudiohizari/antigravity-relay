import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  CloudAccountLoadingState,
  CloudAccountLoadError,
} from "@/modules/cloud-account/components/CloudAccountListFallbacks";
import { AppError } from "@/shared/errors/appError";
import en from "@/localization/en";
import { get } from "lodash-es";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const val = get(en, key);
      if (typeof val === "string") return val;
      if (options?.defaultValue) return options.defaultValue;
      return key;
    },
  }),
}));

describe("CloudAccountListFallbacks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electron;
  });

  it("renders CloudAccountLoadingState with spinner", () => {
    const { container } = render(<CloudAccountLoadingState />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders standard error and calls onRetry when clicked", () => {
    const onRetry = vi.fn();
    render(
      <CloudAccountLoadError
        error={new Error("Network timeout")}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Network timeout")).toBeTruthy();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders default error message when error is undefined", () => {
    render(<CloudAccountLoadError onRetry={vi.fn()} />);
    expect(screen.getAllByText("Failed to load cloud accounts.")).toHaveLength(
      2,
    );
  });

  it("renders Master Key error with data repair guidance and dispatches openExternalUrl", () => {
    const mockOpenExternal = vi.fn();
    (window as any).electron = {
      openExternalUrl: mockOpenExternal,
    };

    const masterKeyError = new AppError(
      "MASTER_KEY_UNAVAILABLE",
      "Keychain locked",
      {
        messageKey: "error.masterKeyUnavailable",
        metadata: {
          hint: "HINT_KEYCHAIN_DENIED",
          reason: "PROVIDER_UNAVAILABLE",
          storedAccountCount: 2,
        },
      },
    );

    render(<CloudAccountLoadError error={masterKeyError} onRetry={vi.fn()} />);

    // Check repair guidance
    const repoBtn = screen.getByRole("button", {
      name: /open github repository/i,
    });
    const issuesBtn = screen.getByRole("button", {
      name: /open github issues/i,
    });

    expect(repoBtn).toBeTruthy();
    expect(issuesBtn).toBeTruthy();

    fireEvent.click(repoBtn);
    expect(mockOpenExternal).toHaveBeenCalledWith(
      "https://github.com/hudiohizari/antigravity-relay",
    );

    fireEvent.click(issuesBtn);
    expect(mockOpenExternal).toHaveBeenCalledWith(
      "https://github.com/hudiohizari/antigravity-relay/issues",
    );
  });

  it("falls back to window.open if window.electron is undefined", () => {
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    const dataMigrationError = new AppError(
      "DATA_MIGRATION_FAILED",
      "Decryption failed",
      {
        messageKey: "error.dataMigrationFailed",
        metadata: { hint: "HINT_RELOGIN" },
      },
    );

    render(
      <CloudAccountLoadError error={dataMigrationError} onRetry={vi.fn()} />,
    );

    const repoBtn = screen.getByRole("button", {
      name: /open github repository/i,
    });
    fireEvent.click(repoBtn);

    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://github.com/hudiohizari/antigravity-relay",
      "_blank",
      "noreferrer",
    );
  });

  it("renders and opens details modal when details are available", () => {
    const errorWithDetails = {
      message: "Custom error",
      data: {
        backendMessage: "Detailed backend error message",
      },
    };

    render(
      <CloudAccountLoadError error={errorWithDetails} onRetry={vi.fn()} />,
    );

    const detailsBtn = screen.getByRole("button", { name: /details/i });
    expect(detailsBtn).toBeTruthy();

    fireEvent.click(detailsBtn);
    expect(screen.getByText(/Detailed backend error message/)).toBeTruthy();
  });
});
