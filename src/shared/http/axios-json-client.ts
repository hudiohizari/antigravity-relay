import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { z } from 'zod';

export enum HttpErrorCode {
  /** The transport failed before an HTTP response arrived. */
  RequestFailed = 'HTTP_REQUEST_FAILED',
  /** The request exceeded its configured deadline. */
  RequestTimedOut = 'HTTP_REQUEST_TIMED_OUT',
  /** An upstream response arrived with a status outside the caller's accepted range. */
  UnexpectedStatus = 'HTTP_UNEXPECTED_STATUS',
  /** A successful upstream response did not satisfy the caller's Zod schema. */
  InvalidResponse = 'HTTP_INVALID_RESPONSE',
}

interface HttpErrorOptions {
  cause?: unknown;
  code: HttpErrorCode;
  operation: string;
  httpStatus?: number;
}

/** A transport error with structured metadata for caller classification and UI decisions. */
export class HttpError extends Error {
  readonly code: HttpErrorCode;
  /** The actual upstream response status, absent when no response was received. */
  readonly httpStatus?: number;

  constructor(options: HttpErrorOptions) {
    super(createHttpErrorMessage(options), {
      cause: options.cause,
    });
    this.name = 'HttpError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
  }
}

export type ExpectedHttpStatus = (status: number) => boolean;

export interface JsonRequestOptions<TSchema extends z.ZodType> {
  expectedStatus?: ExpectedHttpStatus;
  operation: string;
  request?: Omit<AxiosRequestConfig, 'method' | 'url' | 'validateStatus'>;
  responseSchema: TSchema;
}

export interface RawRequestOptions {
  expectedStatus?: ExpectedHttpStatus;
  operation: string;
  request?: Omit<AxiosRequestConfig, 'method' | 'url' | 'validateStatus'>;
}

export interface StreamRequestOptions<TStream> {
  expectedStatus?: ExpectedHttpStatus;
  operation: string;
  request?: Omit<AxiosRequestConfig, 'method' | 'url' | 'responseType' | 'validateStatus'>;
  responseGuard: (value: unknown) => value is TStream;
}

export interface HttpStreamResponse<TStream> {
  data: TStream;
  headers: AxiosResponse<unknown>['headers'];
  status: number;
}

export interface AxiosHttpClient {
  requestJson<TSchema extends z.ZodType>(
    url: string,
    options: JsonRequestOptions<TSchema>,
  ): Promise<z.output<TSchema>>;
  requestRaw(url: string, options: RawRequestOptions): Promise<AxiosResponse<unknown>>;
  requestStream<TStream>(
    url: string,
    options: StreamRequestOptions<TStream>,
  ): Promise<HttpStreamResponse<TStream>>;
}

const isSuccessfulStatus: ExpectedHttpStatus = (status) => status >= 200 && status < 300;

/**
 * Creates a module-owned Axios boundary. Callers supply an explicit client so process-specific
 * defaults, credentials, and adapters never leak across features.
 */
export function createAxiosHttpClient(instance: AxiosInstance): AxiosHttpClient {
  return {
    async requestJson<TSchema extends z.ZodType>(
      url: string,
      options: JsonRequestOptions<TSchema>,
    ): Promise<z.output<TSchema>> {
      const response = await requestRaw(instance, url, options);
      const parsed = options.responseSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new HttpError({
          cause: parsed.error,
          code: HttpErrorCode.InvalidResponse,
          operation: options.operation,
        });
      }

      return parsed.data;
    },

    async requestRaw(url: string, options: RawRequestOptions): Promise<AxiosResponse<unknown>> {
      return await requestRaw(instance, url, options);
    },

    async requestStream<TStream>(
      url: string,
      options: StreamRequestOptions<TStream>,
    ): Promise<HttpStreamResponse<TStream>> {
      const response = await requestRaw(instance, url, {
        expectedStatus: options.expectedStatus,
        operation: options.operation,
        request: {
          ...options.request,
          responseType: 'stream',
        },
      });
      const { data } = response;
      if (!options.responseGuard(data)) {
        throw new HttpError({
          code: HttpErrorCode.InvalidResponse,
          operation: options.operation,
        });
      }

      return {
        data,
        headers: response.headers,
        status: response.status,
      };
    },
  };
}

async function requestRaw(
  instance: AxiosInstance,
  url: string,
  options: RawRequestOptions,
): Promise<AxiosResponse<unknown>> {
  let response: AxiosResponse<unknown>;

  try {
    response = await instance.get<unknown>(url, {
      ...options.request,
      validateStatus: () => true,
    });
  } catch (error) {
    throw createTransportError(options.operation, error);
  }

  const expectedStatus = options.expectedStatus ?? isSuccessfulStatus;
  if (!expectedStatus(response.status)) {
    throw new HttpError({
      code: HttpErrorCode.UnexpectedStatus,
      operation: options.operation,
      httpStatus: response.status,
    });
  }

  return response;
}

function createTransportError(operation: string, cause: unknown): HttpError {
  const isTimeout =
    axios.isAxiosError(cause) && (cause.code === 'ECONNABORTED' || cause.code === 'ETIMEDOUT');

  return new HttpError({
    cause,
    code: isTimeout ? HttpErrorCode.RequestTimedOut : HttpErrorCode.RequestFailed,
    operation,
  });
}

function createHttpErrorMessage(options: HttpErrorOptions): string {
  if (options.code === HttpErrorCode.UnexpectedStatus) {
    return `${options.operation} returned unexpected HTTP status ${options.httpStatus}`;
  }

  if (options.code === HttpErrorCode.InvalidResponse) {
    return `${options.operation} returned a response that did not match its schema`;
  }

  if (options.code === HttpErrorCode.RequestTimedOut) {
    return `${options.operation} timed out`;
  }

  return `${options.operation} failed before receiving a response`;
}
