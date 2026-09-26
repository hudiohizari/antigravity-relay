import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouterClient } from "@orpc/server";
import {
  contextTelemetryRouter,
  chatContextRouter,
  ModelCeilingInfoSchema,
  ContextPressureStateSchema,
  TokenBreakdownSchema,
  ActiveSubagentTelemetrySchema,
  ActiveChatTelemetrySnapshotSchema,
  CompactionEventSchema,
  ConcurrentChatSummarySchema,
  ContextTelemetryResponseSchema,
  type ContextTelemetryResponse,
} from "@/modules/context-telemetry/ipc/router";
import { contextTelemetryService } from "@/modules/context-telemetry/services/ContextTelemetryService";

describe("contextTelemetryRouter & chatContextRouter (oRPC IPC Endpoints)", () => {
  const contextClient = createRouterClient(contextTelemetryRouter);
  const chatClient = createRouterClient(chatContextRouter);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("oRPC Procedure Execution", () => {
    it("context.getActiveTelemetry returns active chat telemetry payload", async () => {
      const mockResponse: ContextTelemetryResponse = {
        runtimeState: "active",
        hasActiveChat: true,
        pollingIntervalMs: 3000,
        primaryChat: {
          conversationId: "root-abc-123",
          title: "Refactor Module",
          workspaceUris: ["/Users/***/WebProjects/app"],
          status: "running",
          isCompacting: false,
          lastModifiedTime: "2026-09-26T12:00:00Z",
          model: {
            id: "gemini-flash",
            displayName: "Gemini Flash",
            maxTokens: 1_000_000,
            isAuthoritative: true,
          },
          tokens: {
            usedTokens: 45210,
            cachedTokens: 35000,
            freshInputTokens: 10210,
            completionTokens: 800,
            thinkingTokens: 600,
            outputTokens: 200,
            ratioPct: 4.5,
            pressureState: "normal",
            isEstimated: false,
          },
          activeSubagents: [
            {
              conversationId: "sub-1",
              agentName: "Unit Tester",
              usedTokens: 12000,
              status: "RUNNING",
            },
          ],
        },
        concurrentChats: [
          {
            conversationId: "root-xyz-456",
            title: "Secondary Workspace Chat",
            usedTokens: 85000,
            maxTokens: 200000,
            ratioPct: 42.5,
            pressureState: "normal",
          },
        ],
        recentCompactionEvent: null,
        availableModels: [
          {
            id: "gemini-flash",
            displayName: "Gemini 2.0 Flash",
            maxTokens: 1_000_000,
            isAuthoritative: true,
          },
        ],
      };

      vi.spyOn(contextTelemetryService, "getActiveChatTelemetry").mockResolvedValue(mockResponse);

      const result = await contextClient.getActiveTelemetry({ target: "app" });

      expect(result.runtimeState).toBe("active");
      expect(result.hasActiveChat).toBe(true);
      expect(result.pollingIntervalMs).toBe(3000);
      expect(result.primaryChat?.conversationId).toBe("root-abc-123");
      expect(result.primaryChat?.tokens.usedTokens).toBe(45210);
      expect(result.primaryChat?.activeSubagents.length).toBe(1);
      expect(result.concurrentChats.length).toBe(1);

      // Verify conforms to Zod schema
      expect(ContextTelemetryResponseSchema.parse(result)).toEqual(result);
    });

    it("context.getActiveContext handles idle environment and default input", async () => {
      const idleResponse: ContextTelemetryResponse = {
        runtimeState: "idle_no_active_chat",
        hasActiveChat: false,
        pollingIntervalMs: 15000,
        primaryChat: null,
        concurrentChats: [],
        recentCompactionEvent: null,
        availableModels: [],
      };

      vi.spyOn(contextTelemetryService, "getActiveChatTelemetry").mockResolvedValue(idleResponse);

      const result = await contextClient.getActiveContext(undefined);

      expect(result.runtimeState).toBe("idle_no_active_chat");
      expect(result.hasActiveChat).toBe(false);
      expect(result.pollingIntervalMs).toBe(15000);
      expect(result.primaryChat).toBeNull();
    });

    it("chat.getActiveContext delegates to contextTelemetryService identically", async () => {
      const notDetectedResponse: ContextTelemetryResponse = {
        runtimeState: "antigravity_not_detected",
        hasActiveChat: false,
        pollingIntervalMs: 15000,
        primaryChat: null,
        concurrentChats: [],
        recentCompactionEvent: null,
        availableModels: [],
      };

      vi.spyOn(contextTelemetryService, "getActiveChatTelemetry").mockResolvedValue(notDetectedResponse);

      const result = await chatClient.getActiveContext({ target: "ide" });

      expect(result.runtimeState).toBe("antigravity_not_detected");
      expect(result.hasActiveChat).toBe(false);
    });
  });

  describe("Zod Validation Schemas", () => {
    it("validates ModelCeilingInfoSchema", () => {
      const valid = {
        id: "claude-sonnet",
        displayName: "Claude 3.5 Sonnet",
        maxTokens: 200000,
        isAuthoritative: true,
      };
      expect(ModelCeilingInfoSchema.parse(valid)).toEqual(valid);

      expect(() => ModelCeilingInfoSchema.parse({ ...valid, maxTokens: -1 })).toThrow();
      expect(() => ModelCeilingInfoSchema.parse({ ...valid, id: 123 })).toThrow();
    });

    it("validates ContextPressureStateSchema", () => {
      expect(ContextPressureStateSchema.parse("normal")).toBe("normal");
      expect(ContextPressureStateSchema.parse("high_pressure")).toBe("high_pressure");
      expect(ContextPressureStateSchema.parse("critical_risk")).toBe("critical_risk");
      expect(() => ContextPressureStateSchema.parse("unknown")).toThrow();
    });

    it("validates TokenBreakdownSchema", () => {
      const valid = {
        usedTokens: 10000,
        cachedTokens: 8000,
        freshInputTokens: 2000,
        completionTokens: 500,
        thinkingTokens: 400,
        outputTokens: 100,
        ratioPct: 10.0,
        pressureState: "normal" as const,
        isEstimated: false,
      };
      expect(TokenBreakdownSchema.parse(valid)).toEqual(valid);
      expect(() => TokenBreakdownSchema.parse({ ...valid, usedTokens: -5 })).toThrow();
    });

    it("validates ActiveSubagentTelemetrySchema", () => {
      const valid = {
        conversationId: "sub-123",
        agentName: "Analyzer",
        usedTokens: 5000,
        status: "RUNNING",
      };
      expect(ActiveSubagentTelemetrySchema.parse(valid)).toEqual(valid);
    });

    it("validates CompactionEventSchema", () => {
      const valid = {
        conversationId: "root-123",
        tokenDelta: -50000,
        previousTokens: 160000,
        currentTokens: 110000,
        timestamp: 1727339120000,
      };
      expect(CompactionEventSchema.parse(valid)).toEqual(valid);

      // Delta must be negative
      expect(() => CompactionEventSchema.parse({ ...valid, tokenDelta: 5000 })).toThrow();
    });

    it("validates ConcurrentChatSummarySchema", () => {
      const valid = {
        conversationId: "conc-1",
        title: "Other Workspace",
        usedTokens: 15000,
        maxTokens: 1000000,
        ratioPct: 1.5,
        pressureState: "normal" as const,
      };
      expect(ConcurrentChatSummarySchema.parse(valid)).toEqual(valid);
    });
  });
});
