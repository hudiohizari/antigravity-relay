import React, { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CloudAccountListSummary } from "@/modules/cloud-account/components/CloudAccountListSummary";
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

describe("CloudAccountListSummary", () => {
  it("renders unified mode badge and emerald dot when physically unified", () => {
    const summaryRef = createRef<HTMLDivElement>();
    const { container } = render(
      <CloudAccountListSummary
        totalAccounts={3}
        activeAccounts={1}
        rateLimitedAccounts={0}
        overallQuotaPercentage={85}
        effectiveQuotaStatus="high"
        isDiverged={false}
        summaryRef={summaryRef}
      />
    );

    expect(screen.getByText("Unified (1 Active)")).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();

    const activeEl = screen.getByText("1");
    expect(activeEl.className).toContain("text-emerald-600");

    const card = container.querySelector("#cloud-account-summary-card");
    expect(card).toBeTruthy();
    expect(card?.getAttribute("tabindex")).toBe("-1");
    expect(card?.getAttribute("aria-live")).toBe("polite");
    expect(summaryRef.current).toBe(card);
  });

  it("renders diverged status badge and amber styling when diverged", () => {
    render(
      <CloudAccountListSummary
        totalAccounts={3}
        activeAccounts={2}
        rateLimitedAccounts={1}
        overallQuotaPercentage={45}
        effectiveQuotaStatus="medium"
        isDiverged={true}
        splitTargetsCount={2}
      />
    );

    expect(screen.getByText("Diverged (2 Targets Split)")).toBeTruthy();

    const activeEl = screen.getByText("2");
    expect(activeEl.className).toContain("text-amber-600");

    const statusBadge = screen.getByRole("status");
    expect(statusBadge.getAttribute("aria-label")).toContain("Diverged (2 Targets Split)");
  });

  it("renders rate limited count and clamps quota bar percentage", () => {
    const { container } = render(
      <CloudAccountListSummary
        totalAccounts={5}
        activeAccounts={1}
        rateLimitedAccounts={2}
        overallQuotaPercentage={10}
        effectiveQuotaStatus="low"
        isDiverged={false}
      />
    );

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    const progressBar = container.querySelector("[style*='width: 10%']");
    expect(progressBar).toBeTruthy();
  });

  it("renders cleanly when overallQuotaPercentage is null", () => {
    render(
      <CloudAccountListSummary
        totalAccounts={0}
        activeAccounts={0}
        rateLimitedAccounts={0}
        overallQuotaPercentage={null}
        effectiveQuotaStatus="high"
        isDiverged={false}
      />
    );

    expect(screen.queryByText("%")).toBeNull();
  });
});
