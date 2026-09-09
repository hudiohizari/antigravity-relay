// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  },
  confirm: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  },
  discard: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock(
  "@/modules/cloud-account/local-import/hooks/useLocalAccountImport",
  () => ({
    useLocalAccountImport: () => mocks,
  }),
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (typeof values?.count === "number") {
        return `${key}:${values.count}`;
      }
      return key;
    },
  }),
}));

import { LocalAccountImportDialog } from "@/modules/cloud-account/local-import/components/LocalAccountImportDialog";

const PREVIEW = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  expiresAt: 1_800_300_000,
  accounts: [
    {
      fingerprint: "fingerprint-a",
      sources: [
        { id: "antigravity-keyring" as const, location: "system-keyring" },
      ],
      emailHints: ["person@example.com"],
      hasAccessToken: true,
      hasIdToken: false,
      projectId: "project-a",
      identity: {
        email: "person@example.com",
        name: "Person",
      },
    },
  ],
  validationFailures: [
    {
      fingerprint: "fingerprint-b",
      code: "authentication-failed" as const,
      message: "The credential could not be authenticated.",
    },
  ],
  discoveryFailures: [],
  merged: [],
  sourceSummaries: [
    {
      id: "antigravity-keyring" as const,
      candidateCount: 1,
      failureCount: 0,
      inspectedLocations: 1,
    },
  ],
  duplicateCount: 0,
  emailCollisionGroups: [],
};

const IMPORT_RESULT = {
  imported: [
    {
      fingerprint: "fingerprint-a",
      accountId: "account-a",
      email: "person@example.com",
      action: "created" as const,
    },
  ],
  skipped: [],
  failed: [],
};

describe("LocalAccountImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mutateAsync.mockResolvedValue(PREVIEW);
    mocks.confirm.mutateAsync.mockResolvedValue(IMPORT_RESULT);
    mocks.discard.mutateAsync.mockResolvedValue({ discarded: true });
  });

  it("previews accounts, confirms once, and keeps the final result visible", async () => {
    render(createElement(LocalAccountImportDialog));

    fireEvent.click(
      screen.getByRole("button", {
        name: "cloud.localImport.trigger",
      }),
    );

    expect(await screen.findByText("person@example.com")).toBeTruthy();
    expect(mocks.preview.mutateAsync).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "cloud.localImport.confirm:1",
      }),
    );

    expect(
      await screen.findByText("cloud.localImport.resultTitle"),
    ).toBeTruthy();
    expect(mocks.confirm.mutateAsync).toHaveBeenCalledWith({
      sessionId: PREVIEW.sessionId,
    });
    expect(screen.getByText("cloud.localImport.imported:1")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "cloud.localImport.close",
      }),
    );
    expect(mocks.discard.mutateAsync).not.toHaveBeenCalled();
  });

  it("discards an active preview when the user cancels", async () => {
    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.cancel" }),
    );

    await waitFor(() => {
      expect(mocks.discard.mutateAsync).toHaveBeenCalledWith({
        sessionId: PREVIEW.sessionId,
      });
    });
    expect(mocks.confirm.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps the dialog open while a confirmed import is still running", async () => {
    let resolveImport: ((result: typeof IMPORT_RESULT) => void) | undefined;
    mocks.confirm.mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.confirm:1" }),
    );
    await screen.findByText("cloud.localImport.importing");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("cloud.localImport.importing")).toBeTruthy();

    await act(async () => {
      resolveImport?.(IMPORT_RESULT);
    });
    expect(
      await screen.findByText("cloud.localImport.resultTitle"),
    ).toBeTruthy();
    expect(mocks.discard.mutateAsync).not.toHaveBeenCalled();
  });

  it("discards a preview that finishes after its dialog was closed", async () => {
    let resolvePreview: ((preview: typeof PREVIEW) => void) | undefined;
    mocks.preview.mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    expect(await screen.findByText("cloud.localImport.scanning")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.cancel" }),
    );
    await act(async () => {
      resolvePreview?.(PREVIEW);
    });

    await waitFor(() => {
      expect(mocks.discard.mutateAsync).toHaveBeenCalledWith({
        sessionId: PREVIEW.sessionId,
      });
    });
    expect(screen.queryByText("person@example.com")).toBeNull();
  });

  it("renders accessible scroll region and deduplicates source badges by source id", async () => {
    const previewWithDuplicates = {
      ...PREVIEW,
      accounts: [
        {
          fingerprint: "fingerprint-legacy",
          sources: [
            { id: "legacy-agent" as const, location: "/path/to/accounts.json" },
            {
              id: "legacy-agent" as const,
              location: "/path/to/cloud_accounts.db",
            },
          ],
          emailHints: ["legacy@example.com"],
          hasAccessToken: true,
          hasIdToken: false,
          projectId: "legacy-project",
          identity: {
            email: "legacy@example.com",
            name: "Legacy User",
          },
        },
      ],
    };

    mocks.preview.mutateAsync.mockResolvedValue(previewWithDuplicates);
    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );

    await screen.findByText("legacy@example.com");

    const scrollRegion = screen.getByRole("region", {
      name: "cloud.localImport.accountList",
    });
    expect(scrollRegion).toBeTruthy();
    expect(scrollRegion.getAttribute("tabindex")).toBe("0");

    const badges = screen.getAllByText(
      "cloud.localImport.sources.legacy-agent",
    );
    expect(badges).toHaveLength(1);

    const badgeElement = badges[0].closest("div");
    expect(badgeElement?.getAttribute("title")).toBe(
      "/path/to/accounts.json, /path/to/cloud_accounts.db",
    );
  });

  it("handles preview failure, displays error state, and allows rescanning", async () => {
    mocks.preview.mutateAsync.mockRejectedValueOnce({
      data: { localAccountImportErrorCode: "preview-failed" },
    });

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );

    expect(
      await screen.findByText("cloud.localImport.errors.preview-failed"),
    ).toBeTruthy();

    mocks.preview.mutateAsync.mockResolvedValueOnce(PREVIEW);
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.rescan" }),
    );

    expect(await screen.findByText("person@example.com")).toBeTruthy();
  });

  it("handles confirmation failure and displays error state", async () => {
    mocks.confirm.mutateAsync.mockRejectedValueOnce({
      data: { localAccountImportErrorCode: "confirmation-failed" },
    });

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.confirm:1" }),
    );

    expect(
      await screen.findByText("cloud.localImport.errors.confirmation-failed"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.close" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("handles rescan from preview phase discarding the previous session", async () => {
    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");

    const secondPreview = {
      ...PREVIEW,
      sessionId: "00000000-0000-4000-8000-000000000002",
    };
    mocks.preview.mutateAsync.mockResolvedValueOnce(secondPreview);

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.rescan" }),
    );

    await waitFor(() => {
      expect(mocks.discard.mutateAsync).toHaveBeenCalledWith({
        sessionId: PREVIEW.sessionId,
      });
    });
    expect(mocks.preview.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("renders empty accounts state when no verified accounts are returned", async () => {
    const emptyPreview = {
      ...PREVIEW,
      accounts: [],
    };
    mocks.preview.mutateAsync.mockResolvedValueOnce(emptyPreview);

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );

    expect(
      await screen.findByText("cloud.localImport.noAccounts"),
    ).toBeTruthy();

    const confirmButton = screen.getByRole("button", {
      name: "cloud.localImport.confirm:0",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);
  });

  it("renders discovery failures and email collisions in issues callout", async () => {
    const previewWithIssues = {
      ...PREVIEW,
      discoveryFailures: [
        {
          source: {
            id: "legacy-agent" as const,
            location: "/path/to/locked.db",
          },
          code: "locked" as const,
          message: "Database locked",
        },
      ],
      emailCollisionGroups: [
        {
          email: "collision@example.com",
          fingerprints: ["fp-1", "fp-2"],
        },
      ],
    };
    mocks.preview.mutateAsync.mockResolvedValueOnce(previewWithIssues);

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );

    await screen.findByText("person@example.com");
    expect(screen.getByText("cloud.localImport.issues")).toBeTruthy();
    expect(
      screen.getByText(
        "cloud.localImport.sources.legacy-agent: cloud.localImport.discoveryErrors.locked",
      ),
    ).toBeTruthy();
    expect(screen.getByText("cloud.localImport.emailCollision:2")).toBeTruthy();
  });

  it("renders failed items in import result phase", async () => {
    const resultWithFailures = {
      imported: [],
      skipped: [],
      failed: [
        {
          fingerprint: "fp-fail-1",
          email: "fail1@example.com",
          code: "identity-conflict" as const,
          message: "Conflict",
        },
        {
          fingerprint: "fp-fail-2",
          code: "persistence-failed" as const,
          message: "Persistence failed",
        },
      ],
    };
    mocks.confirm.mutateAsync.mockResolvedValueOnce(resultWithFailures);

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.confirm:1" }),
    );

    expect(
      await screen.findByText("cloud.localImport.resultTitle"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "fail1@example.com: cloud.localImport.importErrors.identity-conflict",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("cloud.localImport.importErrors.persistence-failed"),
    ).toBeTruthy();
  });

  it("safely handles discardSession errors without unhandled exceptions", async () => {
    mocks.discard.mutateAsync.mockRejectedValueOnce(
      new Error("Network failed"),
    );

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.cancel" }),
    );

    await waitFor(() => {
      expect(mocks.discard.mutateAsync).toHaveBeenCalledWith({
        sessionId: PREVIEW.sessionId,
      });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("falls back to localized error message when error code is not a known request error", async () => {
    mocks.preview.mutateAsync.mockRejectedValueOnce(
      new Error("Generic failure message"),
    );

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );

    expect(await screen.findByText("Generic failure message")).toBeTruthy();
  });

  it("renders source badge without title when location is absent", async () => {
    const previewWithoutLocation = {
      ...PREVIEW,
      accounts: [
        {
          fingerprint: "fingerprint-no-loc",
          sources: [{ id: "antigravity-keyring" as const, location: "" }],
          emailHints: ["noloc@example.com"],
          hasAccessToken: true,
          hasIdToken: false,
          identity: {
            email: "noloc@example.com",
          },
        },
      ],
      validationFailures: [],
    };

    mocks.preview.mutateAsync.mockResolvedValueOnce(previewWithoutLocation);
    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );

    await screen.findByText("noloc@example.com");
    const badge = screen
      .getByText("cloud.localImport.sources.antigravity-keyring")
      .closest("div");
    expect(badge?.getAttribute("title")).toBeNull();
  });

  it("prevents escape key and outside interactions while importing", async () => {
    let resolveImport: ((result: typeof IMPORT_RESULT) => void) | undefined;
    mocks.confirm.mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );

    render(createElement(LocalAccountImportDialog));
    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.trigger" }),
    );
    await screen.findByText("person@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "cloud.localImport.confirm:1" }),
    );
    await screen.findByText("cloud.localImport.importing");

    const dialog = screen.getByRole("dialog");
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
      bubbles: true,
    });
    dialog.dispatchEvent(escapeEvent);
    expect(escapeEvent.defaultPrevented).toBe(true);

    const outsideEvent = new CustomEvent("pointerDownOutside", {
      cancelable: true,
      bubbles: true,
    });
    dialog.dispatchEvent(outsideEvent);

    await act(async () => {
      resolveImport?.(IMPORT_RESULT);
    });
    expect(
      await screen.findByText("cloud.localImport.resultTitle"),
    ).toBeTruthy();
  });
});
