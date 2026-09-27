import { os } from "@orpc/server";
import { z } from "zod";
import {
  getInvalidChatsStats,
  cleanInvalidChats,
} from "../conversation/conversationCleaner";
import { AntigravityAppTargetSchema } from "@/shared/platform/antigravityAppTarget";
import {
  type BrokenChatItem,
  type BrokenProjectGroup,
  type InvalidChatsStats,
  type CleanInvalidChatsResult,
  CONVERSATION_CLEANER_CONSTANTS,
} from "../conversation/types";

export { CONVERSATION_CLEANER_CONSTANTS };
export type {
  BrokenChatItem,
  BrokenProjectGroup,
  InvalidChatsStats,
  CleanInvalidChatsResult,
};

export const BrokenChatItemSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  updatedAt: z.number().optional(),
}) satisfies z.ZodType<BrokenChatItem>;

export const BrokenProjectGroupSchema = z.object({
  projectName: z.string(),
  workspacePath: z.string(),
  brokenCount: z.number().int().nonnegative(),
  conversations: z.array(BrokenChatItemSchema),
}) satisfies z.ZodType<BrokenProjectGroup>;

export const InvalidChatsStatsSchema = z.object({
  target: z.string(),
  summariesDbPath: z.string(),
  exists: z.boolean(),
  totalChats: z.number().int().nonnegative(),
  invalidChats: z.number().int().nonnegative(),
  validChats: z.number().int().nonnegative(),
  projectGroups: z.array(BrokenProjectGroupSchema),
  error: z.string().optional(),
}) satisfies z.ZodType<InvalidChatsStats>;

export const CleanInvalidChatsResultSchema = z.object({
  target: z.string(),
  summariesDbPath: z.string(),
  totalChecked: z.number().int().nonnegative(),
  prunedCount: z.number().int().nonnegative(),
  errors: z.array(z.string()),
}) satisfies z.ZodType<CleanInvalidChatsResult>;

export const conversationCleanerRouter = os
  .prefix("/conversation-cleaner")
  .router({
    stats: os
      .input(
        z.object({
          target: AntigravityAppTargetSchema.optional(),
        }),
      )
      .output(InvalidChatsStatsSchema)
      .handler(({ input }) => getInvalidChatsStats(input.target)),

    clean: os
      .input(
        z.object({
          target: AntigravityAppTargetSchema.optional(),
        }),
      )
      .output(CleanInvalidChatsResultSchema)
      .handler(({ input }) => cleanInvalidChats(input.target)),
  });
