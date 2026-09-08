import { z } from "zod";
import { os } from "@orpc/server";
import { RelayController } from "../relay-controller";
import type { RelayServerStatus, Session } from "../types";
import type { TunnelStatus } from "../../tunnel/types";

const RelayStartInputSchema = z
  .object({
    port: z.number().int().min(1024).max(65535).optional(),
    host: z.string().optional(),
  })
  .optional();

const TunnelStartInputSchema = z
  .object({
    targetPort: z.number().int().min(1024).max(65535).optional(),
    customDomain: z.string().optional(),
    namedTunnelToken: z.string().optional(),
  })
  .optional();

const RevokeSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const relayRouter = os.router({
  getStatus: os.output(z.custom<RelayServerStatus>()).handler(async () => {
    return RelayController.getInstance().relayServer.getStatus();
  }),

  start: os
    .input(RelayStartInputSchema)
    .output(z.custom<RelayServerStatus>())
    .handler(async ({ input }) => {
      return RelayController.getInstance().relayServer.start(input);
    }),

  stop: os.output(z.void()).handler(async () => {
    await RelayController.getInstance().relayServer.stop();
  }),

  getSessions: os.output(z.custom<Session[]>()).handler(async () => {
    return RelayController.getInstance()
      .relayServer.getSessionManager()
      .getActiveSessions();
  }),

  revokeSession: os
    .input(RevokeSessionInputSchema)
    .output(z.boolean())
    .handler(async ({ input }) => {
      return RelayController.getInstance()
        .relayServer.getSessionManager()
        .revokeSession(input.sessionId);
    }),

  createPairingToken: os
    .output(
      z.object({
        sessionId: z.string(),
        token: z.string(),
      }),
    )
    .handler(async () => {
      const session = RelayController.getInstance()
        .relayServer.getSessionManager()
        .createSession();
      return {
        sessionId: session.sessionId,
        token: session.token,
      };
    }),
});

export const tunnelRouter = os.router({
  getStatus: os.output(z.custom<TunnelStatus>()).handler(async () => {
    return RelayController.getInstance().tunnelManager.getStatus();
  }),

  start: os
    .input(TunnelStartInputSchema)
    .output(z.custom<TunnelStatus>())
    .handler(async ({ input }) => {
      return RelayController.getInstance().tunnelManager.start(input);
    }),

  stop: os.output(z.void()).handler(async () => {
    await RelayController.getInstance().tunnelManager.stop();
  }),

  getUrl: os
    .output(
      z.object({
        publicUrl: z.string().nullable(),
      }),
    )
    .handler(async () => {
      return {
        publicUrl: RelayController.getInstance().tunnelManager.getPublicUrl(),
      };
    }),
});
