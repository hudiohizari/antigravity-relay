import { describe, it, expect } from 'vitest';
import { decodeSignature } from '../../modules/proxy-gateway/antigravity/signature-utils';

describe('decodeSignature', () => {
  describe('Base64 decoding', () => {
    it('should correctly decode valid Base64 signature', () => {
      const original = 'valid-thinking-signature-12345';
      const base64 = Buffer.from(original).toString('base64');
      expect(decodeSignature(base64)).toBe(original);
    });

    it('should decode signature with special characters', () => {
      const original = 'sig+with/special=chars==';
      const base64 = Buffer.from(original).toString('base64');
      expect(decodeSignature(base64)).toBe(original);
    });

    it('should decode UTF-8 signature text', () => {
      const original = 'thinking-signature-test-utf8';
      const base64 = Buffer.from(original).toString('base64');
      expect(decodeSignature(base64)).toBe(original);
    });
  });

  describe('Non-Base64 passthrough', () => {
    it('should return non-Base64 strings as-is', () => {
      expect(decodeSignature('plain-text-signature')).toBe('plain-text-signature');
    });

    it('should handle strings with invalid Base64 characters', () => {
      expect(decodeSignature('not!valid@base64#')).toBe('not!valid@base64#');
    });
  });

  describe('Empty value handling', () => {
    it('should return undefined for null input', () => {
      expect(decodeSignature(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(decodeSignature(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(decodeSignature('')).toBeUndefined();
    });
  });
});
