import { IPC_CHANNELS } from '@/shared/constants';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import type { RouterClient } from '@orpc/server';
import type { router } from './router';

type IPCClient = RouterClient<typeof router>;

class IPCManager {
  private readonly clientPort: MessagePort;
  private readonly serverPort: MessagePort;

  public readonly client: IPCClient;

  private initialized: boolean = false;

  constructor() {
    const { port1, port2 } = new MessageChannel();
    this.clientPort = port1;
    this.serverPort = port2;

    this.client = createORPCClient<IPCClient>(
      new RPCLink({
        port: this.clientPort,
      }),
    );
  }

  public initialize() {
    if (this.initialized) {
      return;
    }

    this.clientPort.start();

    window.postMessage(IPC_CHANNELS.START_ORPC_SERVER, '*', [this.serverPort]);
    this.initialized = true;
  }
}

export const ipc = new IPCManager();
ipc.initialize();
