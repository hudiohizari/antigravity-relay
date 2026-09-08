import { RelayServer } from "./relay-server";
import { TunnelManager } from "../tunnel/tunnel-manager";

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
}
