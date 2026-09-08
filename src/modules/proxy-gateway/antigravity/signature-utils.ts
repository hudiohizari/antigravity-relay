import { isEmpty } from 'lodash-es';
/**
 * Decode Base64-encoded signature if present
 * Gemini sends Base64, Claude expects raw string
 *
 * @param signature - The signature string (may be Base64 or raw)
 * @returns Decoded signature or undefined if input is empty
 */
export function decodeSignature(signature: string | undefined | null): string | undefined {
  if (isEmpty(signature)) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(signature!, 'base64').toString('utf-8');

    // Validate: Check if it looks like valid UTF-8 text
    // If decoding produces replacement characters, it wasn't valid Base64
    if (decoded && !decoded.includes('\ufffd') && decoded.length > 0) {
      // Additional check: re-encode and compare to detect false positives
      const reEncoded = Buffer.from(decoded).toString('base64');
      if (reEncoded === signature) {
        return decoded;
      }
    }
  } catch {
    // Not valid Base64, return as-is
  }

  // Return original if not Base64
  return signature!;
}
