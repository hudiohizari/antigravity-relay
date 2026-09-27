import { ipc } from "@/ipc/manager";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export function getInvalidChatsStats(target?: AntigravityAppTarget) {
  return ipc.client.conversationCleaner.stats({ target });
}

export function cleanInvalidChats(target?: AntigravityAppTarget) {
  return ipc.client.conversationCleaner.clean({ target });
}
