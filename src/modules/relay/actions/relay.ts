import { ipc } from "@/ipc/manager";
import type { RelayServerStatus, Session } from "../types";
import type { TunnelStatus } from "../../tunnel/types";

export async function getRelayStatus(): Promise<RelayServerStatus> {
  return ipc.client.relay.getStatus();
}

export async function startRelay(params?: {
  port?: number;
  host?: string;
}): Promise<RelayServerStatus> {
  return ipc.client.relay.start(params);
}

export async function stopRelay(): Promise<void> {
  return ipc.client.relay.stop();
}

export async function getRelaySessions(): Promise<Session[]> {
  return ipc.client.relay.getSessions();
}

export async function revokeRelaySession(sessionId: string): Promise<boolean> {
  return ipc.client.relay.revokeSession({ sessionId });
}

export async function createPairingToken(): Promise<{
  sessionId: string;
  token: string;
}> {
  return ipc.client.relay.createPairingToken();
}

export async function getPairingKey(): Promise<string> {
  return ipc.client.relay.getPairingKey();
}

export async function regeneratePairingKey(): Promise<string> {
  return ipc.client.relay.regeneratePairingKey();
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  return ipc.client.tunnel.getStatus();
}

export async function startTunnel(params?: {
  targetPort?: number;
  customDomain?: string;
  namedTunnelToken?: string;
}): Promise<TunnelStatus> {
  return ipc.client.tunnel.start(params);
}

export async function restartTunnel(params?: {
  targetPort?: number;
  customDomain?: string;
  namedTunnelToken?: string;
}): Promise<TunnelStatus> {
  return ipc.client.tunnel.restart(params);
}

export async function stopTunnel(): Promise<void> {
  return ipc.client.tunnel.stop();
}

export async function getTunnelUrl(): Promise<string | null> {
  const result = await ipc.client.tunnel.getUrl();
  return result.publicUrl;
}

export async function checkTunnelBinary(forceRefresh?: boolean): Promise<{
  isInstalled: boolean;
  binaryPath: string | null;
  platform: "darwin" | "win32" | "linux";
  error?: string;
}> {
  return ipc.client.tunnel.checkBinary(
    forceRefresh !== undefined ? { forceRefresh } : undefined,
  );
}
