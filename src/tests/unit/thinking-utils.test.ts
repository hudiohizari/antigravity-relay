import { describe, it, expect } from 'vitest';
import {
  hasValidSignature,
  gracefulDegradeThinking,
  processThinkingBlocks,
} from '../../modules/proxy-gateway/antigravity/thinking-utils';

describe('hasValidSignature', () => {
  it('should return true for empty thinking + valid signature', () => {
    const block = { type: 'thinking' as const, thinking: '', signature: 'valid-signature-long' };
    expect(hasValidSignature(block)).toBe(true);
  });

  it('should return true for content + long signature', () => {
    const block = {
      type: 'thinking' as const,
      thinking: 'some thought',
      signature: 'long-enough-signature',
    };
    expect(hasValidSignature(block)).toBe(true);
  });

  it('should return false for content + short signature', () => {
    const block = { type: 'thinking' as const, thinking: 'some thought', signature: 'short' };
    expect(hasValidSignature(block)).toBe(false);
  });

  it('should return false for content + no signature', () => {
    const block = { type: 'thinking' as const, thinking: 'some thought', signature: undefined };
    expect(hasValidSignature(block)).toBe(false);
  });

  it('should return true for non-thinking types', () => {
    const block = { type: 'text' as const, text: 'hello' };
    expect(hasValidSignature(block)).toBe(true);
  });
});

describe('gracefulDegradeThinking', () => {
  it('should convert invalid signature thinking to text', () => {
    const block = { type: 'thinking' as const, thinking: 'important content', signature: 'bad' };
    const result = gracefulDegradeThinking(block);
    expect(result?.type).toBe('text');
    expect((result as any).text).toBe('important content');
  });

  it('should keep valid thinking block unchanged', () => {
    const block = {
      type: 'thinking' as const,
      thinking: 'content',
      signature: 'valid-long-signature',
    };
    const result = gracefulDegradeThinking(block);
    expect(result?.type).toBe('thinking');
  });

  it('should drop empty content + invalid signature block', () => {
    const block = { type: 'thinking' as const, thinking: '', signature: 'bad' };
    const result = gracefulDegradeThinking(block);
    expect(result).toBeNull();
  });

  it('should keep empty content + valid signature trailing block', () => {
    const block = { type: 'thinking' as const, thinking: '', signature: 'any-valid-sig' };
    const result = gracefulDegradeThinking(block);
    expect(result?.type).toBe('thinking');
  });
});

describe('processThinkingBlocks', () => {
  it('should filter out invalid empty thinking blocks', () => {
    const blocks = [
      { type: 'text' as const, text: 'hello' },
      { type: 'thinking' as const, thinking: '', signature: 'bad' },
      { type: 'text' as const, text: 'world' },
    ];
    const result = processThinkingBlocks(blocks);
    expect(result.length).toBe(2);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('text');
  });

  it('should convert content with invalid signature to text', () => {
    const blocks = [{ type: 'thinking' as const, thinking: 'keep me', signature: 'x' }];
    const result = processThinkingBlocks(blocks);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('text');
    expect((result[0] as any).text).toBe('keep me');
  });
});
