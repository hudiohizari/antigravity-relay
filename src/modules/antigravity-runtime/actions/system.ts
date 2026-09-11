import { ipc } from "@/ipc/manager";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export function openLogDirectory() {
  return ipc.client.system.openLogDirectory();
}

export function selectAntigravityExecutable(target?: AntigravityAppTarget) {
  return ipc.client.system.selectAntigravityExecutable({ target });
}

export function getAntigravityArgs(target?: AntigravityAppTarget) {
  return ipc.client.system.getAntigravityArgs({ target });
}

export function detectAntigravityExecutable(params?: {
  target?: AntigravityAppTarget;
  bypassConfig?: boolean;
}) {
  return ipc.client.system.detectAntigravityExecutable(params);
}

export function detectAllAntigravityExecutables(params?: {
  bypassConfig?: boolean;
}) {
  return ipc.client.system.detectAllAntigravityExecutables(params);
}
