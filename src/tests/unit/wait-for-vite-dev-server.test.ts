import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForViteDevServer } from '@/modules/app-shell/utils/wait-for-vite-dev-server';

describe('waitForViteDevServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Axios with non-2xx responses available to the retry loop', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ status: 503 } as never)
      .mockResolvedValueOnce({ status: 204 } as never);

    await expect(
      waitForViteDevServer('http://127.0.0.1:5173', { delayMs: 0, maxRetries: 2 }),
    ).resolves.toBe(0);

    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(
      'http://127.0.0.1:5173',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );
    const requestConfig = get.mock.calls[0][1];
    expect(requestConfig?.validateStatus?.(503)).toBe(true);
  });

  it('returns null after all connection failures or unsuccessful statuses', async () => {
    const request = vi
      .fn<() => Promise<{ status: number }>>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ status: 503 });

    await expect(
      waitForViteDevServer('http://127.0.0.1:5173', { delayMs: 0, maxRetries: 2, request }),
    ).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
