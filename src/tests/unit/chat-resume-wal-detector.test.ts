import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type MockRow = Record<string, any>;
interface MockTable {
  name: string;
  columns: string[];
  rows: MockRow[];
}
interface MockDbData {
  tables: MockTable[];
  pragmaLog: string[];
}

const dbStore = new Map<string, MockDbData>();

function getOrCreateDb(dbPath: string): MockDbData {
  let db = dbStore.get(dbPath);
  if (!db) {
    db = { tables: [], pragmaLog: [] };
    dbStore.set(dbPath, db);
  }
  return db;
}

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      dbPath: string;

      constructor(dbPath: string, _options?: unknown) {
        if (fs.existsSync(dbPath)) {
          const content = fs.readFileSync(dbPath, "utf-8");
          if (content.includes("NOT A VALID SQLITE DATABASE HEADER")) {
            throw new Error("file is not a database");
          }
        } else {
          fs.writeFileSync(dbPath, "");
        }
        this.dbPath = dbPath;
        getOrCreateDb(dbPath);
      }

      pragma(cmd: string) {
        const db = getOrCreateDb(this.dbPath);
        db.pragmaLog.push(cmd);
        if (cmd.startsWith("table_info(")) {
          const tableName = cmd
            .slice("table_info(".length, -1)
            .trim()
            .replace(/['"]/g, "");
          const table = db.tables.find((t) => t.name === tableName);
          return table ? table.columns.map((c) => ({ name: c })) : [];
        }
        if (cmd === "wal_checkpoint(PASSIVE)") {
          return [{ busy: 0, log: 0, checkpointed: 0 }];
        }
        return [];
      }

      exec(sql: string) {
        const db = getOrCreateDb(this.dbPath);
        const trimmed = sql.trim();
        if (/CREATE\s+TABLE\s+steps/i.test(trimmed)) {
          if (!db.tables.some((t) => t.name === "steps")) {
            db.tables.push({
              name: "steps",
              columns: ["id", "cascade_id", "prompt", "status", "model"],
              rows: [],
            });
          }
        } else if (/CREATE\s+TABLE\s+ItemTable/i.test(trimmed)) {
          if (!db.tables.some((t) => t.name === "ItemTable")) {
            db.tables.push({
              name: "ItemTable",
              columns: ["key", "value"],
              rows: [],
            });
          }
        } else if (/INSERT\s+INTO\s+steps/i.test(trimmed)) {
          const match = trimmed.match(
            /VALUES\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*'([^']*)'\s*\)/i,
          );
          if (match) {
            const table = db.tables.find((t) => t.name === "steps");
            table?.rows.push({
              id: match[1],
              cascade_id: match[2],
              prompt: match[3],
              status: Number(match[4]),
              model: match[5],
            });
          }
        } else if (/INSERT\s+INTO\s+ItemTable/i.test(trimmed)) {
          const match = trimmed.match(
            /VALUES\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/i,
          );
          if (match) {
            const table = db.tables.find((t) => t.name === "ItemTable");
            table?.rows.push({
              key: match[1],
              value: match[2],
            });
          }
        }
      }

      prepare(query: string) {
        const db = getOrCreateDb(this.dbPath);
        const q = query.trim();
        return {
          all: () => {
            if (q.includes("sqlite_master")) {
              return db.tables.map((t) => ({ name: t.name }));
            }
            if (q.includes("ItemTable")) {
              const table = db.tables.find((t) => t.name === "ItemTable");
              if (!table) return [];
              if (q.includes("WHERE")) {
                return table.rows.filter(
                  (r) =>
                    r.key.includes("active") ||
                    (typeof r.value === "string" &&
                      (r.value.includes('"status":2') ||
                        r.value.includes('"status": 2'))),
                );
              }
              return [...table.rows];
            }
            return [];
          },
          get: () => {
            if (q.includes("sqlite_master")) {
              const match = q.match(/name\s*=\s*'([^']+)'/i);
              if (match) {
                const found = db.tables.find((t) => t.name === match[1]);
                return found ? { name: found.name } : undefined;
              }
              return db.tables[0] ? { name: db.tables[0].name } : undefined;
            }
            if (q.includes("WHERE status = 2")) {
              for (const table of db.tables) {
                const row = table.rows.find((r) => r.status === 2);
                if (row) return { ...row };
              }
            }
            return undefined;
          },
          run: (...args: any[]) => {
            if (/INSERT\s+INTO\s+ItemTable/i.test(q)) {
              const table = db.tables.find((t) => t.name === "ItemTable");
              if (table) {
                table.rows.push({
                  key: args[0],
                  value: args[1],
                });
              }
            }
          },
        };
      }

      close() {}
    },
  };
});

import Database from "better-sqlite3";
import { checkpointStateDatabases } from "@/modules/chat-resume/walCheckpoint";
import {
  detectActiveTurn,
  detectActiveTurnInDatabase,
  isCliTarget,
} from "@/modules/chat-resume/activeTurnDetector";
import { SessionContinuityBuffer } from "@/modules/chat-resume/SessionContinuityBuffer";

const DatabaseConstructor =
  typeof Database === "function" ? Database : (Database as any)?.default;

describe("WAL Checkpoint & Active Turn Detection", () => {
  let tempDir: string;
  let buffer: SessionContinuityBuffer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-resume-test-"));
    dbStore.clear();
    buffer = new SessionContinuityBuffer();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("checkpointStateDatabases", () => {
    it("executes PRAGMA wal_checkpoint(PASSIVE) on existing SQLite database", async () => {
      const dbPath = path.join(tempDir, "state.vscdb");
      const db = new DatabaseConstructor(dbPath);
      db.pragma("journal_mode = WAL");
      db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
      db.exec("INSERT INTO ItemTable VALUES ('k1', 'v1');");
      db.close();

      const result = await checkpointStateDatabases("ide", {
        dbPaths: [dbPath],
        timeoutMs: 1000,
      });

      expect(result.attempted).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.details[0].success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("skips non-existent paths gracefully without errors", async () => {
      const missingPath = path.join(tempDir, "non_existent.vscdb");
      const result = await checkpointStateDatabases("app", {
        dbPaths: [missingPath],
      });

      expect(result.attempted).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("isolates database errors and preserves crash immunity", async () => {
      const corruptPath = path.join(tempDir, "corrupted.vscdb");
      fs.writeFileSync(corruptPath, "NOT A VALID SQLITE DATABASE HEADER");

      const result = await checkpointStateDatabases("ide", {
        dbPaths: [corruptPath],
      });

      expect(result.attempted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.details[0].success).toBe(false);
      expect(result.details[0].error).toBeDefined();
    });
  });

  describe("activeTurnDetector", () => {
    it("identifies CLI targets correctly and returns null immediately", async () => {
      expect(isCliTarget("cli")).toBe(true);
      expect(isCliTarget("agy" as any)).toBe(true);
      expect(isCliTarget("ide")).toBe(false);
      expect(isCliTarget("app")).toBe(false);

      const cliResult = await detectActiveTurn("cli");
      expect(cliResult).toBeNull();

      const agyResult = await detectActiveTurn("agy" as any);
      expect(agyResult).toBeNull();
    });

    it("detects active turn (status = 2) in SQLite dedicated turns/steps table", async () => {
      const dbPath = path.join(tempDir, "turns.vscdb");
      const db = new DatabaseConstructor(dbPath);
      db.exec(`
        CREATE TABLE steps (
          id TEXT PRIMARY KEY,
          cascade_id TEXT,
          prompt TEXT,
          status INTEGER,
          model TEXT
        );
      `);

      db.exec(`
        INSERT INTO steps (id, cascade_id, prompt, status, model)
        VALUES ('step-1', 'cascade-db-101', 'Optimize database indexing', 2, 'gemini-1.5-pro');
      `);
      db.close();

      const detected = await detectActiveTurnInDatabase(dbPath);
      expect(detected).not.toBeNull();
      expect(detected?.cascadeId).toBe("cascade-db-101");
      expect(detected?.promptPayload.prompt).toBe("Optimize database indexing");
      expect(detected?.promptPayload.requestedModel).toBe("gemini-1.5-pro");
    });

    it("detects active turn with JSON status: 2 in ItemTable", async () => {
      const dbPath = path.join(tempDir, "itemtable.vscdb");
      const db = new DatabaseConstructor(dbPath);
      db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);`);

      const activePayload = JSON.stringify({
        cascadeId: "cascade-itemtable-99",
        prompt: "Refactor error handling pipeline",
        status: 2,
        model: "claude-3-5-sonnet",
      });

      db.prepare(`INSERT INTO ItemTable VALUES (?, ?)`).run(
        "antigravity.activeTurn",
        activePayload,
      );
      db.close();

      const detected = await detectActiveTurnInDatabase(dbPath);
      expect(detected).not.toBeNull();
      expect(detected?.cascadeId).toBe("cascade-itemtable-99");
      expect(detected?.promptPayload.prompt).toBe(
        "Refactor error handling pipeline",
      );
      expect(detected?.promptPayload.requestedModel).toBe("claude-3-5-sonnet");
    });

    it("prefers in-memory registered active prompts when available", async () => {
      buffer.registerActivePrompt("ide", {
        cascadeId: "cascade-in-memory-1",
        promptPayload: {
          prompt: "In memory prompt takes precedence",
          requestedModel: "gemini-1.5-pro",
        },
      });

      const detected = await detectActiveTurn("ide", { buffer });
      expect(detected).not.toBeNull();
      expect(detected?.cascadeId).toBe("cascade-in-memory-1");
      expect(detected?.promptPayload.prompt).toBe(
        "In memory prompt takes precedence",
      );
    });

    it("returns null when no active turn exists in database", async () => {
      const dbPath = path.join(tempDir, "empty.vscdb");
      const db = new DatabaseConstructor(dbPath);
      db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);`);
      db.prepare(`INSERT INTO ItemTable VALUES (?, ?)`).run(
        "antigravity.inactiveTurn",
        JSON.stringify({ status: 3, prompt: "Done" }),
      );
      db.close();

      const detected = await detectActiveTurnInDatabase(dbPath);
      expect(detected).toBeNull();
    });
  });
});
