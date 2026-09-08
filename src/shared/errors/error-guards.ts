export type ErrorWithCode<TCode extends string = string> = Error & {
  readonly code: TCode;
};

export type ErrorWithHttpStatus = Error & {
  readonly httpStatus: number;
};

/**
 * Narrows only actual Error instances so plain external objects cannot impersonate runtime errors.
 */
export function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return error instanceof Error && typeof Reflect.get(error, 'code') === 'string';
}

export function hasErrorCode<TCode extends string>(
  error: unknown,
  expectedCode: TCode,
): error is ErrorWithCode<TCode> {
  return isErrorWithCode(error) && error.code === expectedCode;
}

/** Narrows only actual Error instances that expose a numeric HTTP status. */
export function isErrorWithHttpStatus(error: unknown): error is ErrorWithHttpStatus {
  return error instanceof Error && typeof Reflect.get(error, 'httpStatus') === 'number';
}
