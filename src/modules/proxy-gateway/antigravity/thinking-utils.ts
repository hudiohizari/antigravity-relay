/**
 * Thinking Block Utilities
 * Handles validation and graceful degradation of thinking blocks
 *
 * Problem: Invalid signatures cause thinking blocks to be dropped, losing content
 * Solution: Validate and convert invalid blocks to text instead of dropping
 */
import { logger } from '@/shared/logging/logger';
import type { ContentBlock } from './types';

/** Minimum length for a valid thought signature */
const MIN_SIGNATURE_LENGTH = 10;

/**
 * Check if a thinking block has a valid signature
 *
 * Rules:
 * - Empty thinking + any signature = valid (trailing signature case)
 * - Non-empty thinking + signature >= MIN_SIGNATURE_LENGTH = valid
 * - Non-empty thinking + no/short signature = invalid
 * - Non-thinking blocks = always valid
 *
 * @param block - Content block to validate
 * @returns true if block is valid or not a thinking block
 */
export function hasValidSignature(block: ContentBlock): boolean {
  if (block.type !== 'thinking') {
    return true; // Non-thinking blocks are always valid
  }

  const thinkingBlock = block;

  // Empty thinking + any signature = valid (trailing signature)
  if (!thinkingBlock.thinking || thinkingBlock.thinking.length === 0) {
    return (
      thinkingBlock.signature !== undefined &&
      thinkingBlock.signature !== null &&
      thinkingBlock.signature.length >= MIN_SIGNATURE_LENGTH
    );
  }

  // Non-empty thinking needs a long enough signature
  return (
    thinkingBlock.signature !== undefined &&
    thinkingBlock.signature !== null &&
    thinkingBlock.signature.length >= MIN_SIGNATURE_LENGTH
  );
}

/**
 * Gracefully degrade an invalid thinking block
 *
 * - Valid blocks: return as-is
 * - Invalid with content: convert to text block
 * - Invalid without content: return null (should be dropped)
 *
 * @param block - Content block to process
 * @returns Processed block or null if should be dropped
 */
export function gracefulDegradeThinking(block: ContentBlock): ContentBlock | null {
  if (block.type !== 'thinking') {
    return block;
  }

  const thinkingBlock = block;

  if (hasValidSignature(block)) {
    return block;
  }

  // Invalid signature - check if we have content to preserve
  if (thinkingBlock.thinking && thinkingBlock.thinking.length > 0) {
    // Convert to text block to preserve content
    logger.info(
      `[Thinking-Utils] Converting invalid thinking block to text. Content length: ${thinkingBlock.thinking.length}`,
    );
    return {
      type: 'text',
      text: thinkingBlock.thinking,
    };
  }

  // Empty content + invalid signature = drop
  logger.debug('[Thinking-Utils] Dropping empty thinking block with invalid signature');
  return null;
}

/**
 * Process an array of content blocks, applying graceful degradation
 *
 * @param blocks - Array of content blocks
 * @returns Processed array with invalid thinking blocks handled
 */
export function processThinkingBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];

  for (const block of blocks) {
    const processed = gracefulDegradeThinking(block);
    if (processed !== null) {
      result.push(processed);
    }
  }

  return result;
}
