import axios, { AxiosHeaders, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAxiosHttpClient, HttpError, HttpErrorCode } from '@/shared/http/axios-json-client';

function createResponse(data: unknown, status = 200): AxiosResponse<unknown> {
  return {
    config: { headers: new AxiosHeaders() },
    data,
    headers: {},
    request: {},
    status,
    statusText: '',
  };
}

describe('Axios JSON client', () => {
  it('returns data only after the response schema validates it', async () => {
    const axiosClient = axios.create();
    const get = vi.spyOn(axiosClient, 'get');
    get.mockResolvedValue(createResponse({ version: '1.2.3' }));
    const client = createAxiosHttpClient(axiosClient);

    await expect(
      client.requestJson('https://updates.example.test/latest.json', {
        operation: 'test-update-check',
        responseSchema: z.object({ version: z.string() }),
      }),
    ).resolves.toEqual({ version: '1.2.3' });

    expect(get).toHaveBeenCalledWith(
      'https://updates.example.test/latest.json',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );
  });

  it('preserves an unexpected status as a safe HttpError', async () => {
    const axiosClient = axios.create();
    vi.spyOn(axiosClient, 'get').mockResolvedValue(createResponse({ message: 'unavailable' }, 503));
    const client = createAxiosHttpClient(axiosClient);

    await expect(
      client.requestJson('https://updates.example.test/latest.json', {
        operation: 'test-update-check',
        responseSchema: z.object({ version: z.string() }),
      }),
    ).rejects.toMatchObject({
      code: HttpErrorCode.UnexpectedStatus,
      httpStatus: 503,
    } satisfies Partial<HttpError>);
  });

  it('rejects malformed JSON payloads instead of returning a generic assertion', async () => {
    const axiosClient = axios.create();
    vi.spyOn(axiosClient, 'get').mockResolvedValue(createResponse({ version: 123 }));
    const client = createAxiosHttpClient(axiosClient);

    await expect(
      client.requestJson('https://updates.example.test/latest.json', {
        operation: 'test-update-check',
        responseSchema: z.object({ version: z.string() }),
      }),
    ).rejects.toMatchObject({
      code: HttpErrorCode.InvalidResponse,
    } satisfies Partial<HttpError>);
  });

  it('allows callers to declare expected redirect statuses for raw responses', async () => {
    const axiosClient = axios.create();
    vi.spyOn(axiosClient, 'get').mockResolvedValue(createResponse(null, 302));
    const client = createAxiosHttpClient(axiosClient);

    await expect(
      client.requestRaw('https://updates.example.test/latest', {
        expectedStatus: (status) => status >= 300 && status < 400,
        operation: 'test-update-redirect',
      }),
    ).resolves.toMatchObject({ status: 302 });
  });

  it('returns a stream only after the caller-provided guard narrows the response data', async () => {
    const axiosClient = axios.create();
    vi.spyOn(axiosClient, 'get').mockResolvedValue(createResponse({ stream: true }));
    const client = createAxiosHttpClient(axiosClient);

    await expect(
      client.requestStream('https://updates.example.test/latest.stream', {
        operation: 'test-update-stream',
        responseGuard: (value): value is { stream: true } =>
          typeof value === 'object' && value !== null && 'stream' in value && value.stream === true,
      }),
    ).resolves.toMatchObject({
      data: { stream: true },
      status: 200,
    });
    expect(axiosClient.get).toHaveBeenCalledWith(
      'https://updates.example.test/latest.stream',
      expect.objectContaining({ responseType: 'stream' }),
    );
  });
});
