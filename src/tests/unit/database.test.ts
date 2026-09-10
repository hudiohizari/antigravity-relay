import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDatabaseConnection,
  getCurrentAccountInfo,
  backupAccount,
  restoreAccount,
} from "@/modules/account/persistence/antigravity-state-database";
import fs from "fs";
import path from "path";

let inMemoryDb = new Map<string, string>();

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: string) => ({ __key: value }),
  desc: (value: unknown) => value,
}));

interface MockOrm {
  select: () => {
    from: () => {
      where: (condition: { __key?: string }) => {
        all: () => Array<{ value: string }>;
      };
    };
  };
  insert: () => {
    values: (row: { key: string; value: string }) => {
      onConflictDoUpdate: () => {
        run: () => { changes: number };
      };
    };
  };
  transaction: (fn: (tx: MockOrm) => void) => void;
}

const mockOrm: MockOrm = {
  select: () => ({
    from: () => ({
      where: (condition: { __key?: string }) => ({
        all: () => {
          const key = condition?.__key ?? "";
          const value = inMemoryDb.get(key);
          if (value === undefined) {
            return [];
          }
          return [{ value }];
        },
      }),
    }),
  }),
  insert: () => ({
    values: (row: { key: string; value: string }) => ({
      onConflictDoUpdate: () => ({
        run: () => {
          inMemoryDb.set(row.key, row.value);
          return { changes: 1 };
        },
      }),
    }),
  }),
  transaction: (fn: (tx: MockOrm) => void) => {
    fn(mockOrm);
  },
};

vi.mock("@/shared/persistence/database/dbConnection", () => ({
  openDrizzleConnection: () => ({
    raw: { close: vi.fn() },
    orm: mockOrm,
  }),
}));

const mockDbPath = path.join(process.cwd(), "mock_test.vscdb");

vi.mock("../../shared/platform/paths", () => ({
  getAntigravityDbPath: () => mockDbPath,
  getAntigravityDbPaths: () => [mockDbPath],
  getAgentDir: () => path.join(process.cwd(), "mock_test_agent"),
}));

vi.mock("../../shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Database Handler", () => {
  beforeEach(() => {
    inMemoryDb.clear();
    inMemoryDb.set(
      "antigravityAuthStatus",
      JSON.stringify({
        user: { email: "test@example.com", name: "Test User" },
      }),
    );
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should connect to database", () => {
    const { raw } = getDatabaseConnection();
    expect(raw).toBeDefined();
    raw.close();
  });

  it("should get current account info", () => {
    const info = getCurrentAccountInfo();
    expect(info.email).toBe("test@example.com");
    expect(info.name).toBe("Test User");
    expect(info.isAuthenticated).toBe(true);
  });

  it("should backup account", () => {
    const account = {
      id: "123",
      name: "Test User",
      email: "test@example.com",
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
    };
    const backup = backupAccount(account);
    expect(backup.account).toEqual(account);
    expect(backup.data["antigravityAuthStatus"]).toBeDefined();
  });

  it("should restore account", () => {
    const backup = {
      version: "1.0",
      account: {
        id: "123",
        name: "Restored User",
        email: "restored@example.com",
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
      },
      data: {
        antigravityAuthStatus: JSON.stringify({
          user: { email: "restored@example.com" },
        }),
        "jetskiStateSync.agentManagerInitState": "initialized",
      },
    };

    restoreAccount(backup);

    const restoredAuth = inMemoryDb.get("antigravityAuthStatus");
    expect(restoredAuth).toBeDefined();
    const value = JSON.parse(restoredAuth!);
    expect(value.user.email).toBe("restored@example.com");

    expect(inMemoryDb.get("jetskiStateSync.agentManagerInitState")).toBe(
      "initialized",
    );
  });
});
