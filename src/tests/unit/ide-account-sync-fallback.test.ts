import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdeAccountImportAdapter } from '@/modules/cloud-account/persistence/ide-account-import-adapter';
import { CloudAccountRepo } from '@/modules/cloud-account/persistence/cloudHandler';
import { CredentialStoreReadError } from '@/modules/cloud-account/persistence/antigravityCredentialStore';

const mocks = vi.hoisted(() => ({
  readAntigravityCredentialStoreToken: vi.fn(),
  getUserInfo: vi.fn(),
  refreshAccessToken: vi.fn(),
  getAntigravityDbPaths: vi.fn(),
  getAgyCliCandidateTokenPaths: vi.fn(),
}));

vi.mock('@/modules/cloud-account/persistence/antigravityCredentialStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/cloud-account/persistence/antigravityCredentialStore')>();
  return {
    ...actual,
    readAntigravityCredentialStoreToken: mocks.readAntigravityCredentialStoreToken,
  };
});

vi.mock('@/shared/platform/paths', () => ({
  getAntigravityDbPaths: mocks.getAntigravityDbPaths,
}));

vi.mock('@/modules/cloud-account/persistence/agyCliTokenPaths', () => ({
  getAgyCliCandidateTokenPaths: mocks.getAgyCliCandidateTokenPaths,
}));

vi.mock('@/modules/cloud-account/services/GoogleAPIService', () => ({
  GoogleAPIService: {
    getUserInfo: mocks.getUserInfo,
    refreshAccessToken: mocks.refreshAccessToken,
  },
}));

describe('IdeAccountImportAdapter fallback and fail-fast precedence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.readAntigravityCredentialStoreToken.mockReset();
    mocks.getUserInfo.mockReset();
    mocks.refreshAccessToken.mockReset();
    mocks.getAntigravityDbPaths.mockReset();
    mocks.getAgyCliCandidateTokenPaths.mockReset();

    mocks.getAntigravityDbPaths.mockReturnValue(['/mock/state.vscdb']);
    mocks.getAgyCliCandidateTokenPaths.mockReturnValue(['/mock/cli-token.json']);

    vi.spyOn(CloudAccountRepo, 'getAccounts').mockResolvedValue([]);
    vi.spyOn(CloudAccountRepo, 'addAccount').mockResolvedValue();
  });

  it('falls back to System Credential Store when SQLite database is missing from disk', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/cli-token.json');
    mocks.readAntigravityCredentialStoreToken.mockReturnValue({
      accessToken: 'keyring-access',
      refreshToken: 'keyring-refresh',
    });
    mocks.getUserInfo.mockResolvedValue({
      email: 'keyring@example.com',
      name: 'Keyring User',
      picture: 'https://example.com/avatar.png',
    });

    const account = await IdeAccountImportAdapter.syncFromIde('ide');

    expect(account).toMatchObject({
      email: 'keyring@example.com',
      token: expect.objectContaining({
        access_token: 'keyring-access',
        refresh_token: 'keyring-refresh',
      }),
    });
  });

  it('falls back to System Credential Store when SQLite database contains no cloud account', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/state.vscdb');
    vi.spyOn(IdeAccountImportAdapter, 'readTokenInfoFromPath').mockImplementation(() => {
      throw new Error('No cloud account found in IDE. Please login to a Google account in Antigravity IDE first.');
    });

    mocks.readAntigravityCredentialStoreToken.mockReturnValue({
      accessToken: 'keyring-access',
      refreshToken: 'keyring-refresh',
    });
    mocks.getUserInfo.mockResolvedValue({
      email: 'keyring@example.com',
      name: 'Keyring User',
      picture: 'https://example.com/avatar.png',
    });

    const account = await IdeAccountImportAdapter.syncFromIde('ide');

    expect(account).toMatchObject({
      email: 'keyring@example.com',
      token: expect.objectContaining({
        access_token: 'keyring-access',
        refresh_token: 'keyring-refresh',
      }),
    });
  });

  it('falls back to CLI token file when both SQLite DB and System Credential Store are missing', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/cli-token.json');
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 120 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        token: {
          access_token: 'cli-access',
          refresh_token: 'cli-refresh',
        },
      }),
    );

    mocks.readAntigravityCredentialStoreToken.mockReturnValue(null);
    mocks.getUserInfo.mockResolvedValue({
      email: 'cli@example.com',
      name: 'CLI User',
      picture: 'https://example.com/avatar.png',
    });

    const account = await IdeAccountImportAdapter.syncFromIde('ide');

    expect(account).toMatchObject({
      email: 'cli@example.com',
      token: expect.objectContaining({
        access_token: 'cli-access',
        refresh_token: 'cli-refresh',
      }),
    });
  });

  it('fails fast on SQLite database lock (SQLITE_BUSY) and does not fall back', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(IdeAccountImportAdapter, 'readTokenInfoFromPath').mockImplementation(() => {
      const error = new Error('database is locked');
      (error as { code?: string }).code = 'SQLITE_BUSY';
      throw error;
    });

    await expect(IdeAccountImportAdapter.syncFromIde('ide')).rejects.toThrow('database is locked');
    expect(mocks.readAntigravityCredentialStoreToken).not.toHaveBeenCalled();
  });

  it('fails fast on SQLite database permission denied (EACCES) and does not fall back', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(IdeAccountImportAdapter, 'readTokenInfoFromPath').mockImplementation(() => {
      const error = new Error('permission denied');
      (error as { code?: string }).code = 'EACCES';
      throw error;
    });

    await expect(IdeAccountImportAdapter.syncFromIde('ide')).rejects.toThrow('permission denied');
    expect(mocks.readAntigravityCredentialStoreToken).not.toHaveBeenCalled();
  });

  it('fails fast on System Credential Store permission-denied and does not fall back to CLI token', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/cli-token.json');
    mocks.readAntigravityCredentialStoreToken.mockImplementation(() => {
      throw new CredentialStoreReadError('permission-denied');
    });

    await expect(IdeAccountImportAdapter.syncFromIde('ide')).rejects.toThrow(
      'Permission was denied while reading the Antigravity credential store.',
    );
  });

  it('fails fast on System Credential Store locked error', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/cli-token.json');
    mocks.readAntigravityCredentialStoreToken.mockImplementation(() => {
      throw new CredentialStoreReadError('locked');
    });

    await expect(IdeAccountImportAdapter.syncFromIde('ide')).rejects.toThrow(
      'The Antigravity credential store is locked.',
    );
  });

  it('safely handles undefined accessToken by proactively refreshing token via Google API', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/cli-token.json');
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        token: {
          refresh_token: 'refresh-only-token',
        },
      }),
    );

    mocks.readAntigravityCredentialStoreToken.mockReturnValue(null);
    mocks.refreshAccessToken.mockResolvedValue({
      access_token: 'freshly-minted-access-token',
      expires_in: 3600,
    });
    mocks.getUserInfo.mockResolvedValue({
      email: 'refreshed@example.com',
      name: 'Refreshed User',
    });

    const account = await IdeAccountImportAdapter.syncFromIde('ide');

    expect(mocks.refreshAccessToken).toHaveBeenCalledWith('refresh-only-token');
    expect(mocks.getUserInfo).toHaveBeenCalledWith('freshly-minted-access-token');
    expect(account).toMatchObject({
      email: 'refreshed@example.com',
      token: expect.objectContaining({
        access_token: 'freshly-minted-access-token',
        refresh_token: 'refresh-only-token',
      }),
    });
  });

  it('safely handles empty accessToken by proactively refreshing token via Google API', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/mock/cli-token.json');
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        token: {
          access_token: '',
          refresh_token: 'refresh-with-empty-access',
        },
      }),
    );

    mocks.readAntigravityCredentialStoreToken.mockReturnValue(null);
    mocks.refreshAccessToken.mockResolvedValue({
      access_token: 'freshly-minted-access-token-2',
      expires_in: 3600,
    });
    mocks.getUserInfo.mockResolvedValue({
      email: 'refreshed2@example.com',
      name: 'Refreshed User 2',
    });

    const account = await IdeAccountImportAdapter.syncFromIde('ide');

    expect(mocks.refreshAccessToken).toHaveBeenCalledWith('refresh-with-empty-access');
    expect(mocks.getUserInfo).toHaveBeenCalledWith('freshly-minted-access-token-2');
    expect(account).toMatchObject({
      email: 'refreshed2@example.com',
    });
  });
});
