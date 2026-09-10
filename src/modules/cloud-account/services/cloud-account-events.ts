import { EventEmitter } from "node:events";
import type {
  CloudAccount,
  CloudQuotaData,
} from "@/modules/cloud-account/types";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export interface AccountSwitchedEvent {
  accountId: string;
  target?: AntigravityAppTarget;
  account?: CloudAccount | null;
}

export interface AccountQuotaUpdatedEvent {
  accountId: string;
  quota?: CloudQuotaData;
  account?: CloudAccount | null;
}

export interface AccountDeletedEvent {
  accountId: string;
}

export interface AccountSyncRequestedEvent {
  reason?: string;
  target?: AntigravityAppTarget;
}

export interface CloudAccountEventMap {
  "account:switched": AccountSwitchedEvent;
  "account:quota_updated": AccountQuotaUpdatedEvent;
  "account:deleted": AccountDeletedEvent;
  "account:sync_requested": AccountSyncRequestedEvent;
  // Aliases for backwards/forwards compatibility
  "account-switched": AccountSwitchedEvent;
  "account-updated": AccountQuotaUpdatedEvent;
  "account-deleted": AccountDeletedEvent;
  "account-sync-requested": AccountSyncRequestedEvent;
}

export class CloudAccountEventEmitter extends EventEmitter {
  public override emit<K extends keyof CloudAccountEventMap>(
    event: K,
    payload: CloudAccountEventMap[K],
  ): boolean {
    const res = super.emit(event as string, payload);
    if (typeof event === "string") {
      if (event === "account:switched") {
        super.emit("account-switched", payload);
      } else if (event === "account-switched") {
        super.emit("account:switched", payload);
      } else if (event === "account:quota_updated") {
        super.emit("account-updated", payload);
      } else if (event === "account-updated") {
        super.emit("account:quota_updated", payload);
      } else if (event === "account:deleted") {
        super.emit("account-deleted", payload);
      } else if (event === "account-deleted") {
        super.emit("account:deleted", payload);
      } else if (event === "account:sync_requested") {
        super.emit("account-sync-requested", payload);
      } else if (event === "account-sync-requested") {
        super.emit("account:sync_requested", payload);
      }
    }
    return res;
  }

  public override on<K extends keyof CloudAccountEventMap>(
    event: K,
    listener: (payload: CloudAccountEventMap[K]) => void,
  ): this {
    return super.on(event as string, listener as (...args: any[]) => void);
  }

  public override once<K extends keyof CloudAccountEventMap>(
    event: K,
    listener: (payload: CloudAccountEventMap[K]) => void,
  ): this {
    return super.once(event as string, listener as (...args: any[]) => void);
  }

  public override off<K extends keyof CloudAccountEventMap>(
    event: K,
    listener: (payload: CloudAccountEventMap[K]) => void,
  ): this {
    return super.off(event as string, listener as (...args: any[]) => void);
  }

  public override removeListener<K extends keyof CloudAccountEventMap>(
    event: K,
    listener: (payload: CloudAccountEventMap[K]) => void,
  ): this {
    return super.removeListener(
      event as string,
      listener as (...args: any[]) => void,
    );
  }
}

export const cloudAccountEvents = new CloudAccountEventEmitter();
cloudAccountEvents.setMaxListeners(50);
