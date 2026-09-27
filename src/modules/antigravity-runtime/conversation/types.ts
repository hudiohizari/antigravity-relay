/**
 * Pure interfaces and runtime constants for the Antigravity conversation cleaner.
 * Kept isolated from Node.js built-ins and native bindings so frontend renderer
 * components can safely consume types and presentation constants.
 */

/**
 * Represents an individual broken conversation missing its trajectory database.
 */
export interface BrokenChatItem {
  conversationId: string;
  title: string;
  updatedAt?: number;
}

/**
 * Represents a workspace / project grouping of broken conversations.
 */
export interface BrokenProjectGroup {
  projectName: string;
  workspacePath: string; // PII-masked absolute or relative path
  brokenCount: number;
  conversations: BrokenChatItem[];
}

/**
 * Inspection stats returned to callers and renderer over IPC.
 */
export interface InvalidChatsStats {
  target: string;
  summariesDbPath: string;
  exists: boolean;
  totalChats: number;
  invalidChats: number;
  validChats: number;
  projectGroups: BrokenProjectGroup[];
  error?: string;
}

/**
 * Cleanup result returned after executing transactional purge.
 */
export interface CleanInvalidChatsResult {
  target: string;
  summariesDbPath: string;
  totalChecked: number;
  prunedCount: number;
  errors: string[];
}

/**
 * Internal parsed representation of workspace URI metadata.
 */
export interface ParsedWorkspaceInfo {
  projectName: string;
  workspacePath: string;
}

export const CONVERSATION_CLEANER_CONSTANTS = {
  FALLBACK_PROJECT_NAME: "Global / No Workspace",
  FALLBACK_CHAT_TITLE: "Untitled Conversation",
  SQLITE_BUSY_TIMEOUT_MS_READ: 3000,
  SQLITE_BUSY_TIMEOUT_MS_WRITE: 5000,
  PROTO_MIRROR_CANDIDATES: [
    "agyhub_summaries_proto.pb",
    "agyhub_summaries.pb",
    "jetbox_summaries.pb",
  ] as const,
  ACCORDION_EXPAND_THRESHOLD: 2,
} as const;
