import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudAccountRepo } from '@/modules/cloud-account/persistence/cloudHandler';
import {
  CloudAccountRefreshBlockedError,
  CloudAccountRefreshService,
} from '@/modules/cloud-account/services/CloudAccountRefreshService';
import {
  GoogleAPIService,
  OAuthTokenRefreshError,
} from '@/modules/cloud-account/services/GoogleAPIService';
import type { CloudAccount } from '@/modules/cloud-account/types';
import {
  evictNestServerAccountLeaseAccount,
  reloadNestServerAccountLeaseCache,
  updateNestServerAccountLeaseOAuthHealth,
} from '@/server/main';

vi.mock('@/modules/cloud-account/persistence/cloudHandler', () => ({
  CloudAccountRepo: {
    getAccount: vi.fn(),
    updateHealth: vi.fn(),
  },
}));

vi.mock('@/modules/cloud-account/services/GoogleAPIService', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/modules/cloud-account/services/GoogleAPIService')>();
  return {
    ...original,
    GoogleAPIService: {
      ...original.GoogleAPIService,
      refreshAccessToken: vi.fn(),
    },
  };
});

vi.mock('@/server/main', () => ({
  evictNestServerAccountLeaseAccount: vi.fn(),
  reloadNestServerAccountLeaseCache: vi.fn(),
  updateNestServerAccountLeaseOAuthHealth: vi.fn(),
}));

const request = {
  accountId: 'acc-1',
  refreshToken: 'refresh-token',
  proxyUrl: 'http://127.0.0.1:8080',
  oauthClientKey: 'default',
};

function invalidGrantError(): OAuthTokenRefreshError {
  return new OAuthTokenRefreshError('invalid_grant', 400, 'default', 'expired or revoked');
}

function createAccount(health?: CloudAccount['health']): CloudAccount {
  return {
    id: 'acc-1',
    provider: 'google',
    email: 'user@example.com',
    token: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      expiry_timestamp: 4102444800,
      token_type: 'Bearer',
    },
    health,
    created_at: 1,
    last_used: 1,
  };
}

describe('CloudAccountRefreshService', () => {
  let persistedAccount: CloudAccount;

  beforeEach(() => {
    vi.clearAllMocks();
    CloudAccountRefreshService.resetStateForTesting();
    persistedAccount = createAccount();
    vi.mocked(CloudAccountRepo.getAccount).mockImplementation(async () => persistedAccount);
    vi.mocked(CloudAccountRepo.updateHealth).mockImplementation(async (_accountId, health) => {
      persistedAccount.health = health;
    });
  });

  it('persists the first strike across service reset and blocks on the second operation', async () => {
    vi.mocked(GoogleAPIService.refreshAccessToken).mockRejectedValue(invalidGrantError());
    persistedAccount.health = {
      validation: {
        status: 'requires_action',
        reason: 'VALIDATION_REQUIRED',
        detected_at_ms: 1,
        next_probe_at_ms: 2,
      },
    };

    await expect(CloudAccountRefreshService.refreshAccessToken(request)).rejects.toBeInstanceOf(
      OAuthTokenRefreshError,
    );
    expect(persistedAccount.health?.oauth).toMatchObject({
      refresh_blocked: false,
      invalid_grant_count: 1,
      reason: 'invalid_grant',
    });
    expect(updateNestServerAccountLeaseOAuthHealth).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ invalid_grant_count: 1 }),
    );

    CloudAccountRefreshService.resetStateForTesting();

    await expect(CloudAccountRefreshService.refreshAccessToken(request)).rejects.toBeInstanceOf(
      CloudAccountRefreshBlockedError,
    );
    expect(CloudAccountRepo.updateHealth).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        validation: expect.objectContaining({ reason: 'VALIDATION_REQUIRED' }),
        oauth: expect.objectContaining({
          refresh_blocked: true,
          invalid_grant_count: 2,
          reason: 'invalid_grant',
        }),
      }),
    );
    expect(evictNestServerAccountLeaseAccount).toHaveBeenCalledWith('acc-1');
  });

  it('clears the first-failure confirmation after a successful refresh', async () => {
    vi.mocked(GoogleAPIService.refreshAccessToken)
      .mockRejectedValueOnce(invalidGrantError())
      .mockResolvedValueOnce({
        access_token: 'new-token',
        expires_in: 3600,
        token_type: 'Bearer',
      })
      .mockRejectedValueOnce(invalidGrantError());

    await expect(CloudAccountRefreshService.refreshAccessToken(request)).rejects.toBeInstanceOf(
      OAuthTokenRefreshError,
    );
    expect(persistedAccount.health?.oauth?.invalid_grant_count).toBe(1);
    await expect(
      CloudAccountRefreshService.refreshAccessToken({
        ...request,
        health: persistedAccount.health,
      }),
    ).resolves.toMatchObject({ access_token: 'new-token' });
    expect(persistedAccount.health).toBeUndefined();
    expect(updateNestServerAccountLeaseOAuthHealth).toHaveBeenCalledWith('acc-1', undefined);
    await expect(CloudAccountRefreshService.refreshAccessToken(request)).rejects.toBeInstanceOf(
      OAuthTokenRefreshError,
    );
    expect(persistedAccount.health?.oauth).toMatchObject({
      refresh_blocked: false,
      invalid_grant_count: 1,
    });
  });

  it('does not call Google for an account with a persisted refresh block', async () => {
    persistedAccount.health = {
      oauth: {
        refresh_blocked: true,
        reason: 'invalid_grant',
      },
    };

    await expect(
      CloudAccountRefreshService.refreshAccessToken({
        ...request,
        health: undefined,
      }),
    ).rejects.toBeInstanceOf(CloudAccountRefreshBlockedError);

    expect(GoogleAPIService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('serializes concurrent failure and success so the later success clears the strike', async () => {
    vi.mocked(GoogleAPIService.refreshAccessToken)
      .mockRejectedValueOnce(invalidGrantError())
      .mockResolvedValueOnce({
        access_token: 'new-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

    const firstRefresh = CloudAccountRefreshService.refreshAccessToken(request);
    const secondRefresh = CloudAccountRefreshService.refreshAccessToken({
      ...request,
      health: undefined,
    });
    const results = await Promise.allSettled([firstRefresh, secondRefresh]);

    expect(results[0]?.status).toBe('rejected');
    expect(results[1]).toMatchObject({
      status: 'fulfilled',
      value: expect.objectContaining({ access_token: 'new-token' }),
    });
    expect(persistedAccount.health).toBeUndefined();
    expect(updateNestServerAccountLeaseOAuthHealth).toHaveBeenLastCalledWith('acc-1', undefined);
  });

  it('serializes cache side effects with the OAuth state transition that caused them', async () => {
    vi.mocked(GoogleAPIService.refreshAccessToken).mockRejectedValue(invalidGrantError());
    const effects: string[] = [];
    vi.mocked(updateNestServerAccountLeaseOAuthHealth).mockImplementation(() => {
      effects.push('strike');
      return true;
    });
    vi.mocked(evictNestServerAccountLeaseAccount).mockImplementation(() => {
      effects.push('block');
      return true;
    });

    await expect(CloudAccountRefreshService.refreshAccessToken(request)).rejects.toBeInstanceOf(
      OAuthTokenRefreshError,
    );
    await expect(CloudAccountRefreshService.refreshAccessToken(request)).rejects.toBeInstanceOf(
      CloudAccountRefreshBlockedError,
    );

    expect(effects).toEqual(['strike', 'block']);
  });

  it('reloads the running lease after explicitly clearing a blocked account', async () => {
    persistedAccount.health = {
      validation: {
        status: 'requires_action',
        reason: 'VALIDATION_REQUIRED',
        detected_at_ms: 1,
        next_probe_at_ms: 2,
      },
      oauth: {
        refresh_blocked: true,
        invalid_grant_count: 2,
        reason: 'invalid_grant',
      },
    };

    await CloudAccountRefreshService.clearFailureState('acc-1');

    expect(persistedAccount.health).toEqual({ validation: persistedAccount.health?.validation });
    expect(reloadNestServerAccountLeaseCache).toHaveBeenCalledOnce();
  });
});
