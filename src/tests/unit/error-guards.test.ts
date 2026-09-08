import { describe, expect, it } from 'vitest';
import { hasErrorCode, isErrorWithCode, isErrorWithHttpStatus } from '@/shared/errors/error-guards';

describe('error guards', () => {
  it('narrows Error instances that carry a string error code', () => {
    const error = Object.assign(new Error('already exists'), { code: 'EEXIST' });

    expect(isErrorWithCode(error)).toBe(true);
    expect(hasErrorCode(error, 'EEXIST')).toBe(true);
    expect(hasErrorCode(error, 'SQLITE_BUSY')).toBe(false);
  });

  it('rejects object-shaped values that are not Error instances', () => {
    expect(isErrorWithCode({ code: 'EEXIST' })).toBe(false);
  });

  it('narrows a numeric HTTP status only from an Error instance', () => {
    const error = Object.assign(new Error('request failed'), { httpStatus: 429 });

    expect(isErrorWithHttpStatus(error)).toBe(true);
    expect(isErrorWithHttpStatus({ httpStatus: 429 })).toBe(false);
    expect(
      isErrorWithHttpStatus(Object.assign(new Error('bad status'), { httpStatus: '429' })),
    ).toBe(false);
  });
});
