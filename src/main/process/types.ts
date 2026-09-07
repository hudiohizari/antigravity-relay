export * from "../../shared/types";
import { ServiceTarget } from "../../shared/types";

export const ALL_SERVICE_TARGETS: readonly ServiceTarget[] = [
  "antigravity_daemon",
  "antigravity_ide",
] as const;
