import { GoogleAccount } from "../../shared/types";
import { AutoSwitchConfig } from "../switcher/types";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  accountCount: number;
  activeAccountEmail?: string;
  sizeBytes?: number;
}

export interface AccountSnapshot {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  accountCount: number;
  activeAccountId: string | null;
  accounts: Record<string, GoogleAccount>;
  autoSwitchConfig?: AutoSwitchConfig;
}

export interface SnapshotStoreData {
  version: 1;
  snapshots: Record<string, AccountSnapshot>;
  lastRestoredSnapshotId?: string;
  updatedAt: number;
}
