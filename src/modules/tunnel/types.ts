import { TunnelState, TunnelConfig, TunnelStatus } from "../../shared/types";
import type {
  BinaryResolutionResult,
  SupportedPlatform,
} from "./binary-resolver";

export type {
  TunnelState,
  TunnelConfig,
  TunnelStatus,
  BinaryResolutionResult,
  SupportedPlatform,
};

export const DEFAULT_TUNNEL_CONFIG: TunnelConfig = {
  targetPort: 4040,
  autoRestart: true,
  maxRetries: 5,
  retryBackoffMs: 2000,
};
