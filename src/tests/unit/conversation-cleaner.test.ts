import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pathsModule from "@/shared/platform/paths";

interface MockSummaryRow {
  conversation_id: string;
  title?: string | null;
  workspace_uris?: string | null;
  last_modified_time?: string | number | null;
}

interface MockState {
  conversationSummaries: MockSummaryRow[];
  tableExists: boolean;
  shouldThrowOnOpen?: unknown;
  shouldThrowOnTransaction?: unknown;
  shouldFailFullSelect?: boolean;
  transactionCalled: boolean;
  executedQueries: string[];
}

const mockState: MockState = {
  conversationSummaries: [],
  tableExists: true,
  shouldThrowOnOpen: null,
  shouldThrowOnTransaction: null,
  shouldFailFullSelect: false,
  transactionCalled: false,
  executedQueries: [],
};

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      public dbPath: string;

      constructor(dbPath: string, _options?: unknown) {
        if (mockState.shouldThrowOnOpen) {
          throw mockState.shouldThrowOnOpen;
        }
        this.dbPath = dbPath;
      }

      pragma(_cmd: string) {
        return [];
      }

      prepare(sql: string) {
        mockState.executedQueries.push(sql);

        if (sql.includes("sqlite_master")) {
          return {
            get: () =>
              mockState.tableExists
                ? { name: "conversation_summaries" }
                : undefined,
          };
        }

        if (
          mockState.shouldFailFullSelect &&
          sql.includes("workspace_uris")
        ) {
          throw new Error("no such column: workspace_uris");
        }

        if (sql.includes("DELETE FROM conversation_summaries")) {
          return {
            run: (id: string) => {
              mockState.conversationSummaries =
                mockState.conversationSummaries.filter(
                  (item) => item.conversation_id !== id,
                );
              return { changes: 1 };
            },
          };
        }

        if (sql.includes("FROM conversation_summaries")) {
          return {
            all: () =>
              mockState.conversationSummaries.map((item) => ({ ...item })),
          };
        }

        return {
          get: () => undefined,
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }

      transaction(fn: (...args: unknown[]) => unknown) {
        return (...args: unknown[]) => {
          mockState.transactionCalled = true;
          if (mockState.shouldThrowOnTransaction) {
            throw mockState.shouldThrowOnTransaction;
          }
          return fn(...args);
        };
      }

      close() {
        // no-op
      }
    },
  };
});

vi.mock("@/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getInvalidChatsStats,
  cleanInvalidChats,
  parseWorkspaceInfo,
  parseTimestamp,
  CONVERSATION_CLEANER_CONSTANTS,
} from "@/modules/antigravity-runtime/conversation/conversationCleaner";

describe("Conversation Cleaner Service", () => {
  let tempDir: string;
  let summariesDbPath: string;
  let conversationsDir: string;

  beforeEach(() => {
    mockState.conversationSummaries = [];
    mockState.tableExists = true;
    mockState.shouldThrowOnOpen = null;
    mockState.shouldThrowOnTransaction = null;
    mockState.shouldFailFullSelect = false;
    mockState.transactionCalled = false;
    mockState.executedQueries = [];

    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "antigravity-conv-cleaner-"),
    );
    const geminiDir = path.join(tempDir, ".gemini", "antigravity");
    fs.mkdirSync(geminiDir, { recursive: true });

    summariesDbPath = path.join(geminiDir, "conversation_summaries.db");
    conversationsDir = path.join(geminiDir, "conversations");
    fs.mkdirSync(conversationsDir, { recursive: true });

    vi.spyOn(
      pathsModule,
      "getAntigravityConversationSummariesDbPath",
    ).mockImplementation((target) => {
      const sub =
        target === "ide"
          ? "antigravity-ide"
          : target === "cli"
            ? "antigravity-cli"
            : "antigravity";
      return path.join(tempDir, ".gemini", sub, "conversation_summaries.db");
    });

    vi.spyOn(pathsModule, "getAntigravityConversationsDir").mockImplementation(
      (target) => {
        const sub =
          target === "ide"
            ? "antigravity-ide"
            : target === "cli"
              ? "antigravity-cli"
              : "antigravity";
        return path.join(tempDir, ".gemini", sub, "conversations");
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Workspace URI Parsing & PII Sanitization", () => {
    it("handles valid JSON array with file:// URIs and masks user path", () => {
      const raw = JSON.stringify([
        "file:///Users/devon/WebProjects/backend-api",
      ]);
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("backend-api");
      expect(result.workspacePath).toBe("/Users/***/WebProjects/backend-api");
    });

    it("handles JSON string primitive directly as workspace URI", () => {
      const raw = JSON.stringify("file:///Users/devon/WebProjects/backend-api");
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("backend-api");
      expect(result.workspacePath).toBe("/Users/***/WebProjects/backend-api");
    });

    it("normalizes Windows drive letters and strips leading slash", () => {
      const raw = JSON.stringify([
        "file:///c:/Users/devon/WebProjects/my-desktop-app",
      ]);
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("my-desktop-app");
      expect(result.workspacePath).toBe(
        "C:/Users/***/WebProjects/my-desktop-app",
      );
    });

    it("decodes percent-encoded workspace URIs", () => {
      const raw = JSON.stringify([
        "file:///Users/devon/Client%20Projects/mobile%23app",
      ]);
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("mobile#app");
      expect(result.workspacePath).toBe(
        "/Users/***/Client Projects/mobile#app",
      );
    });

    it("handles file://localhost format cleanly", () => {
      const raw = "file://localhost/Users/devon/WebProjects/cloud-sync";
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("cloud-sync");
      expect(result.workspacePath).toBe("/Users/***/WebProjects/cloud-sync");
    });

    it("falls back to Global / No Workspace for empty, null, or malformed inputs", () => {
      expect(parseWorkspaceInfo("").projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(parseWorkspaceInfo(null).projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(parseWorkspaceInfo("[]").projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(parseWorkspaceInfo("[null]").projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(parseWorkspaceInfo("null").projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(parseWorkspaceInfo("file:///C:/").projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(parseWorkspaceInfo(JSON.stringify(["   "])).projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
    });

    it("handles malformed percent-encoded URIs gracefully without throwing", () => {
      const raw = JSON.stringify(["file:///Users/devon/%E0%A4%A/my-app"]);
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("my-app");
    });

    it("handles raw non-URI paths with backslashes on Windows", () => {
      const raw = JSON.stringify(["C:\\Users\\devon\\WebProjects\\win-tool"]);
      const result = parseWorkspaceInfo(raw);
      expect(result.projectName).toBe("win-tool");
      expect(result.workspacePath).toBe(
        "C:\\Users\\***\\WebProjects\\win-tool",
      );
    });
  });

  describe("Timestamp Parsing", () => {
    it("parses valid ISO string to timestamp", () => {
      const ts = parseTimestamp("2026-09-28T00:00:00.000Z");
      expect(ts).toBe(Date.parse("2026-09-28T00:00:00.000Z"));
    });

    it("returns number directly when provided", () => {
      const now = 1790528000000;
      expect(parseTimestamp(now)).toBe(now);
    });

    it("returns undefined for invalid timestamps", () => {
      expect(parseTimestamp("invalid-date-string")).toBeUndefined();
      expect(parseTimestamp(null)).toBeUndefined();
      expect(parseTimestamp("")).toBeUndefined();
    });
  });

  describe("O(1) Set Performance vs N-Loop Filesystem Checks", () => {
    it("performs a single readdirSync on conversationsDir and zero individual existsSync calls", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      // Populate 50 conversation records
      const cids: MockSummaryRow[] = [];
      for (let i = 0; i < 50; i++) {
        cids.push({
          conversation_id: `cid-${i}`,
          title: `Chat ${i}`,
          workspace_uris: JSON.stringify(["file:///Users/devon/project"]),
          last_modified_time: Date.now(),
        });
      }
      mockState.conversationSummaries = cids;

      // Create trajectory files for first 25
      for (let i = 0; i < 25; i++) {
        fs.writeFileSync(path.join(conversationsDir, `cid-${i}.db`), "data");
      }

      const readdirSpy = vi.spyOn(fs, "readdirSync");
      const existsSpy = vi.spyOn(fs, "existsSync");

      const stats = getInvalidChatsStats("app");

      expect(stats.exists).toBe(true);
      expect(stats.totalChats).toBe(50);
      expect(stats.validChats).toBe(25);
      expect(stats.invalidChats).toBe(25);

      // Verify single directory readdir call for O(1) set construction
      const convDirReads = readdirSpy.mock.calls.filter((call) =>
        String(call[0]).includes("conversations"),
      );
      expect(convDirReads.length).toBe(1);

      // Verify that individual trajectory files were NOT probed using existsSync
      const trajectoryFileProbes = existsSpy.mock.calls.filter((call) =>
        String(call[0]).endsWith(".db") && String(call[0]).includes("cid-"),
      );
      expect(trajectoryFileProbes.length).toBe(0);
    });
  });

  describe("Project Grouping & Sorting Breakdown", () => {
    it("groups broken conversations by project with proper titles, timestamps, and ordering", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        {
          conversation_id: "conv-1",
          title: "Fix Token Expiry",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/WebProjects/auth-service",
          ]),
          last_modified_time: 1000,
        },
        {
          conversation_id: "conv-2",
          title: "Add Refresh Logic",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/WebProjects/auth-service",
          ]),
          last_modified_time: 2000,
        },
        {
          conversation_id: "conv-3",
          title: "", // empty title -> fallback
          workspace_uris: JSON.stringify([
            "file:///Users/devon/WebProjects/billing-service",
          ]),
          last_modified_time: 1500,
        },
        {
          conversation_id: "conv-4",
          title: "Quick Scratchpad",
          workspace_uris: "[]", // no workspace
          last_modified_time: 500,
        },
      ];

      // No trajectory files exist on disk -> all 4 broken
      const stats = getInvalidChatsStats("app");
      expect(stats.invalidChats).toBe(4);
      expect(stats.projectGroups.length).toBe(3);

      // Verify alphabetical ordering of named projects, with Global / No Workspace strictly last
      expect(stats.projectGroups[0].projectName).toBe("auth-service");
      expect(stats.projectGroups[0].brokenCount).toBe(2);
      expect(stats.projectGroups[0].workspacePath).toBe(
        "/Users/***/WebProjects/auth-service",
      );

      // Inside auth-service, conv-2 (time 2000) should appear before conv-1 (time 1000)
      expect(stats.projectGroups[0].conversations[0].conversationId).toBe(
        "conv-2",
      );
      expect(stats.projectGroups[0].conversations[0].title).toBe(
        "Add Refresh Logic",
      );
      expect(stats.projectGroups[0].conversations[1].conversationId).toBe(
        "conv-1",
      );
      expect(stats.projectGroups[0].conversations[1].title).toBe(
        "Fix Token Expiry",
      );

      expect(stats.projectGroups[1].projectName).toBe("billing-service");
      expect(stats.projectGroups[1].brokenCount).toBe(1);
      expect(stats.projectGroups[1].conversations[0].title).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_CHAT_TITLE,
      );

      expect(stats.projectGroups[2].projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(stats.projectGroups[2].brokenCount).toBe(1);
      expect(stats.projectGroups[2].conversations[0].conversationId).toBe(
        "conv-4",
      );
    });

    it("resolves sorting tie-breaker by ascending conversationId when updatedAt timestamps are identical", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        {
          conversation_id: "conv-zebra",
          title: "Zebra Task",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/WebProjects/mono-repo",
          ]),
          last_modified_time: 1500,
        },
        {
          conversation_id: "conv-alpha",
          title: "Alpha Task",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/WebProjects/mono-repo",
          ]),
          last_modified_time: 1500,
        },
        {
          conversation_id: "conv-middle",
          title: "Middle Task",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/WebProjects/mono-repo",
          ]),
          last_modified_time: 1500,
        },
      ];

      const stats = getInvalidChatsStats("app");
      expect(stats.projectGroups.length).toBe(1);
      const convs = stats.projectGroups[0].conversations;
      expect(convs.map((c) => c.conversationId)).toEqual([
        "conv-alpha",
        "conv-middle",
        "conv-zebra",
      ]);
    });

    it("executes schema fallback query when optional table columns are missing", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.shouldFailFullSelect = true;
      mockState.conversationSummaries = [
        { conversation_id: "legacy-conv-1" },
        { conversation_id: "legacy-conv-2" },
      ];

      const stats = getInvalidChatsStats("app");
      expect(stats.totalChats).toBe(2);
      expect(stats.invalidChats).toBe(2);
      expect(stats.projectGroups.length).toBe(1);
      expect(stats.projectGroups[0].projectName).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
      );
      expect(stats.projectGroups[0].conversations[0].title).toBe(
        CONVERSATION_CLEANER_CONSTANTS.FALLBACK_CHAT_TITLE,
      );
      expect(stats.projectGroups[0].conversations[0].updatedAt).toBeUndefined();
      expect(mockState.executedQueries).toContain(
        "SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries",
      );
      expect(mockState.executedQueries).toContain(
        "SELECT conversation_id FROM conversation_summaries",
      );
    });

    it("sorts project groups by workspacePath when project names are identical", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        {
          conversation_id: "conv-b",
          title: "Service B",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/Workspaces/Beta/service",
          ]),
        },
        {
          conversation_id: "conv-a",
          title: "Service A",
          workspace_uris: JSON.stringify([
            "file:///Users/devon/Workspaces/Alpha/service",
          ]),
        },
      ];

      const stats = getInvalidChatsStats("app");
      expect(stats.projectGroups.length).toBe(2);
      expect(stats.projectGroups[0].workspacePath).toBe(
        "/Users/***/Workspaces/Alpha/service",
      );
      expect(stats.projectGroups[1].workspacePath).toBe(
        "/Users/***/Workspaces/Beta/service",
      );
    });
  });

  describe("Database Lock Error Propagation", () => {
    it("returns error string when SQLite encounters SQLITE_BUSY or locks", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.shouldThrowOnOpen = new Error(
        "SQLITE_BUSY: database is locked",
      );

      const stats = getInvalidChatsStats("app");
      expect(stats.exists).toBe(true);
      expect(stats.error).toContain("SQLITE_BUSY: database is locked");
      expect(stats.invalidChats).toBe(0);
      expect(stats.totalChats).toBe(0);
      expect(stats.projectGroups).toEqual([]);
    });

    it("handles non-Error thrown exceptions during database open", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.shouldThrowOnOpen = "Raw string database initialization error";

      const stats = getInvalidChatsStats("app");
      expect(stats.exists).toBe(true);
      expect(stats.error).toBe("Raw string database initialization error");
    });
  });

  describe("Multi-Target Scanning & Pruning", () => {
    it("handles ide and cli targets properly", () => {
      const cliDbDir = path.join(tempDir, ".gemini", "antigravity-cli");
      const cliConvDir = path.join(cliDbDir, "conversations");
      fs.mkdirSync(cliConvDir, { recursive: true });
      const cliDbPath = path.join(cliDbDir, "conversation_summaries.db");
      fs.writeFileSync(cliDbPath, "dummy");

      mockState.conversationSummaries = [
        { conversation_id: "cli-1", title: "CLI Session" },
      ];

      const stats = getInvalidChatsStats("cli");
      expect(stats.target).toBe("cli");
      expect(stats.exists).toBe(true);
      expect(stats.invalidChats).toBe(1);

      const cleanResult = cleanInvalidChats("cli");
      expect(cleanResult.target).toBe("cli");
      expect(cleanResult.prunedCount).toBe(1);
      expect(cleanResult.errors).toEqual([]);
    });
  });

  describe("Atomic Transaction & Protobuf Mirror Cache Invalidation", () => {
    it("deletes orphaned rows within a transaction and removes all candidate pb mirror files", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        { conversation_id: "chat-keep" },
        { conversation_id: "chat-broken" },
      ];
      fs.writeFileSync(
        path.join(conversationsDir, "chat-keep.db"),
        "trajectory content",
      );

      const parentDir = path.dirname(summariesDbPath);
      const proto1 = path.join(parentDir, "agyhub_summaries_proto.pb");
      const proto2 = path.join(parentDir, "agyhub_summaries.pb");
      const proto3 = path.join(parentDir, "jetbox_summaries.pb");
      fs.writeFileSync(proto1, "pb1");
      fs.writeFileSync(proto2, "pb2");
      fs.writeFileSync(proto3, "pb3");

      const cleanResult = cleanInvalidChats("app");
      expect(cleanResult.prunedCount).toBe(1);
      expect(mockState.transactionCalled).toBe(true);
      expect(mockState.conversationSummaries.map((c) => c.conversation_id)).toEqual(
        ["chat-keep"],
      );

      expect(fs.existsSync(proto1)).toBe(false);
      expect(fs.existsSync(proto2)).toBe(false);
      expect(fs.existsSync(proto3)).toBe(false);
    });

    it("captures transaction execution failures into result.errors without throwing", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        { conversation_id: "broken-1" },
      ];
      mockState.shouldThrowOnTransaction = new Error(
        "disk I/O error during transaction commit",
      );

      const cleanResult = cleanInvalidChats("app");
      expect(cleanResult.prunedCount).toBe(0);
      expect(cleanResult.errors.length).toBe(1);
      expect(cleanResult.errors[0]).toContain(
        "Failed to clean conversation summaries: disk I/O error during transaction commit",
      );
    });

    it("captures non-Error transaction execution failures into result.errors", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        { conversation_id: "broken-1" },
      ];
      mockState.shouldThrowOnTransaction = "Raw unhandled transaction error";

      const cleanResult = cleanInvalidChats("app");
      expect(cleanResult.prunedCount).toBe(0);
      expect(cleanResult.errors.length).toBe(1);
      expect(cleanResult.errors[0]).toContain(
        "Failed to clean conversation summaries: Raw unhandled transaction error",
      );
    });

    it("safely handles and logs failure during proto mirror unlinking without aborting cleanup", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        { conversation_id: "broken-orphan" },
      ];

      const parentDir = path.dirname(summariesDbPath);
      const protoPath = path.join(parentDir, "agyhub_summaries.pb");
      fs.writeFileSync(protoPath, "stale proto data");

      const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation((targetPath) => {
        if (String(targetPath).endsWith(".pb")) {
          throw new Error("EACCES: permission denied, unlink");
        }
        return undefined as unknown as void;
      });

      const cleanResult = cleanInvalidChats("app");
      expect(cleanResult.prunedCount).toBe(1);
      expect(cleanResult.errors).toEqual([]);
      unlinkSpy.mockRestore();
    });
  });

  describe("TOCTOU Race Condition Handling", () => {
    it("re-evaluates directory on disk during clean to avoid deleting newly restored trajectory files", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.conversationSummaries = [
        { conversation_id: "chat-1" },
        { conversation_id: "chat-2" },
      ];

      // Scan sees chat-1 missing
      const stats = getInvalidChatsStats("app");
      expect(stats.invalidChats).toBe(2);

      // Trajectory files are restored before clean is invoked!
      fs.writeFileSync(path.join(conversationsDir, "chat-1.db"), "restored");
      fs.writeFileSync(path.join(conversationsDir, "chat-2.db"), "restored");

      const cleanResult = cleanInvalidChats("app");
      // TOCTOU check ensures nothing was pruned because trajectories were restored
      expect(cleanResult.prunedCount).toBe(0);
      expect(mockState.conversationSummaries.length).toBe(2);
    });
  });

  describe("Missing Database and Missing Table Handling", () => {
    it("returns exists: false when database file does not exist", () => {
      const stats = getInvalidChatsStats("ide");
      expect(stats.exists).toBe(false);
      expect(stats.totalChats).toBe(0);
      expect(stats.invalidChats).toBe(0);

      const cleanResult = cleanInvalidChats("ide");
      expect(cleanResult.prunedCount).toBe(0);
      expect(cleanResult.errors.length).toBeGreaterThan(0);
    });

    it("handles missing conversation_summaries table gracefully", () => {
      fs.writeFileSync(summariesDbPath, "dummy sqlite header");
      mockState.tableExists = false;

      const stats = getInvalidChatsStats("app");
      expect(stats.exists).toBe(true);
      expect(stats.totalChats).toBe(0);

      const cleanResult = cleanInvalidChats("app");
      expect(cleanResult.prunedCount).toBe(0);
      expect(cleanResult.errors).toContain(
        "Table conversation_summaries does not exist.",
      );
    });
  });
});
