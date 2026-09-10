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

const TunnelCheckBinaryInputSchema = z
  .object({
    forceRefresh: z.boolean().optional(),
  })
  .optional();

const TunnelCheckBinaryOutputSchema = z.object({
  isInstalled: z.boolean(),
  binaryPath: z.string().nullable(),
  platform: z.enum(["darwin", "win32", "linux"]),
  error: z.string().optional(),
});

const RevokeSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

const RevokeDeviceInputSchema = z.object({
  deviceId: z.string().min(1),
});

export const relayRouter = os.router({
  getStatus: os.output(z.custom<RelayServerStatus>()).handler(async () => {
    return RelayController.getInstance().relayServer.getStatus();
  }),

  start: os
    .input(RelayStartInputSchema)
    .output(z.custom<RelayServerStatus>())
    .handler(async ({ input }) => {
      return RelayController.getInstance().startRelay(input);
    }),

  stop: os.output(z.void()).handler(async () => {
    await RelayController.getInstance().stopRelay();
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

  revokeDevice: os
    .input(RevokeDeviceInputSchema)
    .output(z.boolean())
    .handler(async ({ input }) => {
      return RelayController.getInstance().relayServer.revokeDevice(
        input.deviceId,
      );
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

  getPairingKey: os.output(z.string()).handler(async () => {
    return RelayController.getInstance().relayServer.getPairingKey();
  }),

  regeneratePairingKey: os.output(z.string()).handler(async () => {
    return RelayController.getInstance().relayServer.regeneratePairingKey();
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

  restart: os
    .input(TunnelStartInputSchema)
    .output(z.custom<TunnelStatus>())
    .handler(async ({ input }) => {
      return RelayController.getInstance().tunnelManager.restart(input);
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

  checkBinary: os
    .input(TunnelCheckBinaryInputSchema)
    .output(TunnelCheckBinaryOutputSchema)
    .handler(async ({ input }) => {
      return RelayController.getInstance().tunnelManager.checkBinary(
        input?.forceRefresh,
      );
    }),
});
