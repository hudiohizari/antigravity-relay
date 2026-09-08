import { AxiosHeaders, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  axiosCreate: vi.fn(),
  axiosGet: vi.fn(),
  getAppSetting: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  setAppSetting: vi.fn(),
}));

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');

  return {
    ...actual,
    default: {
      ...actual.default,
      create: mocks.axiosCreate,
    },
  };
});

vi.mock('@/shared/logging/logger', () => ({ logger: mocks.logger }));

vi.mock('@/shared/persistence/appSettingsStore', () => ({
  getAppSetting: mocks.getAppSetting,
  setAppSetting: mocks.setAppSetting,
}));

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

describe('manual update checker', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.axiosCreate.mockReturnValue({ get: mocks.axiosGet });
    vi.stubEnv('MANUAL_UPDATE_FORCE', '1');
    vi.stubEnv('MANUAL_UPDATE_MOCK', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the module-owned Axios client for a valid updater payload', async () => {
    mocks.axiosGet.mockResolvedValueOnce(
      createResponse({
        url: 'https://github.com/hudiohizari/antigravity-relay/releases/tag/v1.2.0',
        version: '1.2.0',
      }),
    );
    const { checkManualUpdate } = await import('@/modules/app-shell/update/manualUpdateChecker');

    await expect(checkManualUpdate('1.0.0')).resolves.toMatchObject({
      status: 'available',
      update: {
        platform: 'linux',
        version: '1.2.0',
      },
    });
    expect(mocks.axiosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'User-Agent': 'AntigravityRelay' },
        timeout: 15_000,
      }),
    );
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      'https://github.com/hudiohizari/antigravity-relay/releases/latest/download/updater.json',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );
  });

  it('rejects malformed updater JSON and falls back to the validated GitHub API payload', async () => {
    mocks.axiosGet.mockResolvedValueOnce(createResponse({ version: 123 })).mockResolvedValueOnce(
      createResponse({
        draft: false,
        html_url: 'https://github.com/hudiohizari/antigravity-relay/releases/tag/v1.3.0',
        name: 'Antigravity Relay 1.3.0',
        prerelease: false,
        tag_name: 'v1.3.0',
      }),
    );
    const { checkManualUpdate } = await import('@/modules/app-shell/update/manualUpdateChecker');

    await expect(checkManualUpdate('1.0.0')).resolves.toMatchObject({
      status: 'available',
      update: {
        version: '1.3.0',
      },
    });
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/hudiohizari/antigravity-relay/releases/latest',
      expect.objectContaining({
        headers: { Accept: 'application/vnd.github+json' },
        validateStatus: expect.any(Function),
      }),
    );
  });
});
