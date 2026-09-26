import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContextTelemetryService,
  type DatabaseAccessor,
} from "@/modules/context-telemetry/services/ContextTelemetryService";

describe("ContextTelemetryService (Compaction FSM, Subagents & Caching)", () => {
  let service: ContextTelemetryService;

  beforeEach(() => {
    service = new ContextTelemetryService();
    service.resetCache();
  });

  describe("Anti-Flapping Compaction State Machine", () => {
    it("detects verified compaction when token drop exceeds -5,000 tokens", () => {
      const convId = "conv-abc-123";

      // Step 1: Initial high-token state
      service.evaluateCompaction(convId, 165_000);

      // Step 2: Severe drop to 48,000 tokens (Delta = -117,000)
      const compaction = service.evaluateCompaction(convId, 48_000);

      expect(compaction).not.toBeNull();
      expect(compaction?.conversationId).toBe(convId);
      expect(compaction?.tokenDelta).toBe(-117_000);
      expect(compaction?.previousTokens).toBe(165_000);
      expect(compaction?.currentTokens).toBe(48_000);
    });

    it("suppresses compaction alerts for minor normal fluctuations under 5,000 tokens", () => {
      const convId = "conv-abc-123";

      service.evaluateCompaction(convId, 165_000);

      // Minor drop of 3,000 tokens
      const result = service.evaluateCompaction(convId, 162_000);

      expect(result).toBeNull();
    });

    it("suppresses compaction alerts on zero-token read lock anomalies (anti-flapping guard)", () => {
      const convId = "conv-abc-123";

      service.evaluateCompaction(convId, 165_000);

      // Transient read failure returns 0 tokens
      const resultOnZero = service.evaluateCompaction(convId, 0);

      expect(resultOnZero).toBeNull();

      // Subsequent normal reading recovers without false negative delta
      const resultOnRecover = service.evaluateCompaction(convId, 166_000);
      expect(resultOnRecover).toBeNull();
    });

    it("isolates compaction state across distinct conversation IDs", () => {
      service.evaluateCompaction("conv-1", 150_000);
      service.evaluateCompaction("conv-2", 40_000);

      // conv-1 compactions do not trigger for conv-2
      const event = service.evaluateCompaction("conv-1", 30_000);
      expect(event?.conversationId).toBe("conv-1");
      expect(event?.previousTokens).toBe(150_000);
    });
  });

  describe("Subagent Hierarchy & Stat Caching", () => {
    it("handles mock database access with subagent isolation and stat caching", async () => {
      let conversationDbOpened = 0;

      const mockDbInstance = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return {
              get: () => ({ name: "gen_metadata" }),
            };
          }
          if (query.includes("FROM conversation_summaries")) {
            return {
              all: () => [
                {
                  conversation_id: "root-123",
                  title: "Root Cascade Title",
                  status: "CASCADE_RUN_STATUS_RUNNING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 0,
                  parent_conversation_id: "",
                  workspace_uris: JSON.stringify(["/Users/dev/project"]),
                  last_modified_time: "2026-09-26T10:00:00Z",
                },
                {
                  conversation_id: "subagent-456",
                  title: "Child Subagent",
                  status: "CASCADE_RUN_STATUS_RUNNING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 1,
                  parent_conversation_id: "root-123",
                  workspace_uris: "",
                  last_modified_time: "2026-09-26T10:01:00Z",
                },
              ],
            };
          }
          if (query.includes("FROM gen_metadata")) {
            return {
              all: () => {
                conversationDbOpened++;
                return [];
              },
              get: () => {
                conversationDbOpened++;
                return { data: null };
              },
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: (_path, _options) => mockDbInstance as any,
        stat: (_path) => ({ mtimeMs: 1000 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);

      // First query
      const res1 = await mockService.getActiveChatTelemetry("app");

      // Verify root isolation
      expect(res1.primaryChat?.conversationId).toBe("root-123");
      expect(res1.primaryChat?.title).toBe("Root Cascade Title");
      expect(res1.primaryChat?.status).toBe("running");
      expect(res1.primaryChat?.activeSubagents.length).toBe(1);
      expect(res1.primaryChat?.activeSubagents[0].conversationId).toBe("subagent-456");

      // Second query with unchanged stat mtimeMs
      const res2 = await mockService.getActiveChatTelemetry("app");

      expect(res2.primaryChat?.conversationId).toBe("root-123");
      // Because mtimeMs didn't change, gen_metadata was not re-queried (cached)
      expect(conversationDbOpened).toBe(2); // 1 for root + 1 for subagent on call 1; 0 on call 2!
    });

    it("recovers gracefully and returns stale telemetry on transient SQLite error", () => {
      let mtime = 500;
      let fail = false;
      const mockAccessor: DatabaseAccessor = {
        open: () => {
          if (fail) {
            throw new Error("SQLITE_BUSY: database is locked");
          }
          return {
            prepare: () => ({
              get: () => ({ name: "gen_metadata" }),
            }),
            pragma: () => {},
            close: () => {},
          } as any;
        },
        stat: () => ({ mtimeMs: mtime }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);

      // Seed cache
      mockService.getTokensForConversation("/fake/path.db", "cascade-1");

      // Now inject transient failure on file change
      fail = true;
      mtime = 600;
      const result = mockService.getTokensForConversation("/fake/path.db", "cascade-1");

      expect(result.isStale).toBe(true);
      expect(result.metrics).toBeDefined();
    });

    it("returns zero metrics and avoids DB open when stat returns null (CR-BE-03)", () => {
      let opened = false;
      const mockAccessor: DatabaseAccessor = {
        open: () => {
          opened = true;
          return {} as any;
        },
        stat: () => null,
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const result = mockService.getTokensForConversation("/non/existent.db", "not-found");

      expect(opened).toBe(false);
      expect(result.metrics.usedTokens).toBe(0);
      expect(result.isStale).toBe(false);
    });
  });

  describe("Missing Branches & Edge Cases (CR-BE-02)", () => {
    it("returns antigravity_not_detected when summaries DB path is missing or CLI target", async () => {
      const mockService = new ContextTelemetryService();
      const res = await mockService.getActiveChatTelemetry("cli");

      expect(res.runtimeState).toBe("antigravity_not_detected");
      expect(res.hasActiveChat).toBe(false);
      expect(res.pollingIntervalMs).toBe(15000);
      expect(res.primaryChat).toBeNull();
    });

    it("returns idle_no_active_chat when conversation_summaries table is missing", async () => {
      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => null }; // Table missing
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 100 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("idle_no_active_chat");
      expect(res.hasActiveChat).toBe(false);
      expect(res.pollingIntervalMs).toBe(15000);
    });

    it("returns idle_no_active_chat when active conversation rows are empty", async () => {
      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "conversation_summaries" }) };
          }
          if (query.includes("FROM conversation_summaries")) {
            return { all: () => [] }; // 0 active chats
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 100 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("idle_no_active_chat");
      expect(res.hasActiveChat).toBe(false);
      expect(res.primaryChat).toBeNull();
    });

    it("selects primary chat and populates concurrentChats when multiple root chats exist", async () => {
      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "conversation_summaries" }) };
          }
          if (query.includes("FROM conversation_summaries")) {
            return {
              all: () => [
                {
                  conversation_id: "root-primary",
                  title: "Primary Feature Chat",
                  status: "CASCADE_RUN_STATUS_RUNNING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 0,
                  parent_conversation_id: "",
                  workspace_uris: "/workspace/proj-a", // non-JSON string
                  last_modified_time: "2026-09-26T12:00:00Z",
                },
                {
                  conversation_id: "root-secondary",
                  title: "Concurrent Review Chat",
                  status: "CASCADE_RUN_STATUS_RUNNING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 0,
                  parent_conversation_id: "",
                  workspace_uris: "/workspace/proj-b",
                  last_modified_time: "2026-09-26T11:00:00Z",
                },
              ],
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 200 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("active");
      expect(res.primaryChat?.conversationId).toBe("root-primary");
      expect(res.concurrentChats.length).toBe(1);
      expect(res.concurrentChats[0].conversationId).toBe("root-secondary");
      expect(res.concurrentChats[0].title).toBe("Concurrent Review Chat");
      expect(res.concurrentChats[0].snapshot).toBeDefined();
      expect(res.concurrentChats[0].snapshot?.conversationId).toBe("root-secondary");
      expect(res.concurrentChats[0].tokens).toBeDefined();
      expect(res.concurrentChats[0].model).toBeDefined();
    });

    it("resolves parent candidate when only a subagent is active", async () => {
      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "conversation_summaries" }) };
          }
          if (query.includes("WHERE (not_fully_idle = 1 OR status = 'CASCADE_RUN_STATUS_RUNNING')")) {
            return {
              all: () => [
                {
                  conversation_id: "child-subagent-1",
                  title: "Orchestrated Subagent",
                  status: "CASCADE_RUN_STATUS_RUNNING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 1,
                  parent_conversation_id: "parent-root-999",
                  workspace_uris: "",
                  last_modified_time: "2026-09-26T12:00:00Z",
                },
              ],
            };
          }
          if (query.includes("WHERE conversation_id = ? AND killed = 0")) {
            return {
              get: (id: string) => {
                if (id === "parent-root-999") {
                  return {
                    conversation_id: "parent-root-999",
                    title: "Resolved Parent Root",
                    status: "CASCADE_RUN_STATUS_IDLE",
                    not_fully_idle: 1,
                    killed: 0,
                    nesting_depth: 0,
                    parent_conversation_id: "",
                    workspace_uris: JSON.stringify(["/workspace/main"]),
                    last_modified_time: "2026-09-26T12:05:00Z",
                  };
                }
                return undefined;
              },
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 300 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("active");
      expect(res.primaryChat?.conversationId).toBe("parent-root-999");
      expect(res.primaryChat?.title).toBe("Resolved Parent Root");
      expect(res.primaryChat?.activeSubagents.length).toBe(1);
      expect(res.primaryChat?.activeSubagents[0].conversationId).toBe("child-subagent-1");
    });

    it("returns idle_no_active_chat when parent candidate lookup fails", async () => {
      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "conversation_summaries" }) };
          }
          if (query.includes("WHERE (not_fully_idle = 1 OR status = 'CASCADE_RUN_STATUS_RUNNING')")) {
            return {
              all: () => [
                {
                  conversation_id: "orphan-subagent",
                  nesting_depth: 1,
                  parent_conversation_id: "missing-parent",
                },
              ],
            };
          }
          if (query.includes("WHERE conversation_id = ? AND killed = 0")) {
            return { get: () => undefined }; // Parent not found
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 300 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("idle_no_active_chat");
      expect(res.hasActiveChat).toBe(false);
    });

    it("handles unexpected database error in getActiveChatTelemetry gracefully", async () => {
      const mockAccessor: DatabaseAccessor = {
        open: () => {
          throw new Error("Disk I/O error");
        },
        stat: () => ({ mtimeMs: 300 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("idle_no_active_chat");
      expect(res.isStale).toBe(true);
    });
  });

  describe("Iteration 3 Compaction Bug Fixes (Fix 1, Fix 2, Fix 3)", () => {
    it("Fix 2: sets isCompacting to true when conversation status indicates compaction", async () => {
      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "conversation_summaries" }) };
          }
          if (query.includes("FROM conversation_summaries")) {
            return {
              all: () => [
                {
                  conversation_id: "root-compacting",
                  title: "Compacting Cascade",
                  status: "CASCADE_RUN_STATUS_COMPACTING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 0,
                  parent_conversation_id: "",
                  workspace_uris: "[]",
                  last_modified_time: "2026-09-27T01:00:00Z",
                },
              ],
            };
          }
          if (query.includes("FROM gen_metadata")) {
            return {
              all: () => [],
              get: () => ({ data: null }),
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 100 }),
      };

      const mockService = new ContextTelemetryService(mockAccessor);
      const res = await mockService.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("active");
      expect(res.primaryChat?.isCompacting).toBe(true);
    });

    it("Fix 3: clears recentCompactionEvents and returns null when currentTokens <= 0", () => {
      const service = new ContextTelemetryService();
      const convId = "conv-zero-guard";

      service.evaluateCompaction(convId, 150_000);
      const event = service.evaluateCompaction(convId, 30_000);
      expect(event?.tokenDelta).toBe(-120_000);

      // When tokens drop to 0 (error/lock anomaly), compaction event must be cleared
      const zeroEvent = service.evaluateCompaction(convId, 0);
      expect(zeroEvent).toBeNull();

      // Subsequent call with 0 also returns null
      const secondZeroEvent = service.evaluateCompaction(convId, 0);
      expect(secondZeroEvent).toBeNull();
    });

    it("Fix 1: falls back to earlier gen_metadata row when latest row has zero tokens", () => {
      // Helper to encode varint and tag
      const encodeVarint = (n: number) => {
        const b: number[] = [];
        let v = n;
        while (v > 0x7f) {
          b.push((v & 0x7f) | 0x80);
          v = Math.floor(v / 128);
        }
        b.push(v & 0x7f);
        return b;
      };
      const encodeTag = (fn: number, wt: number) => encodeVarint((fn << 3) | wt);
      const encodeLenDelim = (fn: number, bytes: number[]) => [
        ...encodeTag(fn, 2),
        ...encodeVarint(bytes.length),
        ...bytes,
      ];
      const encodeVarintField = (fn: number, val: number) => [
        ...encodeTag(fn, 0),
        ...encodeVarint(val),
      ];

      // Build valid protobuf with 45000 cached + 5000 fresh input = 50000
      const sub4 = [
        ...encodeVarintField(2, 5000),
        ...encodeVarintField(5, 45000),
      ];
      const f1 = encodeLenDelim(4, sub4);
      const validProto = new Uint8Array(encodeLenDelim(1, f1));
      const zeroProto = new Uint8Array(0); // 0 tokens

      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "gen_metadata" }) };
          }
          if (query.includes("FROM gen_metadata")) {
            return {
              all: () => [
                { data: zeroProto }, // Row 0 (latest): 0 tokens
                { data: validProto }, // Row 1 (previous): 50,000 tokens
              ],
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 123 }),
      };

      const service = new ContextTelemetryService(mockAccessor);
      const result = service.getTokensForConversation("/fake/path.db", "conv-fallback-row");

      expect(result.metrics.usedTokens).toBe(50000);
      expect(result.metrics.isEstimated).toBe(true); // Estimated because row 0 was bypassed
    });

    it("Iteration 4: prioritizes specific modelNameRaw over generic modelEnumRaw", () => {
      const encodeVarint = (n: number) => {
        const b: number[] = [];
        let v = n;
        while (v > 0x7f) {
          b.push((v & 0x7f) | 0x80);
          v = Math.floor(v / 128);
        }
        b.push(v & 0x7f);
        return b;
      };
      const encodeTag = (fn: number, wt: number) => encodeVarint((fn << 3) | wt);
      const encodeLenDelim = (fn: number, bytes: number[] | Uint8Array) => [
        ...encodeTag(fn, 2),
        ...encodeVarint(bytes.length),
        ...Array.from(bytes),
      ];
      const encodeVarintField = (fn: number, val: number) => [
        ...encodeTag(fn, 0),
        ...encodeVarint(val),
      ];

      // Sub 4 tokens
      const sub4 = [
        ...encodeVarintField(2, 5000),
        ...encodeVarintField(5, 45000),
      ];
      // Sub 19: specific model "claude-opus-4-6-thinking"
      const sub19 = encodeLenDelim(19, new TextEncoder().encode("claude-opus-4-6-thinking"));
      // Sub 20: generic wire enum "MODEL_PLACEHOLDER_M26"
      const sub20 = encodeLenDelim(20, new TextEncoder().encode("model_enum: MODEL_PLACEHOLDER_M26"));

      const f1 = [
        ...encodeLenDelim(4, sub4),
        ...sub19,
        ...sub20,
      ];
      const proto = new Uint8Array(encodeLenDelim(1, f1));

      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "gen_metadata" }) };
          }
          if (query.includes("FROM gen_metadata")) {
            return {
              all: () => [{ data: proto }],
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 456 }),
      };

      const service = new ContextTelemetryService(mockAccessor);
      const result = service.getTokensForConversation("/fake/path.db", "conv-precedence");

      // Verify specific model name takes precedence over placeholder enum
      expect(result.modelIdentifier).toBe("claude-opus-4-6-thinking");
    });

    it("Iteration 5: dynamically overrides modelCeiling maxTokens when maxContextTokens is present", async () => {
      const encodeVarint = (n: number) => {
        const b: number[] = [];
        let v = n;
        while (v > 0x7f) {
          b.push((v & 0x7f) | 0x80);
          v = Math.floor(v / 128);
        }
        b.push(v & 0x7f);
        return b;
      };
      const encodeTag = (fn: number, wt: number) => encodeVarint((fn << 3) | wt);
      const encodeLenDelim = (fn: number, bytes: number[] | Uint8Array) => [
        ...encodeTag(fn, 2),
        ...encodeVarint(bytes.length),
        ...Array.from(bytes),
      ];
      const encodeVarintField = (fn: number, val: number) => [
        ...encodeTag(fn, 0),
        ...encodeVarint(val),
      ];

      // Field 10 (ContextWindowMetadata) with max_context_tokens = 300_000
      const contextWindowBytes = encodeVarintField(4, 300_000);
      const field10Bytes = encodeLenDelim(10, contextWindowBytes);
      const field9Bytes = encodeLenDelim(9, field10Bytes);

      // Sub 4 tokens (150,000 used)
      const sub4 = [
        ...encodeVarintField(2, 50_000),
        ...encodeVarintField(5, 100_000),
      ];
      // Sub 19: model "claude-opus-4-6-thinking" (base ceiling is 200,000)
      const sub19 = encodeLenDelim(19, new TextEncoder().encode("claude-opus-4-6-thinking"));

      const f1 = [
        ...encodeLenDelim(4, sub4),
        ...field9Bytes,
        ...sub19,
      ];
      const proto = new Uint8Array(encodeLenDelim(1, f1));

      const mockDb = {
        prepare: (query: string) => {
          if (query.includes("sqlite_master")) {
            return { get: () => ({ name: "conversation_summaries" }) };
          }
          if (query.includes("FROM conversation_summaries")) {
            return {
              all: () => [
                {
                  conversation_id: "root-dynamic-ceiling",
                  title: "Dynamic Ceiling Chat",
                  status: "CASCADE_RUN_STATUS_RUNNING",
                  not_fully_idle: 1,
                  killed: 0,
                  nesting_depth: 0,
                  parent_conversation_id: "",
                  workspace_uris: "[]",
                  last_modified_time: "2026-09-27T02:00:00Z",
                },
              ],
            };
          }
          if (query.includes("FROM gen_metadata")) {
            return {
              all: () => [{ data: proto }],
            };
          }
          return { get: () => undefined, all: () => [] };
        },
        pragma: () => {},
        close: () => {},
      };

      const mockAccessor: DatabaseAccessor = {
        open: () => mockDb as any,
        stat: () => ({ mtimeMs: 789 }),
      };

      const service = new ContextTelemetryService(mockAccessor);
      const res = await service.getActiveChatTelemetry("app");

      expect(res.runtimeState).toBe("active");
      expect(res.primaryChat).toBeDefined();
      expect(res.primaryChat?.model.displayName).toBe("Claude 4.6 Opus (Thinking)");
      expect(res.primaryChat?.model.maxTokens).toBe(300_000);
      expect(res.primaryChat?.model.isAuthoritative).toBe(true);
      expect(res.primaryChat?.tokens.usedTokens).toBe(150_000);
      expect(res.primaryChat?.tokens.ratioPct).toBe(50);
      expect(res.primaryChat?.tokens.pressureState).toBe("normal");
    });
  });
});
