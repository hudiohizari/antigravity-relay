// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AntigravityConversationCleanerSettings } from "@/modules/antigravity-runtime/components/AntigravityConversationCleanerSettings";
import * as cleanerActions from "@/modules/antigravity-runtime/actions/conversationCleaner";

const mockToast = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "settings.conversationCleaner.title": "Broken Chat Cleaner",
        "settings.conversationCleaner.description":
          "Scan and remove orphaned chat entries.",
        "settings.conversationCleaner.scanAndClean": "Clean Broken Chats",
        "settings.conversationCleaner.dialogTitle": "Clean Broken Chats?",
        "settings.conversationCleaner.dialogDescription":
          "Scan conversation database for orphaned entries.",
        "settings.conversationCleaner.targetToggleLabel": "Target Environment",
        "settings.conversationCleaner.targetApp": "App (Antigravity 2.0)",
        "settings.conversationCleaner.targetIde": "IDE (Antigravity IDE)",
        "settings.conversationCleaner.targetCli": "CLI (agy)",
        "settings.conversationCleaner.scanning": "Scanning conversations...",
        "settings.conversationCleaner.scanningAria":
          "Scanning conversation records and local storage files",
        "settings.conversationCleaner.totalLabel": "Total registered",
        "settings.conversationCleaner.validLabel": "Intact",
        "settings.conversationCleaner.invalidLabel": "Broken",
        "settings.conversationCleaner.noInvalidChats":
          "All registered chats have valid local data.",
        "settings.conversationCleaner.zeroStateSubtext":
          "Your conversation history is fully synchronized across this environment.",
        "settings.conversationCleaner.hasInvalidChats": `${options?.count ?? 0} broken chat entries found.`,
        "settings.conversationCleaner.warning":
          "Restart Antigravity App after pruning.",
        "settings.conversationCleaner.cancel": "Cancel",
        "settings.conversationCleaner.confirm": "Prune Broken Chats",
        "settings.conversationCleaner.pruning": "Pruning...",
        "settings.conversationCleaner.successTitle": "Cleaned broken chats",
        "settings.conversationCleaner.successDescription": `Successfully pruned ${options?.count ?? 0} entries.`,
        "settings.conversationCleaner.failedTitle": "Failed to clean chats",
        "settings.conversationCleaner.notFoundTitle":
          "Conversation database not found",
        "settings.conversationCleaner.notFoundDescription":
          "No conversation database was detected for the selected environment.",
        "settings.conversationCleaner.errorTitle":
          "Database locked or inaccessible",
        "settings.conversationCleaner.retry": "Retry Scan",
        "settings.conversationCleaner.projectGroupsTitle": "Affected Projects",
        "settings.conversationCleaner.noWorkspaceGroup":
          "Global / No Workspace",
        "settings.conversationCleaner.untitledConversation":
          "Untitled Conversation",
        "settings.conversationCleaner.brokenCountBadge": `${options?.count ?? 0} broken`,
        "settings.conversationCleaner.showChats": "Show conversations",
        "settings.conversationCleaner.hideChats": "Hide conversations",
        "settings.conversationCleaner.toggleProjectAria": `Toggle conversation list for ${options?.project ?? ""}`,
      };
      return translations[key] || key;
    },
  }),
}));

describe("AntigravityConversationCleanerSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders card title and action trigger", () => {
    render(<AntigravityConversationCleanerSettings />);
    expect(screen.getByText("Broken Chat Cleaner")).toBeDefined();
    expect(screen.getByText("Clean Broken Chats")).toBeDefined();
  });

  it("State 1: displays skeleton loader while scanning is in progress", async () => {
    let resolveScan!: (val: unknown) => void;
    const scanPromise = new Promise((resolve) => {
      resolveScan = resolve;
    });

    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockReturnValue(
      scanPromise as any,
    );

    render(<AntigravityConversationCleanerSettings />);

    const triggerBtn = screen.getByText("Clean Broken Chats");
    fireEvent.click(triggerBtn);

    expect(screen.getByTestId("cleaner-skeleton-loader")).toBeDefined();

    resolveScan({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 5,
      invalidChats: 0,
      projectGroups: [],
    });

    await waitFor(() => {
      expect(screen.queryByTestId("cleaner-skeleton-loader")).toBeNull();
    });
  });

  it("State 2: opens dialog, scans stats, and executes pruning when broken chats exist", async () => {
    const statsSpy = vi
      .spyOn(cleanerActions, "getInvalidChatsStats")
      .mockResolvedValueOnce({
        target: "app",
        summariesDbPath: "/path/to/db",
        exists: true,
        totalChats: 10,
        validChats: 7,
        invalidChats: 3,
        projectGroups: [
          {
            projectName: "client-portal",
            workspacePath: "/Users/***/Projects/client-portal",
            brokenCount: 3,
            conversations: [
              { conversationId: "c1-uuid-12345", title: "Chat 1" },
              { conversationId: "c2-uuid-12345", title: "Chat 2" },
              { conversationId: "c3-uuid-12345", title: "Chat 3" },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        target: "app",
        summariesDbPath: "/path/to/db",
        exists: true,
        totalChats: 7,
        validChats: 7,
        invalidChats: 0,
        projectGroups: [],
      });

    vi.spyOn(cleanerActions, "cleanInvalidChats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      totalChecked: 10,
      prunedCount: 3,
      errors: [],
    });

    render(<AntigravityConversationCleanerSettings />);

    const triggerBtn = screen.getByText("Clean Broken Chats");
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(screen.getByText("3 broken chat entries found.")).toBeDefined();
      expect(screen.getByText("client-portal")).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", {
      name: "Prune Broken Chats",
    });
    expect(confirmBtn).toBeDefined();
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(cleanerActions.cleanInvalidChats).toHaveBeenCalledWith("app");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Cleaned broken chats",
          description: "Successfully pruned 3 entries.",
        }),
      );
      // Auto-refreshes to zero-state post-prune
      expect(statsSpy).toHaveBeenCalledTimes(2);
      expect(
        screen.getByText("All registered chats have valid local data."),
      ).toBeDefined();
    });
  });

  it("handles cleanInvalidChats returning errors array", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 4,
      invalidChats: 1,
      projectGroups: [
        {
          projectName: "api-service",
          workspacePath: "/path",
          brokenCount: 1,
          conversations: [{ conversationId: "cid-1", title: "Err chat" }],
        },
      ],
    });

    vi.spyOn(cleanerActions, "cleanInvalidChats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      totalChecked: 5,
      prunedCount: 0,
      errors: ["Disk I/O error during deletion", "Permission denied"],
    });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("1 broken chat entries found.")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Prune Broken Chats" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to clean chats",
          description: "Disk I/O error during deletion; Permission denied",
          variant: "destructive",
        }),
      );
    });
  });

  it("handles cleanInvalidChats returning prunedCount 0 and empty errors", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 4,
      invalidChats: 1,
      projectGroups: [
        {
          projectName: "api-service",
          workspacePath: "/path",
          brokenCount: 1,
          conversations: [{ conversationId: "cid-1", title: "Err chat" }],
        },
      ],
    });

    vi.spyOn(cleanerActions, "cleanInvalidChats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      totalChecked: 5,
      prunedCount: 0,
      errors: [],
    });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("1 broken chat entries found.")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Prune Broken Chats" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Cleaned broken chats",
          description: "All registered chats have valid local data.",
        }),
      );
    });
  });

  it("handles cleanInvalidChats throwing exception with Error and non-Error", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 4,
      invalidChats: 1,
      projectGroups: [
        {
          projectName: "api-service",
          workspacePath: "/path",
          brokenCount: 1,
          conversations: [{ conversationId: "cid-1", title: "Err chat" }],
        },
      ],
    });

    vi.spyOn(cleanerActions, "cleanInvalidChats").mockRejectedValueOnce(
      new Error("Unexpected SQLite failure"),
    );

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("1 broken chat entries found.")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Prune Broken Chats" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to clean chats",
          description: "Unexpected SQLite failure",
          variant: "destructive",
        }),
      );
    });

    // Test non-Error throw
    vi.spyOn(cleanerActions, "cleanInvalidChats").mockRejectedValueOnce(
      "Raw string error",
    );

    fireEvent.click(screen.getByRole("button", { name: "Prune Broken Chats" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to clean chats",
          description: "Raw string error",
          variant: "destructive",
        }),
      );
    });
  });

  it("State 3: renders healthy zero-state and disables purge CTA when invalidChats === 0", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 5,
      invalidChats: 0,
      projectGroups: [],
    });

    render(<AntigravityConversationCleanerSettings />);

    const triggerBtn = screen.getByText("Clean Broken Chats");
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(
        screen.getByText("All registered chats have valid local data."),
      ).toBeDefined();
      expect(
        screen.getByText(
          "Your conversation history is fully synchronized across this environment.",
        ),
      ).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", {
      name: "Prune Broken Chats",
    });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("State 4: renders missing database notice when exists is false", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValueOnce({
      target: "cli",
      summariesDbPath: "/Users/***/.gemini/antigravity-cli/db",
      exists: false,
      totalChats: 0,
      validChats: 0,
      invalidChats: 0,
      projectGroups: [],
    });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("Conversation database not found")).toBeDefined();
      expect(
        screen.getByText(
          "No conversation database was detected for the selected environment.",
        ),
      ).toBeDefined();
      expect(
        screen.getByText("/Users/***/.gemini/antigravity-cli/db"),
      ).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", {
      name: "Prune Broken Chats",
    });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("State 4: handles exists false without summariesDbPath", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValueOnce({
      target: "cli",
      summariesDbPath: "",
      exists: false,
      totalChats: 0,
      validChats: 0,
      invalidChats: 0,
      projectGroups: [],
    });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("Conversation database not found")).toBeDefined();
    });
  });

  it("State 5: renders inline recoverable error state when stats.error is present and retries on click", async () => {
    const statsSpy = vi
      .spyOn(cleanerActions, "getInvalidChatsStats")
      .mockResolvedValueOnce({
        target: "app",
        summariesDbPath: "/path/to/db",
        exists: true,
        totalChats: 0,
        validChats: 0,
        invalidChats: 0,
        projectGroups: [],
        error: "SQLITE_BUSY: database is locked",
      })
      .mockResolvedValueOnce({
        target: "app",
        summariesDbPath: "/path/to/db",
        exists: true,
        totalChats: 10,
        validChats: 10,
        invalidChats: 0,
        projectGroups: [],
      });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("Database locked or inaccessible")).toBeDefined();
      expect(screen.getByText("SQLITE_BUSY: database is locked")).toBeDefined();
    });

    // Zero-state should NOT be rendered when error is present
    expect(
      screen.queryByText("All registered chats have valid local data."),
    ).toBeNull();

    const confirmBtn = screen.getByRole("button", {
      name: "Prune Broken Chats",
    });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    // Click Retry Scan
    const retryBtn = screen.getByRole("button", { name: "Retry Scan" });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(statsSpy).toHaveBeenCalledTimes(2);
      expect(
        screen.getByText("All registered chats have valid local data."),
      ).toBeDefined();
    });
  });

  it("handles getInvalidChatsStats throwing an exception", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockRejectedValueOnce(
      new Error("IPC connection failed"),
    );

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("Database locked or inaccessible")).toBeDefined();
      expect(screen.getByText("IPC connection failed")).toBeDefined();
    });

    // Also test non-Error string rejection
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockRejectedValueOnce(
      "IPC string failure",
    );
    const retryBtn = screen.getByRole("button", { name: "Retry Scan" });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("IPC string failure")).toBeDefined();
    });
  });

  it("Target Toggling: switches targets and triggers scans", async () => {
    const statsSpy = vi
      .spyOn(cleanerActions, "getInvalidChatsStats")
      .mockResolvedValue({
        target: "app",
        summariesDbPath: "/path/to/db",
        exists: true,
        totalChats: 5,
        validChats: 5,
        invalidChats: 0,
        projectGroups: [],
      });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(statsSpy).toHaveBeenCalledWith("app");
    });

    // Click IDE tab
    const ideTab = screen.getByRole("tab", { name: "IDE (Antigravity IDE)" });
    fireEvent.click(ideTab);

    await waitFor(() => {
      expect(statsSpy).toHaveBeenCalledWith("ide");
    });

    // Click CLI tab
    const cliTab = screen.getByRole("tab", { name: "CLI (agy)" });
    fireEvent.click(cliTab);

    await waitFor(() => {
      expect(statsSpy).toHaveBeenCalledWith("cli");
    });

    // Redundant click on already selected CLI tab does not trigger extra scan
    const callsBefore = statsSpy.mock.calls.length;
    fireEvent.click(cliTab);
    expect(statsSpy.mock.calls.length).toBe(callsBefore);
  });

  it("Target Switch Race Guard: discards stale out-of-order async responses", async () => {
    let resolveFirstScan!: (val: unknown) => void;
    let resolveSecondScan!: (val: unknown) => void;

    const firstPromise = new Promise((resolve) => {
      resolveFirstScan = resolve;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecondScan = resolve;
    });

    const statsSpy = vi
      .spyOn(cleanerActions, "getInvalidChatsStats")
      .mockImplementation((target) => {
        if (target === "ide") {
          return firstPromise as any;
        }
        return secondPromise as any;
      });

    render(<AntigravityConversationCleanerSettings />);
    // Initial scan with "app"
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    // User immediately switches to IDE
    const ideTab = screen.getByRole("tab", { name: "IDE (Antigravity IDE)" });
    fireEvent.click(ideTab);

    // User immediately switches to CLI before IDE resolves
    const cliTab = screen.getByRole("tab", { name: "CLI (agy)" });
    fireEvent.click(cliTab);

    // CLI resolves first with 1 broken chat
    resolveSecondScan({
      target: "cli",
      summariesDbPath: "/path/to/cli/db",
      exists: true,
      totalChats: 2,
      validChats: 1,
      invalidChats: 1,
      projectGroups: [
        {
          projectName: "cli-tools",
          workspacePath: "/path",
          brokenCount: 1,
          conversations: [{ conversationId: "cid-cli", title: "CLI Session" }],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("CLI Session")).toBeDefined();
    });

    // IDE resolves late with 10 broken chats
    resolveFirstScan({
      target: "ide",
      summariesDbPath: "/path/to/ide/db",
      exists: true,
      totalChats: 20,
      validChats: 10,
      invalidChats: 10,
      projectGroups: [
        {
          projectName: "stale-ide-project",
          workspacePath: "/path",
          brokenCount: 10,
          conversations: [
            { conversationId: "cid-ide", title: "Stale IDE Chat" },
          ],
        },
      ],
    });

    // The delayed IDE response must be discarded; CLI data remains displayed!
    expect(screen.queryByText("Stale IDE Chat")).toBeNull();
    expect(screen.getByText("CLI Session")).toBeDefined();
  });

  it("closes dialog when Cancel button is clicked", async () => {
    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 5,
      invalidChats: 0,
      projectGroups: [],
    });

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(
        screen.getByText("All registered chats have valid local data."),
      ).toBeDefined();
    });

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(
        screen.queryByText("All registered chats have valid local data."),
      ).toBeNull();
    });
  });

  it("Target Switch Race Guard: discards rejected promises from outdated target requests", async () => {
    let rejectFirstScan!: (err: unknown) => void;
    let resolveSecondScan!: (val: unknown) => void;

    const firstPromise = new Promise((_, reject) => {
      rejectFirstScan = reject;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecondScan = resolve;
    });

    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockImplementation(
      (target) => {
        if (target === "ide") {
          return firstPromise as any;
        }
        return secondPromise as any;
      },
    );

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    // User switches to IDE
    const ideTab = screen.getByRole("tab", { name: "IDE (Antigravity IDE)" });
    fireEvent.click(ideTab);

    // User immediately switches to CLI before IDE rejects
    const cliTab = screen.getByRole("tab", { name: "CLI (agy)" });
    fireEvent.click(cliTab);

    // CLI resolves first
    resolveSecondScan({
      target: "cli",
      summariesDbPath: "/path",
      exists: true,
      totalChats: 2,
      validChats: 2,
      invalidChats: 0,
      projectGroups: [],
    });

    await waitFor(() => {
      expect(
        screen.getByText("All registered chats have valid local data."),
      ).toBeDefined();
    });

    // IDE now rejects late
    rejectFirstScan(new Error("Late failure"));

    // Verify error state is NOT set and zero-state remains
    expect(screen.queryByText("Late failure")).toBeNull();
    expect(
      screen.getByText("All registered chats have valid local data."),
    ).toBeDefined();
  });

  it("prevents dialog closure while pruning is active", async () => {
    let resolveClean!: (val: unknown) => void;
    const cleanPromise = new Promise((resolve) => {
      resolveClean = resolve;
    });

    vi.spyOn(cleanerActions, "getInvalidChatsStats").mockResolvedValue({
      target: "app",
      summariesDbPath: "/path/to/db",
      exists: true,
      totalChats: 5,
      validChats: 4,
      invalidChats: 1,
      projectGroups: [
        {
          projectName: "api",
          workspacePath: "/path",
          brokenCount: 1,
          conversations: [{ conversationId: "c1", title: "Chat" }],
        },
      ],
    });

    vi.spyOn(cleanerActions, "cleanInvalidChats").mockReturnValue(
      cleanPromise as any,
    );

    render(<AntigravityConversationCleanerSettings />);
    fireEvent.click(screen.getByText("Clean Broken Chats"));

    await waitFor(() => {
      expect(screen.getByText("1 broken chat entries found.")).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", {
      name: "Prune Broken Chats",
    });
    fireEvent.click(confirmBtn);

    // Now isPruning is true
    expect(screen.getByText("Pruning...")).toBeDefined();

    // Cancel button should be disabled while pruning
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);

    // Resolve clean action
    resolveClean({
      target: "app",
      summariesDbPath: "/path/to/db",
      totalChecked: 5,
      prunedCount: 1,
      errors: [],
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Cleaned broken chats",
        }),
      );
    });
  });
});
