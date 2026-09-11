import { os } from "@orpc/server";
import { z } from "zod";
import { AntigravityAppTargetSchema } from "@/shared/platform/antigravityAppTarget";
import {
  closeAntigravity,
  getProcessStatus,
  isProcessRunning,
  startAntigravity,
} from "./handler";

const ProcessTargetInputSchema = z
  .object({ target: AntigravityAppTargetSchema.optional() })
  .optional();

const ProcessStatusOutputSchema = z.object({
  target: AntigravityAppTargetSchema,
  isRunning: z.boolean(),
  isBinaryInstalled: z.boolean(),
  executablePath: z.string().nullable(),
});

export const processRouter = os.router({
  isProcessRunning: os
    .input(ProcessTargetInputSchema)
    .output(z.boolean())
    .handler(async ({ input }) => {
      return await isProcessRunning(input?.target);
    }),
  getProcessStatus: os
    .input(ProcessTargetInputSchema)
    .output(ProcessStatusOutputSchema)
    .handler(async ({ input }) => {
      return await getProcessStatus(input?.target);
    }),
  closeAntigravity: os
    .input(ProcessTargetInputSchema)
    .output(z.void())
    .handler(async ({ input }) => {
      await closeAntigravity(input?.target);
    }),
  startAntigravity: os
    .input(ProcessTargetInputSchema)
    .output(z.void())
    .handler(async ({ input }) => {
      await startAntigravity(input?.target);
    }),
});
