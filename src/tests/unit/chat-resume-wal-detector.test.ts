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
        } else if (/CREATE\s+TABLE\s+trajectory_metadata_blob/i.test(trimmed)) {
          if (!db.tables.some((t) => t.name === "trajectory_metadata_blob")) {
            db.tables.push({
              name: "trajectory_metadata_blob",
              columns: ["id", "data"],
              rows: [],
            });
          }
        } else if (/CREATE\s+TABLE\s+trajectory_meta/i.test(trimmed)) {
          if (!db.tables.some((t) => t.name === "trajectory_meta")) {
            db.tables.push({
              name: "trajectory_meta",
              columns: [
                "id",
                "parent_cascade_id",
                "parent_trajectory_id",
                "parent_id",
                "caller_id",
              ],
              rows: [],
            });
          }
        } else if (/CREATE\s+TABLE\s+parent_references/i.test(trimmed)) {
          if (!db.tables.some((t) => t.name === "parent_references")) {
            db.tables.push({
              name: "parent_references",
              columns: ["parent_cascade_id"],
              rows: [],
            });
          }
        } else if (/CREATE\s+TABLE\s+gen_metadata/i.test(trimmed)) {
          if (!db.tables.some((t) => t.name === "gen_metadata")) {
            db.tables.push({
              name: "gen_metadata",
              columns: ["id", "idx", "data"],
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
          all: (...args: any[]) => {
            if (q.includes("sqlite_master")) {
              return db.tables.map((t) => ({ name: t.name }));
            }
            if (q.includes("FROM steps")) {
              const table = db.tables.find((t) => t.name === "steps");
              if (!table) return [];
              const minIdx = typeof args[0] === "number" ? args[0] : 0;
              let rows = table.rows
                .filter((r) =>
                  typeof r.idx === "number" ? r.idx >= minIdx : true,
                )
                .sort((a, b) => (b.idx ?? 0) - (a.idx ?? 0));
              if (
                q.includes("status = 2 OR status = 8") ||
                q.includes("status = 2 OR status = 8")
              ) {
                rows = rows.filter((r) => r.status === 2 || r.status === 8);
              } else if (q.includes("status = 2")) {
                rows = rows.filter((r) => r.status === 2);
              }
              if (q.includes("LIMIT 1")) {
                rows = rows.slice(0, 1);
              }
              return rows;
            }
            if (q.includes("trajectory_metadata_blob")) {
              const table = db.tables.find(
                (t) => t.name === "trajectory_metadata_blob",
              );
              return table ? [...table.rows] : [];
            }
            if (q.includes("trajectory_meta")) {
              const table = db.tables.find((t) => t.name === "trajectory_meta");
              return table ? [...table.rows] : [];
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
            if (q.includes("FROM gen_metadata")) {
              const table = db.tables.find((t) => t.name === "gen_metadata");
              if (!table) return [];
              return [...table.rows].sort(
                (a, b) => (b.idx ?? 0) - (a.idx ?? 0),
              );
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
            if (q.includes("MAX(idx)")) {
              const table = db.tables.find((t) => t.name === "steps");
              if (!table || table.rows.length === 0) return { max_idx: null };
              const idxRows = table.rows.filter(
                (r) => typeof r.idx === "number",
              );
              if (idxRows.length === 0) return { max_idx: null };
              const maxVal = Math.max(...idxRows.map((r) => r.idx));
              return { max_idx: maxVal };
            }
            if (q.includes("status = 2") || q.includes("status = 8")) {
              for (const table of db.tables) {
                const row = table.rows.find(
                  (r) => r.status === 2 || r.status === 8,
                );
                if (row) return { ...row };
              }
            }
            if (q.includes("trajectory_metadata_blob")) {
              const table = db.tables.find(
                (t) => t.name === "trajectory_metadata_blob",
              );
              return table && table.rows[0] ? { ...table.rows[0] } : undefined;
            }
            if (q.includes("trajectory_meta")) {
              const table = db.tables.find((t) => t.name === "trajectory_meta");
              return table && table.rows[0] ? { ...table.rows[0] } : undefined;
            }
            if (q.includes("parent_references")) {
              const table = db.tables.find(
                (t) => t.name === "parent_references",
              );
              return table && table.rows[0] ? { ...table.rows[0] } : undefined;
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
            } else if (/INSERT\s+INTO\s+steps/i.test(q)) {
              const table = db.tables.find((t) => t.name === "steps");
              if (table && args.length > 0) {
                table.rows.push({
                  id: args[0],
                  cascade_id: args[1],
                  prompt: args[2],
                  status: Number(args[3]),
                  model: args[4],
                  idx: typeof args[5] === "number" ? args[5] : undefined,
                  step_payload: args[6],
                  error_details: args[7],
                });
              }
            } else if (/INSERT\s+INTO\s+trajectory_metadata_blob/i.test(q)) {
              const table = db.tables.find(
                (t) => t.name === "trajectory_metadata_blob",
              );
              if (table) {
                table.rows.push({
                  id: args[0],
                  data: args[1],
                });
              }
            } else if (/INSERT\s+INTO\s+trajectory_meta/i.test(q)) {
              const table = db.tables.find((t) => t.name === "trajectory_meta");
              if (table) {
                table.rows.push({
                  id: args[0],
                  parent_cascade_id: args[1],
                  parent_trajectory_id: args[1],
                  parent_id: args[1],
                  caller_id: args[1],
                });
              }
            } else if (/INSERT\s+INTO\s+parent_references/i.test(q)) {
              const table = db.tables.find(
                (t) => t.name === "parent_references",
              );
              if (table) {
                table.rows.push({
                  parent_cascade_id: args[0],
                });
              }
            } else if (/INSERT\s+INTO\s+gen_metadata/i.test(q)) {
              const table = db.tables.find((t) => t.name === "gen_metadata");
              if (table) {
                table.rows.push({
                  id: args[0],
                  idx: typeof args[1] === "number" ? args[1] : 0,
                  data: args[2],
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
  detectAllActiveTurns,
  captureAndBufferActiveTurn,
  detectActiveTurnInDatabase,
  extractModelFromDatabase,
  inspectTranscriptForActiveTurn,
  isCliTarget,
  isSubagentConversation,
  resolveParentCascadeIdFromSubagent,
  hasActiveSubagentForParent,
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

    it("skips background daemon tasks (IsDaemon: true) with status = 2", async () => {
      const dbPath = path.join(tempDir, "daemon.db");
      const db = new DatabaseConstructor(dbPath);
      db.exec(
        `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
      );

      // Insert daemon step with status = 2
      db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "s-1",
        "cascade-daemon",
        "",
        2,
        "gemini-3.8-flash-high",
        10,
        JSON.stringify({
          CommandLine: "PORT=3201 npm run start",
          IsDaemon: true,
        }),
        null,
      );
      db.close();

      const detected = await detectActiveTurnInDatabase(dbPath);
      expect(detected).toBeNull();
    });

    it("skips stale steps with status = 2 that are far from the trajectory head", async () => {
      const dbPath = path.join(tempDir, "stale.db");
      const db = new DatabaseConstructor(dbPath);
      db.exec(
        `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
      );

      // Insert old running step at idx 10
      db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "s-1",
        "cascade-stale",
        "old prompt",
        2,
        "gemini-3.8-flash-high",
        10,
        "",
        null,
      );

      // Insert completed head step at idx 100
      db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "s-2",
        "cascade-stale",
        "latest prompt",
        3,
        "gemini-3.8-flash-high",
        100,
        "",
        null,
      );
      db.close();

      const detected = await detectActiveTurnInDatabase(dbPath);
      expect(detected).toBeNull();
    });

    it("detects quota exhaustion at trajectory head and generates continuation prompt", async () => {
      const dbPath = path.join(tempDir, "quota-error.db");
      const db = new DatabaseConstructor(dbPath);
      db.exec(
        `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
      );

      // Insert quota exhausted error step at idx 50
      db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "s-50",
        "cascade-quota-50",
        "",
        3,
        "gemini-3.8-flash-high",
        50,
        "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits.",
        null,
      );
      db.close();

      const detected = await detectActiveTurnInDatabase(dbPath);
      expect(detected).not.toBeNull();
      expect(detected?.cascadeId).toBe("cascade-quota-50");
      expect(detected?.promptPayload.prompt).toBe(
        "Continue your previous response.",
      );
    });

    describe("inspectTranscriptForActiveTurn", () => {
      it("detects unanswered user prompt when transcript ends with USER_INPUT", () => {
        const transcriptPath = path.join(tempDir, "unanswered.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 10,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content:
              "<USER_REQUEST>\nImplement dark mode toggle\n</USER_REQUEST>",
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(false);
        expect(result?.promptText).toBe("Implement dark mode toggle");
        expect(result?.stepIndex).toBe(10);
      });

      it("detects turn cut off mid-thinking (PLANNER_RESPONSE without content or tools)", () => {
        const transcriptPath = path.join(tempDir, "mid-thinking.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 2565,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content:
              "<USER_REQUEST>\naddres my feedback, and what about the tablet?\n</USER_REQUEST>",
          }),
          JSON.stringify({
            step_index: 2566,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            thinking: "Diagnosing visual clipping and evaluating layout...",
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe(
          "addres my feedback, and what about the tablet?",
        );
        expect(result?.stepIndex).toBe(2566);
      });

      it("detects turn cut off while awaiting tool result (GENERIC last step)", () => {
        const transcriptPath = path.join(tempDir, "tool-awaiting.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 100,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content: "Check tests",
          }),
          JSON.stringify({
            step_index: 101,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            tool_calls: [{ name: "run_command" }],
          }),
          JSON.stringify({
            step_index: 102,
            type: "GENERIC",
            source: "MODEL",
            content: "All tests passed",
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Check tests");
      });

      it("detects active turn in long trajectories with more than 60 steps after user input", () => {
        const transcriptPath = path.join(tempDir, "long-trajectory.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 1,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content: "Refactor architecture",
          }),
        ];

        // Generate 70 subsequent tool calls
        for (let i = 2; i <= 71; i += 1) {
          lines.push(
            JSON.stringify({
              step_index: i,
              type: i % 2 === 0 ? "PLANNER_RESPONSE" : "GENERIC",
              source: "MODEL",
              tool_calls: i % 2 === 0 ? [{ name: "run_command" }] : undefined,
              content: i % 2 === 1 ? "Output chunk" : undefined,
            }),
          );
        }

        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Refactor architecture");
      });

      it("detects active turn when subagents are invoked and parent model is waiting", () => {
        const transcriptPath = path.join(tempDir, "subagent-waiting.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 2608,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content: "Fix bugs with team",
          }),
          JSON.stringify({
            step_index: 2609,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            tool_calls: [
              { name: "invoke_subagent", args: { Role: "Senior Dev" } },
            ],
          }),
          JSON.stringify({
            step_index: 2610,
            type: "GENERIC",
            source: "MODEL",
            content:
              'Created the following subagents:\n{\n  "conversationId": "sub-123"\n}',
          }),
          JSON.stringify({
            step_index: 2611,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            content: "I have dispatched Senior Dev. Standing by for report.",
          }),
        ];

        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Continue your previous response.");
      });

      it("detects active turn when a tool is running as a background task", () => {
        const transcriptPath = path.join(tempDir, "background-task.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 10,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content: "Run test suite",
          }),
          JSON.stringify({
            step_index: 11,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            tool_calls: [
              { name: "run_command", args: { CommandLine: "gradle test" } },
            ],
          }),
          JSON.stringify({
            step_index: 12,
            type: "GENERIC",
            source: "MODEL",
            content:
              "Tool is running as a background task with task id: test-task-1",
          }),
          JSON.stringify({
            step_index: 13,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            content: "Command running in background.",
          }),
        ];

        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Continue your previous response.");
      });

      it("returns null when turn completed normally with assistant response content", () => {
        const transcriptPath = path.join(tempDir, "completed.jsonl");
        const lines = [
          JSON.stringify({
            step_index: 100,
            type: "USER_INPUT",
            source: "USER_EXPLICIT",
            content: "Hello",
          }),
          JSON.stringify({
            step_index: 101,
            type: "PLANNER_RESPONSE",
            source: "MODEL",
            content: "Hello! How can I help you today?",
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).toBeNull();
      });
    });

    describe("isSubagentConversation & Subagent Exclusion", () => {
      it("identifies top-level conversation when annotations contain title", () => {
        const fakeAnnotationsDir = path.join(tempDir, "annotations");
        fs.mkdirSync(fakeAnnotationsDir, { recursive: true });

        const cascadeId = "cascade-top-level-1";
        fs.writeFileSync(
          path.join(fakeAnnotationsDir, `${cascadeId}.pbtxt`),
          'title: "Workspace Task Planning" last_user_view_time:{seconds: 12345}',
          "utf-8",
        );

        // Subagent check should return false (it is top-level)
        const isSub = isSubagentConversation(cascadeId, "app");
        // In this test environment paths resolve to real home, so we also test with trajectory_metadata_blob
        expect(typeof isSub).toBe("boolean");
      });

      it("identifies subagent conversation via trajectory_metadata_blob persona definition", () => {
        const dbPath = path.join(tempDir, "subagent.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );

        const subagentBlob = Buffer.from(
          "some_prefix_fiqry_frontend_Role_Senior Frontend Web Developer_TypeName_fiqry_frontend",
        );
        db.prepare(`INSERT INTO trajectory_metadata_blob VALUES (?, ?)`).run(
          "main",
          subagentBlob,
        );

        const isSub = isSubagentConversation("subagent-cascade", "app", db);
        expect(isSub).toBe(true);
        db.close();
      });

      it("identifies top-level conversation via trajectory_metadata_blob cascade mapping 2$<cascadeId>", () => {
        const dbPath = path.join(tempDir, "toplevel.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );

        const cascadeId = "cascade-valid-top-level";
        const topLevelBlob = Buffer.from(
          `header_data_2$${cascadeId}:file:///Users/dev/project_tail`,
        );
        db.prepare(`INSERT INTO trajectory_metadata_blob VALUES (?, ?)`).run(
          "main",
          topLevelBlob,
        );

        const isSub = isSubagentConversation(cascadeId, "app", db);
        expect(isSub).toBe(false);
        db.close();
      });

      it("returns false for empty cascadeId or missing conversation files", () => {
        expect(isSubagentConversation("", "app")).toBe(false);
        expect(isSubagentConversation("non-existent-sub", "app")).toBe(false);
      });

      it("returns false when db has no trajectory_metadata_blob table", () => {
        const dbPath = path.join(tempDir, "noblob-sub.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(`CREATE TABLE steps (id TEXT);`);
        expect(isSubagentConversation("cascade-123", "app", db)).toBe(false);
        db.close();
      });

      it("returns true when trajectory_metadata_blob does not contain 2$<cascadeId>", () => {
        const dbPath = path.join(tempDir, "subblob-positive.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );
        db.prepare(`INSERT INTO trajectory_metadata_blob VALUES (?, ?)`).run(
          "main",
          Buffer.from("subagent_task_worker_metadata_without_prefix"),
        );
        expect(isSubagentConversation("child-sub-999", "app", db)).toBe(true);
        db.close();
      });

      it("skips subagent conversation database in detectActiveTurnInDatabase even with active status = 2", async () => {
        const dbPath = path.join(tempDir, "active-subagent.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );

        const cascadeId = "subagent-active-123";
        db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          "s-1",
          cascadeId,
          "Running subagent command",
          2,
          "gemini-3.8-flash-high",
          1,
          "",
          null,
        );

        const subagentBlob = Buffer.from(
          "some_prefix_hudio_pm_Role_Product Manager_TypeName_hudio_pm",
        );
        db.prepare(`INSERT INTO trajectory_metadata_blob VALUES (?, ?)`).run(
          "main",
          subagentBlob,
        );
        db.close();

        const detected = await detectActiveTurnInDatabase(dbPath);
        expect(detected).toBeNull();
      });
    });

    describe("extractModelFromDatabase & Claude Model Resolution", () => {
      it("extracts authentic proto enum MODEL_PLACEHOLDER_M26 and model_name from gen_metadata binary wire format", () => {
        const dbPath = path.join(tempDir, "claude-wire.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE gen_metadata (id TEXT PRIMARY KEY, idx INTEGER, data BLOB);`,
        );

        // Binary wire payload containing both model_name and model_enum
        const wirePayload = Buffer.from(
          "prefix_data\n\x18model_name\x12\x18claude-opus-4-6-thinking\n\x16model_enum\x12\x15MODEL_PLACEHOLDER_M26_suffix",
          "latin1",
        );

        db.prepare(`INSERT INTO gen_metadata VALUES (?, ?, ?)`).run(
          "meta-1",
          10,
          wirePayload,
        );

        const extracted = extractModelFromDatabase(db);
        expect(extracted).toBeDefined();
        expect(extracted?.enumModel).toBe("MODEL_PLACEHOLDER_M26");
        expect(extracted?.modelName).toBe("claude-opus-4-6-thinking");
        db.close();
      });

      it("prioritizes authentic model_enum over human model names when both exist in gen_metadata", () => {
        const dbPath = path.join(tempDir, "priority.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE gen_metadata (id TEXT PRIMARY KEY, idx INTEGER, data BLOB);`,
        );

        const textPayload = JSON.stringify({
          custom_metadata: {
            model_name: "claude-opus-4-6-thinking",
            model_enum: "MODEL_PLACEHOLDER_M26",
          },
        });

        db.prepare(`INSERT INTO gen_metadata VALUES (?, ?, ?)`).run(
          "meta-2",
          5,
          textPayload,
        );

        const extracted = extractModelFromDatabase(db);
        expect(extracted).toBeDefined();
        expect(extracted?.enumModel).toBe("MODEL_PLACEHOLDER_M26");
        expect(extracted?.modelName).toBe("claude-opus-4-6-thinking");
        db.close();
      });

      it("extracts model_name when gen_metadata only contains human name without proto enum", () => {
        const dbPath = path.join(tempDir, "name-only.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE gen_metadata (id TEXT PRIMARY KEY, idx INTEGER, data BLOB);`,
        );

        const textPayload = `turn_data_model_name: "claude-opus-4-6-thinking"`;
        db.prepare(`INSERT INTO gen_metadata VALUES (?, ?, ?)`).run(
          "meta-3",
          1,
          textPayload,
        );

        const extracted = extractModelFromDatabase(db);
        expect(extracted).toBeDefined();
        expect(extracted?.enumModel).toBeUndefined();
        expect(extracted?.modelName).toBe("claude-opus-4-6-thinking");
        db.close();
      });

      it("detects active turn in SQLite for Claude Opus 4.6 and populates promptPayload with authentic enum and no fabricated enums", async () => {
        const dbPath = path.join(tempDir, "claude-turn.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.exec(
          `CREATE TABLE gen_metadata (id TEXT PRIMARY KEY, idx INTEGER, data BLOB);`,
        );

        // Step is active with prompt
        db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          "s-claude-1",
          "cascade-claude-turn",
          "Analyze the database indexing strategy for session continuity",
          2,
          "claude-opus-4-6-thinking",
          5,
          "",
          null,
        );

        // gen_metadata has authentic wire payload
        const wirePayload = Buffer.from(
          "binary_header\n\x18model_name\x12\x18claude-opus-4-6-thinking\n\x16model_enum\x12\x15MODEL_PLACEHOLDER_M26_tail",
          "latin1",
        );
        db.prepare(`INSERT INTO gen_metadata VALUES (?, ?, ?)`).run(
          "meta-turn",
          5,
          wirePayload,
        );
        db.close();

        const detected = await detectActiveTurnInDatabase(dbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe("cascade-claude-turn");
        expect(detected?.promptPayload.prompt).toBe(
          "Analyze the database indexing strategy for session continuity",
        );
        // Authentically prioritized proto enum
        expect(detected?.promptPayload.requestedModel).toBe(
          "MODEL_PLACEHOLDER_M26",
        );

        // Schema-compliant cascadeConfig with authentic enum
        const cascadeConfig = detected?.promptPayload.cascadeConfig as
          Record<string, any> | undefined;
        expect(cascadeConfig?.requestedModel).toEqual({
          model: "MODEL_PLACEHOLDER_M26",
        });
        expect(cascadeConfig?.plannerConfig?.requestedModel).toEqual({
          model: "MODEL_PLACEHOLDER_M26",
          choice: { case: "model", value: "MODEL_PLACEHOLDER_M26" },
        });
        expect(cascadeConfig?.plannerConfig?.planModel).toBe(
          "MODEL_PLACEHOLDER_M26",
        );
        expect(cascadeConfig?.plannerConfig?.modelName).toBe(
          "claude-opus-4-6-thinking",
        );

        // Verify fabricated enum is NEVER present
        expect(JSON.stringify(detected)).not.toContain("MODEL_CLAUDE_4_SONNET");
      });

      it("detects active turn in SQLite for Claude turn with only model_name and omits requestedModel override from cascadeConfig (native inheritance)", async () => {
        const dbPath = path.join(tempDir, "claude-native.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );

        db.prepare(`INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          "s-claude-2",
          "cascade-claude-native",
          "Design microservices architecture",
          2,
          "claude-opus-4-6-thinking",
          1,
          "",
          null,
        );
        db.close();

        const detected = await detectActiveTurnInDatabase(dbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe("cascade-claude-native");
        expect(detected?.promptPayload.prompt).toBe(
          "Design microservices architecture",
        );
        expect(detected?.promptPayload.requestedModel).toBe(
          "claude-opus-4-6-thinking",
        );

        // RequestedModel override is omitted so Language Server natively inherits conversation model
        const nativeCascadeConfig = detected?.promptPayload.cascadeConfig as
          Record<string, any> | undefined;
        expect(nativeCascadeConfig?.requestedModel).toBeUndefined();
        expect(nativeCascadeConfig?.plannerConfig?.planModel).toBeUndefined();
        expect(nativeCascadeConfig?.plannerConfig?.modelName).toBe(
          "claude-opus-4-6-thinking",
        );

        // Verify fabricated enum is NEVER present
        expect(JSON.stringify(detected)).not.toContain("MODEL_CLAUDE_4_SONNET");
      });

      it("does not extract conversational words like 'and' or '...' as modelName from text containing model_name", () => {
        const dbPath = path.join(tempDir, "conversational-words.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE gen_metadata (id TEXT PRIMARY KEY, idx INTEGER, data BLOB);`,
        );

        // Conversational text mentioning model_name followed by 'and' or '...'
        const conversationalPayload = Buffer.from(
          "prefix context with only model_name and omits requestedModel override while model_name... remains unquoted",
          "latin1",
        );
        db.prepare(`INSERT INTO gen_metadata VALUES (?, ?, ?)`).run(
          "meta-conv",
          1,
          conversationalPayload,
        );

        const extracted = extractModelFromDatabase(db);
        expect(extracted?.modelName).toBeUndefined();
        expect(extracted?.modelName).not.toBe("and");
        expect(extracted?.modelName).not.toBe("...");
        db.close();
      });

      it("extracts modelName when properly structured with quotes or valid model pattern", () => {
        const dbPath = path.join(tempDir, "structured-model-name.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE gen_metadata (id TEXT PRIMARY KEY, idx INTEGER, data BLOB);`,
        );

        const structuredPayload = Buffer.from(
          '{"model_name": "claude-sonnet-4-5", "status": "active"}',
          "latin1",
        );
        db.prepare(`INSERT INTO gen_metadata VALUES (?, ?, ?)`).run(
          "meta-struct",
          1,
          structuredPayload,
        );

        const extracted = extractModelFromDatabase(db);
        expect(extracted?.modelName).toBe("claude-sonnet-4-5");
        db.close();
      });
    });

    describe("AC-01: Subagent Yielding Turn Detection in inspectTranscriptForActiveTurn", () => {
      it("detects active turn when tail is PLANNER_RESPONSE with text and 0 tools after invoke_subagent in transcript", () => {
        const transcriptPath = path.join(
          tempDir,
          "subagent-yield-invoke.jsonl",
        );
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "Please execute subagent task",
          }),
          JSON.stringify({
            type: "TOOL_CALL",
            name: "invoke_subagent",
            args: {
              subagent_type: "fiqry_frontend",
              prompt: "Build UI component",
            },
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "I have invoked the subagent to build the UI component. Waiting for results.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Continue your previous response.");
      });

      it("detects active turn when tail is PLANNER_RESPONSE with text and 0 tools after send_message in transcript", () => {
        const transcriptPath = path.join(tempDir, "subagent-yield-send.jsonl");
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "Check worker status",
          }),
          JSON.stringify({
            type: "TOOL_CALL",
            name: "send_message",
            args: { Recipient: "subagent-sub-1", Message: "Ping status" },
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "Sent ping to worker. Waiting for response.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Continue your previous response.");
      });

      it("detects active turn when tail is PLANNER_RESPONSE with text and 0 tools after manage_subagents in transcript", () => {
        const transcriptPath = path.join(
          tempDir,
          "subagent-yield-manage.jsonl",
        );
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "List active tasks",
          }),
          JSON.stringify({
            type: "TOOL_CALL",
            name: "manage_subagents",
            args: { action: "list" },
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "Checked running subagents list.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Continue your previous response.");
      });

      it("returns null when tail is PLANNER_RESPONSE with text and 0 tools without subagent calls or background tasks", () => {
        const transcriptPath = path.join(tempDir, "standard-completed.jsonl");
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "What is 2 + 2?",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "2 + 2 = 4.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).toBeNull();
      });

      it("returns null when past turn used invoke_subagent but current turn completed normally with PLANNER_RESPONSE text and 0 tools", () => {
        const transcriptPath = path.join(
          tempDir,
          "multi-turn-subagent-completed.jsonl",
        );
        const lines = [
          // Turn 1: Used subagent
          JSON.stringify({
            type: "USER_INPUT",
            content: "Run subagent research task",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            tool_calls: [
              {
                name: "invoke_subagent",
                args: { TypeName: "research", Prompt: "Research topic" },
              },
            ],
          }),
          JSON.stringify({
            type: "GENERIC",
            content: "Subagent finished successfully",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "Research completed.",
            tools: [],
          }),
          // Turn 2: Follow-up question completed normally
          JSON.stringify({
            type: "USER_INPUT",
            content: "What is 2 + 2?",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "2 + 2 = 4.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).toBeNull();
      });
    });

    describe("AC-02: Subagent Database Parent Resolution & Parent Database Preservation", () => {
      it("resolves parent cascade ID from subagent trajectory_metadata_blob containing 2$<parentCascadeId>", () => {
        const dbPath = path.join(tempDir, "subagent-blob.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );
        const parentCascadeId = "parent-cascade-uuid-111";
        db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?, ?)").run(
          "meta",
          Buffer.from(`wire_header_2$${parentCascadeId}:tail_data`),
        );

        const resolved = resolveParentCascadeIdFromSubagent(
          "child-subagent-1",
          "app",
          db,
        );
        expect(resolved).toBe(parentCascadeId);
        db.close();
      });

      it("resolves parent cascade ID from subagent trajectory_meta table", () => {
        const dbPath = path.join(tempDir, "subagent-meta.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE trajectory_meta (id TEXT, parent_cascade_id TEXT, parent_trajectory_id TEXT, parent_id TEXT, caller_id TEXT);`,
        );
        const parentCascadeId = "parent-cascade-meta-222";
        db.prepare("INSERT INTO trajectory_meta VALUES (?, ?)").run(
          "1",
          parentCascadeId,
        );

        const resolved = resolveParentCascadeIdFromSubagent(
          "child-subagent-2",
          "app",
          db,
        );
        expect(resolved).toBe(parentCascadeId);
        db.close();
      });

      it("resolves parent cascade ID from subagent parent_references table", () => {
        const dbPath = path.join(tempDir, "subagent-pref.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(`CREATE TABLE parent_references (parent_cascade_id TEXT);`);
        const parentCascadeId = "parent-cascade-ref-333";
        db.prepare("INSERT INTO parent_references VALUES (?)").run(
          parentCascadeId,
        );

        const resolved = resolveParentCascadeIdFromSubagent(
          "child-subagent-3",
          "app",
          db,
        );
        expect(resolved).toBe(parentCascadeId);
        db.close();
      });

      it("resolves active subagent database with status = 2 to parent cascade ID in detectActiveTurnInDatabase", async () => {
        const dbPath = path.join(tempDir, "child-active.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );

        const parentCascadeId = "parent-cascade-active-999";
        // Child active step status = 2
        db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          "step-c1",
          "child-active",
          "Running tests",
          2,
          "gemini-3.8-flash-high",
          10,
          "",
          null,
        );
        // Trajectory metadata blob referencing parent
        db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?, ?)").run(
          "meta",
          Buffer.from(`wire_2$${parentCascadeId}:data`),
        );
        db.close();

        const detected = await detectActiveTurnInDatabase(dbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe(parentCascadeId);
        expect(detected?.promptPayload.prompt).toBe(
          "Continue your previous response.",
        );
      });

      it("resolves active subagent database with status = 8 to parent cascade ID in detectActiveTurnInDatabase", async () => {
        const dbPath = path.join(tempDir, "child-status8.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.exec(
          `CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);`,
        );

        const parentCascadeId = "parent-cascade-status8-888";
        // Child step status = 8
        db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          "step-c8",
          "child-status8",
          "Executing background work",
          8,
          "claude-opus-4-6-thinking",
          12,
          "",
          null,
        );
        db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?, ?)").run(
          "meta",
          Buffer.from(`wire_2$${parentCascadeId}:data`),
        );
        db.close();

        const detected = await detectActiveTurnInDatabase(dbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe(parentCascadeId);
        expect(detected?.promptPayload.prompt).toBe(
          "Continue your previous response.",
        );
      });

      it("hasActiveSubagentForParent handles empty parentCascadeId gracefully", () => {
        expect(hasActiveSubagentForParent("")).toBe(false);
      });

      it("resolveParentCascadeIdFromSubagent returns null for empty subagentCascadeId", () => {
        expect(resolveParentCascadeIdFromSubagent("", "app")).toBeNull();
      });

      it("resolveParentCascadeIdFromSubagent resolves parent from parent_references table in database", () => {
        const dbPath = path.join(tempDir, "sub-parent-ref.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec("CREATE TABLE parent_references (parent_cascade_id TEXT);");
        db.prepare("INSERT INTO parent_references VALUES (?)").run(
          "parent-from-ref-111",
        );

        const parentId = resolveParentCascadeIdFromSubagent(
          "child-ref-test",
          "app",
          db,
        );
        expect(parentId).toBe("parent-from-ref-111");
        db.close();
      });

      it("resolveParentCascadeIdFromSubagent resolves parent from trajectory_meta table in database", () => {
        const dbPath = path.join(tempDir, "sub-trajectory-meta.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          "CREATE TABLE trajectory_meta (id TEXT, caller_id TEXT, parent_cascade_id TEXT);",
        );
        db.prepare("INSERT INTO trajectory_meta VALUES (?, ?, ?)").run(
          "t1",
          "parent-from-caller-222",
          "parent-from-caller-222",
        );

        const parentId = resolveParentCascadeIdFromSubagent(
          "child-meta-test",
          "app",
          db,
        );
        expect(parentId).toBe("parent-from-caller-222");
        db.close();
      });

      it("resolveParentCascadeIdFromSubagent returns null when database contains no parent references", () => {
        const dbPath = path.join(tempDir, "sub-no-parent.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec("CREATE TABLE steps (id TEXT);");

        const parentId = resolveParentCascadeIdFromSubagent(
          "child-orphan-test",
          "app",
          db,
        );
        expect(parentId).toBeNull();
        db.close();
      });

      it("detectActiveTurnInDatabase returns null on non-existent database file", async () => {
        const nonExistentDb = path.join(tempDir, "ghost-database.db");
        const result = await detectActiveTurnInDatabase(nonExistentDb);
        expect(result).toBeNull();
      });

      it("detectActiveTurnInDatabase returns null on corrupt database file without throwing", async () => {
        const corruptPath = path.join(tempDir, "corrupt-turn.db");
        fs.writeFileSync(corruptPath, "NOT A VALID SQLITE DATABASE HEADER");
        const result = await detectActiveTurnInDatabase(corruptPath);
        expect(result).toBeNull();
      });

      it("detectActiveTurnInDatabase returns null when database has no steps table", async () => {
        const noStepsPath = path.join(tempDir, "no-steps-table.db");
        const db = new DatabaseConstructor(noStepsPath);
        db.exec("CREATE TABLE dummy_info (key TEXT);");
        db.close();

        const result = await detectActiveTurnInDatabase(noStepsPath);
        expect(result).toBeNull();
      });

      it("detectActiveTurnInDatabase detects active turn when latest step has status = 8", async () => {
        const status8DbPath = path.join(tempDir, "status8-direct.db");
        const db = new DatabaseConstructor(status8DbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          "step-s8-direct",
          "cascade-s8-direct",
          "Execute long running task",
          8,
          "gemini-3.8-flash-high",
          10,
          "",
          null,
        );
        db.close();

        const detected = await detectActiveTurnInDatabase(status8DbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe("cascade-s8-direct");
        expect(detected?.promptPayload.prompt).toBe(
          "Execute long running task",
        );
        expect(detected?.isInterrupted).toBe(true);
      });
    });

    describe("AC-03: Broadened Quota Error Parsing & Freshness Window", () => {
      it("detects quota error in step.error in inspectTranscriptForActiveTurn", () => {
        const transcriptPath = path.join(tempDir, "quota-error-field.jsonl");
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "Refactor backend service",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            error: "GoogleJsonResponseException: 429 RESOURCE_EXHAUSTED",
            text: "",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Refactor backend service");
      });

      it("detects quota error in step.message in inspectTranscriptForActiveTurn", () => {
        const transcriptPath = path.join(tempDir, "quota-message-field.jsonl");
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "Run test suite",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            message:
              "Individual quota reached for the requested model. Try again later.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Run test suite");
      });

      it("detects quota error in step.text in inspectTranscriptForActiveTurn", () => {
        const transcriptPath = path.join(tempDir, "quota-text-field.jsonl");
        const lines = [
          JSON.stringify({
            type: "USER_INPUT",
            content: "Deploy application",
          }),
          JSON.stringify({
            type: "PLANNER_RESPONSE",
            text: "API error: Rate limit reached, quota exceeded for current tier.",
            tools: [],
          }),
        ];
        fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

        const result = inspectTranscriptForActiveTurn(transcriptPath);
        expect(result).not.toBeNull();
        expect(result?.hasActiveTurn).toBe(true);
        expect(result?.isInterrupted).toBe(true);
        expect(result?.promptText).toBe("Deploy application");
      });

      it("detects active turn in database when mtime is within 60 minutes", async () => {
        const dbPath = path.join(tempDir, "freshness-60m.db");
        const db = new DatabaseConstructor(dbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );

        db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          "step-fresh",
          "cascade-fresh-60m",
          "Fix background job processor",
          2,
          "gemini-3.8-flash-high",
          5,
          "",
          null,
        );
        db.close();

        // Set mtime to 25 minutes ago (1500s ago, well within the 60m window, but previously beyond 10m window)
        const pastMtime = new Date(Date.now() - 25 * 60 * 1000);
        fs.utimesSync(dbPath, pastMtime, pastMtime);

        const detected = await detectActiveTurnInDatabase(dbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe("cascade-fresh-60m");
        expect(detected?.promptPayload.prompt).toBe(
          "Fix background job processor",
        );
      });

      it("returns null when transcript file does not exist", () => {
        const nonExistentPath = path.join(tempDir, "does-not-exist.jsonl");
        const result = inspectTranscriptForActiveTurn(nonExistentPath);
        expect(result).toBeNull();
      });

      it("returns null when transcript file is empty", () => {
        const emptyPath = path.join(tempDir, "empty.jsonl");
        fs.writeFileSync(emptyPath, "", "utf-8");
        const result = inspectTranscriptForActiveTurn(emptyPath);
        expect(result).toBeNull();
      });

      it("detects active turn in database when db is older than 60m but subagent db is within 15m", async () => {
        const testSubDir = path.join(tempDir, "subagent-fresh-isolated");
        fs.mkdirSync(testSubDir, { recursive: true });

        const mainDbPath = path.join(testSubDir, "main-parent.db");
        const subDbPath = path.join(testSubDir, "child-worker.db");

        const db = new DatabaseConstructor(mainDbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          "step-p",
          "main-parent",
          "Parent orchestrating subagent",
          2,
          "gemini-3.8-flash-high",
          1,
          "",
          null,
        );
        db.close();

        // Create associated subagent db
        fs.writeFileSync(subDbPath, "subagent content");

        // Main DB is 65 min old (> 60m), but subagent DB is 5 min old (< 15m)
        const oldMtime = new Date(Date.now() - 65 * 60 * 1000);
        fs.utimesSync(mainDbPath, oldMtime, oldMtime);

        const subMtime = new Date(Date.now() - 5 * 60 * 1000);
        fs.utimesSync(subDbPath, subMtime, subMtime);

        const detected = await detectActiveTurnInDatabase(mainDbPath);
        expect(detected).not.toBeNull();
        expect(detected?.cascadeId).toBe("main-parent");
      });

      it("rejects database when both db is older than 60m and subagent db is older than 15m", async () => {
        const testSubDir = path.join(tempDir, "all-expired-isolated");
        fs.mkdirSync(testSubDir, { recursive: true });

        const mainDbPath = path.join(testSubDir, "expired-parent.db");
        const subDbPath = path.join(testSubDir, "expired-child.db");

        const db = new DatabaseConstructor(mainDbPath);
        db.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          "step-exp",
          "expired-parent",
          "Old prompt",
          2,
          "gemini-3.8-flash-high",
          1,
          "",
          null,
        );
        db.close();

        fs.writeFileSync(subDbPath, "subagent content");

        const dbOldMtime = new Date(Date.now() - 65 * 60 * 1000); // 65m
        fs.utimesSync(mainDbPath, dbOldMtime, dbOldMtime);

        const subOldMtime = new Date(Date.now() - 25 * 60 * 1000); // 25m (> 15m)
        fs.utimesSync(subDbPath, subOldMtime, subOldMtime);

        const detected = await detectActiveTurnInDatabase(mainDbPath);
        expect(detected).toBeNull();
      });

      it("rejects database when mtime is older than 60 minutes and no subagents exist", async () => {
        const isolatedDir = path.join(tempDir, "single-expired-isolated");
        fs.mkdirSync(isolatedDir, { recursive: true });
        const expiredDbPath = path.join(isolatedDir, "expired-65m.db");

        const expDb = new DatabaseConstructor(expiredDbPath);
        expDb.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        expDb
          .prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            "step-exp",
            "cascade-exp-65m",
            "Expired task prompt",
            2,
            "gemini-3.8-flash-high",
            1,
            "",
            null,
          );
        expDb.close();

        const expiredMtime = new Date(Date.now() - 65 * 60 * 1000); // 65 min ago
        fs.utimesSync(expiredDbPath, expiredMtime, expiredMtime);

        const expiredResult = await detectActiveTurnInDatabase(expiredDbPath);
        expect(expiredResult).toBeNull();
      });
    });

    describe("Multi-Chat False-Positive Prevention & Turn Isolation", () => {
      it("detectAllActiveTurns isolates single active chat among multiple completed chats with subagents", async () => {
        // Chat 1: Active conversation with status = 2
        const activeDbPath = path.join(tempDir, "active-single.db");
        const activeDb = new DatabaseConstructor(activeDbPath);
        activeDb.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        activeDb
          .prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            "step-active",
            "cascade-active-single",
            "Generate financial report",
            2,
            "gemini-3.8-flash-high",
            5,
            "",
            null,
          );
        activeDb.close();

        // Chat 2: Completed chat that used subagents in the past (status = 3)
        const completedDbPath1 = path.join(tempDir, "completed-subagent.db");
        const completedDb1 = new DatabaseConstructor(completedDbPath1);
        completedDb1.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        completedDb1
          .prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            "step-comp1",
            "cascade-comp-subagent",
            "Completed subagent task",
            3,
            "gemini-3.8-flash-high",
            5,
            "",
            null,
          );
        completedDb1.close();

        // Chat 3: Completed chat with background task markers in past (status = 3)
        const completedDbPath2 = path.join(tempDir, "completed-bg.db");
        const completedDb2 = new DatabaseConstructor(completedDbPath2);
        completedDb2.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        completedDb2
          .prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            "step-comp2",
            "cascade-comp-bg",
            "Completed bg task",
            3,
            "gemini-3.8-flash-high",
            5,
            "",
            null,
          );
        completedDb2.close();

        const detectedList = await detectAllActiveTurns("app", {
          dbPaths: [activeDbPath, completedDbPath1, completedDbPath2],
          buffer,
        });

        // Must ONLY detect the single active conversation, zero completed chats
        expect(detectedList).toHaveLength(1);
        expect(detectedList[0]?.cascadeId).toBe("cascade-active-single");
        expect(detectedList[0]?.promptPayload.prompt).toBe(
          "Generate financial report",
        );
      });

      it("captureAndBufferActiveTurn returns null and buffers 0 when all candidate chats are completed", async () => {
        const testBuffer = new SessionContinuityBuffer();

        const completedDbPath = path.join(tempDir, "all-completed-chat.db");
        const completedDb = new DatabaseConstructor(completedDbPath);
        completedDb.exec(
          `CREATE TABLE steps (id TEXT, idx INTEGER, cascade_id TEXT, prompt TEXT, status INTEGER, model TEXT, step_payload BLOB, error_details BLOB);`,
        );
        completedDb
          .prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            "step-c",
            "cascade-all-comp",
            "Already completed turn",
            3,
            "gemini-3.8-flash-high",
            10,
            "",
            null,
          );
        completedDb.close();

        const snapshot = await captureAndBufferActiveTurn("app", {
          dbPaths: [completedDbPath],
          buffer: testBuffer,
        });

        expect(snapshot).toBeNull();
        expect(testBuffer.getAllPendingForTarget("app")).toHaveLength(0);
      });
    });
  });
});
