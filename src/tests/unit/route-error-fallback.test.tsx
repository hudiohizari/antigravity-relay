// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouteErrorFallback } from "@/components/layout/RouteErrorFallback";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "error.routeFallback.title": "Unable to Load Section",
        "error.routeFallback.description":
          "An unexpected rendering error occurred in this view.",
        "error.routeFallback.retry": "Retry Section",
        "error.routeFallback.goHome": "Return to Accounts",
      };
      return translations[key] ?? key;
    },
  }),
}));

describe("RouteErrorFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders alert container with accessible ARIA attributes and localized copy", () => {
    render(
      <RouteErrorFallback error={new Error("Route error")} reset={vi.fn()} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("aria-live", "polite");

    expect(
      screen.getByRole("heading", { name: /Unable to Load Section/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/An unexpected rendering error occurred in this view/i),
    ).toBeInTheDocument();
  });

  it("calls reset handler when Retry button is clicked", () => {
    const mockReset = vi.fn();
    render(
      <RouteErrorFallback error={new Error("Route error")} reset={mockReset} />,
    );

    const retryBtn = screen.getByRole("button", { name: /Retry Section/i });
    fireEvent.click(retryBtn);

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("navigates to home root / when Return to Accounts button is clicked", () => {
    render(
      <RouteErrorFallback error={new Error("Route error")} reset={vi.fn()} />,
    );

    const homeBtn = screen.getByRole("button", { name: /Return to Accounts/i });
    fireEvent.click(homeBtn);

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("falls back to window.location.reload when reset callback is omitted", () => {
    const originalLocation = window.location;
    const mockReload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: mockReload },
    });

    render(<RouteErrorFallback error={new Error("Route error")} />);

    const retryBtn = screen.getByRole("button", { name: /Retry Section/i });
    fireEvent.click(retryBtn);

    expect(mockReload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
