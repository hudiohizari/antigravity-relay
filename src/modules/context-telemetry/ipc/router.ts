import { z } from "zod";
import { os } from "@orpc/server";
import { contextTelemetryService } from "../services/ContextTelemetryService";

export const ModelCeilingInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  maxTokens: z.number().int().positive(),
  isAuthoritative: z.boolean(),
});

export const ContextPressureStateSchema = z.enum([
  "normal",
  "high_pressure",
  "critical_risk",
]);

export const TokenBreakdownSchema = z.object({
  usedTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  freshInputTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  thinkingTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  ratioPct: z.number().nonnegative(),
  pressureState: ContextPressureStateSchema,
  isEstimated: z.boolean(),
});

export const ActiveSubagentTelemetrySchema = z.object({
  conversationId: z.string(),
  agentName: z.string(),
  usedTokens: z.number().int().nonnegative(),
  status: z.string(),
});

export const ActiveChatTelemetrySnapshotSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  workspaceUris: z.array(z.string()),
  status: z.enum(["running", "idle", "interrupted"]),
  isCompacting: z.boolean().default(false),
  lastModifiedTime: z.string(),
  model: ModelCeilingInfoSchema,
  tokens: TokenBreakdownSchema,
  activeSubagents: z.array(ActiveSubagentTelemetrySchema),
});

export const CompactionEventSchema = z.object({
  conversationId: z.string(),
  tokenDelta: z.number().int().negative(),
  previousTokens: z.number().int().positive(),
  currentTokens: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
});

export const ConcurrentChatSummarySchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  usedTokens: z.number().int().nonnegative(),
  maxTokens: z.number().int().positive(),
  ratioPct: z.number().nonnegative(),
  pressureState: ContextPressureStateSchema,
  isCompacting: z.boolean().optional(),
  model: ModelCeilingInfoSchema.optional(),
  status: z.enum(["running", "idle", "interrupted"]).optional(),
  workspaceUris: z.array(z.string()).optional(),
  lastModifiedTime: z.string().optional(),
  tokens: TokenBreakdownSchema.optional(),
  activeSubagents: z.array(ActiveSubagentTelemetrySchema).optional(),
  snapshot: ActiveChatTelemetrySnapshotSchema.optional(),
});

export const ContextTelemetryResponseSchema = z.object({
  runtimeState: z.enum([
    "antigravity_not_detected",
    "idle_no_active_chat",
    "active",
  ]),
  hasActiveChat: z.boolean(),
  pollingIntervalMs: z.number().int().positive(),
  primaryChat: ActiveChatTelemetrySnapshotSchema.nullable(),
  concurrentChats: z.array(ConcurrentChatSummarySchema),
  recentCompactionEvent: CompactionEventSchema.nullable(),
  availableModels: z.array(ModelCeilingInfoSchema),
  isStale: z.boolean().optional(),
});

export type ModelCeilingInfo = z.infer<typeof ModelCeilingInfoSchema>;
export type ContextPressureState = z.infer<typeof ContextPressureStateSchema>;
export type TokenBreakdown = z.infer<typeof TokenBreakdownSchema>;
export type ActiveSubagentTelemetry = z.infer<
  typeof ActiveSubagentTelemetrySchema
>;
export type ActiveChatTelemetrySnapshot = z.infer<
  typeof ActiveChatTelemetrySnapshotSchema
>;
export type CompactionEvent = z.infer<typeof CompactionEventSchema>;
export type ConcurrentChatSummary = z.infer<typeof ConcurrentChatSummarySchema>;

export type ContextTelemetryResponse = z.infer<
  typeof ContextTelemetryResponseSchema
>;

const GetContextInputSchema = z
  .object({
    target: z.enum(["app", "ide", "cli", "agy"]).optional(),
  })
  .optional();

export const contextTelemetryRouter = os.router({
  getActiveTelemetry: os
    .input(GetContextInputSchema)
    .output(ContextTelemetryResponseSchema)
    .handler(async ({ input }) => {
      return contextTelemetryService.getActiveChatTelemetry(
        (input?.target as any) ?? "app",
      );
    }),

  getActiveContext: os
    .input(GetContextInputSchema)
    .output(ContextTelemetryResponseSchema)
    .handler(async ({ input }) => {
      return contextTelemetryService.getActiveChatTelemetry(
        (input?.target as any) ?? "app",
      );
    }),
});

export const chatContextRouter = os.router({
  getActiveContext: os
    .input(GetContextInputSchema)
    .output(ContextTelemetryResponseSchema)
    .handler(async ({ input }) => {
      return contextTelemetryService.getActiveChatTelemetry(
        (input?.target as any) ?? "app",
      );
    }),
});
