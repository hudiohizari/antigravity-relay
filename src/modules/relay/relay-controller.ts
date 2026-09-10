import { RelayServer } from "./relay-server";
import { TunnelManager } from "../tunnel/tunnel-manager";
import { RelayStateStore } from "./persistence/relay-state-store";
import type { RelayServerStatus } from "./types";

export class RelayController {
  private static instance: RelayController | null = null;

  public readonly relayServer: RelayServer;
  public readonly tunnelManager: TunnelManager;

  private constructor() {
    this.relayServer = new RelayServer();
    this.tunnelManager = new TunnelManager({
      config: {
        targetPort: 4040,
      },
    });
  }

  public static getInstance(): RelayController {
    if (!RelayController.instance) {
      RelayController.instance = new RelayController();
    }
    return RelayController.instance;
  }

  public getLastStatus(): boolean {
    return RelayStateStore.getLastStatus();
  }

  public async startRelay(options?: {
    port?: number;
    host?: string;
  }): Promise<RelayServerStatus> {
    const status = await this.relayServer.start(options);
    RelayStateStore.setLastStatus(true);
    return status;
  }

  public async stopRelay(): Promise<void> {
    await this.relayServer.stop();
    RelayStateStore.setLastStatus(false);
  }
}
