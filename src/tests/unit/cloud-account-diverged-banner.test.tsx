import React, { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloudAccountDivergedBanner } from "@/modules/cloud-account/components/CloudAccountDivergedBanner";
import type { DivergedTargetInfo } from "@/modules/cloud-account/utils/divergedState";
import en from "@/localization/en";
import { get } from "lodash-es";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      let val = get(en, key);
      if (typeof val === "string") {
        if (options) {
          for (const [k, v] of Object.entries(options)) {
            val = val.replace(new RegExp(`{{${k}}}`, "g"), String(v));
          }
        }
        return val;
      }
      if (options?.defaultValue) return options.defaultValue;
      return key;
    },
  }),
}));

describe("CloudAccountDivergedBanner", () => {
  const mockDivergedTargets: DivergedTargetInfo[] = [
    {
      target: "app",
      targetLabel: "App",
      accountEmail: "devon.vance@company.com",
      isRateLimited: false,
    },
    {
      target: "cli",
      targetLabel: "CLI",
      accountEmail: "amber.lorde@company.com",
      isRateLimited: true,
    },
  ];

  it("renders diverged banner with title and formatted targets description", () => {
    render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={false}
        onResyncAll={vi.fn()}
      />
    );

    expect(screen.getByText("Environments Desynchronized")).toBeTruthy();
    expect(
      screen.getByText(
        "Environments are running different accounts: App (devon.vance@company.com), CLI (amber.lorde@company.com)"
      )
    ).toBeTruthy();
  });

  it("renders stranded account warning pill when a target is rate-limited", () => {
    render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={false}
        onResyncAll={vi.fn()}
      />
    );

    const strandedPill = screen.getByRole("status");
    expect(strandedPill.textContent).toContain("Target CLI is stranded on a rate-limited account.");
  });

  it("does not render stranded warning pill when all diverged targets are healthy", () => {
    const healthyTargets: DivergedTargetInfo[] = [
      {
        target: "app",
        targetLabel: "App",
        accountEmail: "devon.vance@company.com",
        isRateLimited: false,
      },
      {
        target: "cli",
        targetLabel: "CLI",
        accountEmail: "backup@company.com",
        isRateLimited: false,
      },
    ];

    render(
      <CloudAccountDivergedBanner
        divergedTargets={healthyTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={false}
        onResyncAll={vi.fn()}
      />
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders 1-click resync button with dynamic email and calls onResyncAll", () => {
    const onResyncAll = vi.fn();
    render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={false}
        onResyncAll={onResyncAll}
      />
    );

    const btn = screen.getByRole("button", {
      name: /Resync All Environments to devon.vance@company.com/i,
    });
    expect(btn).toBeTruthy();
    expect(btn.className).toContain("min-h-[44px]");

    fireEvent.click(btn);
    expect(onResyncAll).toHaveBeenCalledTimes(1);
  });

  it("renders loading state with spinner and aria-busy when isResyncing is true", () => {
    render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={true}
        onResyncAll={vi.fn()}
      />
    );

    expect(screen.getByText("Resyncing...")).toBeTruthy();
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders generic fallback button and disabled when resolvedCandidateEmail is null", () => {
    render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail={null}
        isResyncing={false}
        onResyncAll={vi.fn()}
      />
    );

    const btn = screen.getByRole("button", { name: /Resync All Environments/i });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores keyboard focus to summaryRef upon unmounting when focused inside banner", () => {
    const summaryRef = createRef<HTMLDivElement>();
    const dummySummary = document.createElement("div");
    dummySummary.tabIndex = -1;
    dummySummary.focus = vi.fn();
    (summaryRef as any).current = dummySummary;

    const { unmount } = render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={false}
        onResyncAll={vi.fn()}
        summaryRef={summaryRef}
      />
    );

    const btn = screen.getByRole("button");
    btn.focus();

    unmount();

    expect(dummySummary.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("conforms to WCAG region and labelledby standards", () => {
    const { container } = render(
      <CloudAccountDivergedBanner
        divergedTargets={mockDivergedTargets}
        resolvedCandidateEmail="devon.vance@company.com"
        isResyncing={false}
        onResyncAll={vi.fn()}
      />
    );

    const bannerRegion = container.querySelector('[role="region"]');
    expect(bannerRegion).toBeTruthy();
    expect(bannerRegion?.getAttribute("aria-labelledby")).toBe("diverged-banner-title");
    expect(bannerRegion?.getAttribute("aria-describedby")).toBe("diverged-banner-description");
  });
});
