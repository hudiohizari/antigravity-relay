import { agyBinaryPatchRouter } from "./agyBinaryPatchRouter";
import { antigravityClientCacheRouter } from "./cacheRouter";
import { processRouter } from "./processRouter";
import { conversationCleanerRouter } from "./conversationCleanerRouter";

export const antigravityRuntimeRouter = {
  antigravityClientCache: antigravityClientCacheRouter,
  agyBinaryPatch: agyBinaryPatchRouter,
  proc: processRouter,
  conversationCleaner: conversationCleanerRouter,
};
