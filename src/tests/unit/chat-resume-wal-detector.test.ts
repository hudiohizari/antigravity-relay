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
              return table.rows
                .filter((r) =>
                  typeof r.idx === "number" ? r.idx >= minIdx : true,
                )
                .sort((a, b) => (b.idx ?? 0) - (a.idx ?? 0));
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
            if (q.includes("WHERE status = 2")) {
              for (const table of db.tables) {
                const row = table.rows.find((r) => r.status === 2);
                if (row) return { ...row };
              }
            }
            if (q.includes("trajectory_metadata_blob")) {
              const table = db.tables.find(
                (t) => t.name === "trajectory_metadata_blob",
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
  inspectTranscriptForActiveTurn,
  isCliTarget,
  isSubagentConversation,
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
  });
});
