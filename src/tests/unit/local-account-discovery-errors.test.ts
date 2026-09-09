import { describe, expect, it } from 'vitest';
import {
  classifyLocalAccountDiscoveryError,
  createLocalAccountDiscoveryFailure,
  createLocalAccountDiscoveryFailureByCode,
} from '@/modules/cloud-account/local-import/discovery-errors';

describe('classifyLocalAccountDiscoveryError', () => {
  it('enforces strict error precedence: timed-out > permission-denied > locked > malformed > missing > read-failed', () => {
    // timed-out beats permission-denied
    expect(
      classifyLocalAccountDiscoveryError(
        Object.assign(new Error('permission denied timed out'), { code: 'ETIMEDOUT' }),
      ),
    ).toBe('timed-out');

    // permission-denied beats locked
    expect(
      classifyLocalAccountDiscoveryError(
        Object.assign(new Error('database is locked permission denied'), { code: 'EACCES' }),
      ),
    ).toBe('permission-denied');

    // locked beats malformed
    expect(
      classifyLocalAccountDiscoveryError(
        Object.assign(new Error('database is locked and corrupt'), { code: 'SQLITE_BUSY' }),
      ),
    ).toBe('locked');

    // malformed beats missing
    expect(
      classifyLocalAccountDiscoveryError(
        Object.assign(new Error('credential not found but file is corrupt'), { code: 'malformed' }),
      ),
    ).toBe('malformed');

    // missing beats read-failed
    expect(
      classifyLocalAccountDiscoveryError(
        Object.assign(new Error('not found'), { code: 'ENOENT' }),
      ),
    ).toBe('missing');
  });

  it('classifies empty IDE database messages as missing', () => {
    expect(
      classifyLocalAccountDiscoveryError(
        new Error('No cloud account found in IDE. Please login to a Google account in Antigravity IDE first.'),
      ),
    ).toBe('missing');

    expect(
      classifyLocalAccountDiscoveryError(
        new Error('No OAuth token found in IDE state. Please login to a Google account in Antigravity IDE first.'),
      ),
    ).toBe('missing');
  });

  it('classifies unavailable credential store error as missing', () => {
    expect(
      classifyLocalAccountDiscoveryError(
        Object.assign(new Error('The Antigravity credential store is unavailable.'), {
          code: 'unavailable',
        }),
      ),
    ).toBe('missing');
  });

  it('classifies user interaction not allowed as permission-denied', () => {
    expect(
      classifyLocalAccountDiscoveryError(
        new Error('security: SecKeychainItemCopyAttributesAndData: User interaction is not allowed.'),
      ),
    ).toBe('permission-denied');
  });

  it('never masks SyntaxError or corruption as missing', () => {
    expect(
      classifyLocalAccountDiscoveryError(new SyntaxError('Unexpected end of JSON input')),
    ).toBe('malformed');

    expect(
      classifyLocalAccountDiscoveryError(new Error('SQLITE_CORRUPT: database disk image is malformed')),
    ).toBe('malformed');
  });

  it('creates typed failure objects with appropriate localized descriptions', () => {
    const source = { id: 'antigravity-keyring' as const };
    const failure = createLocalAccountDiscoveryFailure(
      source,
      new Error('No cloud account found in IDE'),
    );

    expect(failure).toEqual({
      source,
      code: 'missing',
      message: 'The local credential source was not found.',
    });

    const codeFailure = createLocalAccountDiscoveryFailureByCode(source, 'missing');
    expect(codeFailure).toEqual({
      source,
      code: 'missing',
      message: 'The local credential source was not found.',
    });
  });
});
