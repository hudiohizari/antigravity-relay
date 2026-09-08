import { RPCHandler } from '@orpc/server/message-port';
import { router } from './router';

/** The message-port transport does not attach per-request context. */
type EmptyIpcContext = Record<never, never>;

export const rpcHandler: RPCHandler<EmptyIpcContext> = new RPCHandler(router);
