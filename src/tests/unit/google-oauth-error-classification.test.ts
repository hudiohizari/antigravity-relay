import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleAPIService,
  isClientMismatchError,
  OAuthTokenRefreshError,
} from '@/modules/cloud-account/services/GoogleAPIService';
import { OAuthClientRegistryService } from '@/modules/cloud-account/services/OAuthClientRegistryService';
import { mockAxiosRequests } from '../helpers/mock-axios-request';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Google OAuth client error classification', () => {
  it.each([
    ['invalid_client', '{"error":"invalid_client"}'],
    ['unauthorized_client', '{"error":"unauthorized_client"}'],
    ['deleted_client', '{"error":"deleted_client"}'],
    ['plain text invalid_client', 'OAuth error: invalid_client'],
  ])('retries another OAuth client for %s', (_label, responseBody) => {
    expect(isClientMismatchError(responseBody)).toBe(true);
  });

  it.each([
    [
      'invalid_grant',
      '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
    ],
    ['invalid_request', '{"error":"invalid_request"}'],
    ['access_denied', '{"error":"access_denied"}'],
    ['org_internal', '{"error":"org_internal"}'],
    ['generic bad request', 'Bad Request'],
    ['generic forbidden', 'Forbidden'],
  ])('does not rotate OAuth clients for %s', (_label, responseBody) => {
    expect(isClientMismatchError(responseBody)).toBe(false);
  });

  it('retries invalid_grant once against the same client after 500ms', async () => {
    vi.useFakeTimers();
    vi.spyOn(OAuthClientRegistryService, 'getCandidateClients').mockReturnValue([
      { key: 'client-a', client_id: 'id', client_secret: 'secret', source: 'custom' },
    ] as never);
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );
    mockAxiosRequests(fetchMock);

    const refresh = GoogleAPIService.refreshAccessToken('refresh-token');
    const rejection = expect(refresh).rejects.toBeInstanceOf(OAuthTokenRefreshError);
    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new URLSearchParams(fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams).get('client_id'),
    ).toBe('id');
    expect(
      new URLSearchParams(fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams).get('client_id'),
    ).toBe('id');
  });

  it('aborts immediately during the invalid_grant confirmation delay', async () => {
    vi.useFakeTimers();
    vi.spyOn(OAuthClientRegistryService, 'getCandidateClients').mockReturnValue([
      { key: 'client-a', client_id: 'id', client_secret: 'secret', source: 'custom' },
    ] as never);
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );
    mockAxiosRequests(fetchMock);
    const controller = new AbortController();

    const refresh = GoogleAPIService.refreshAccessToken(
      'refresh-token',
      undefined,
      undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retain the raw OAuth response body in the typed error message', async () => {
    vi.useFakeTimers();
    vi.spyOn(OAuthClientRegistryService, 'getCandidateClients').mockReturnValue([
      { key: 'client-a', client_id: 'id', client_secret: 'secret', source: 'custom' },
    ] as never);
    mockAxiosRequests(
      vi.fn(
        async () =>
          new Response(
            '{"error":"invalid_grant","error_description":"bounded description","secret":"do-not-log"}',
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const refresh = GoogleAPIService.refreshAccessToken('refresh-token').catch((error) => error);
    await vi.advanceTimersByTimeAsync(500);

    const error = await refresh;
    expect(error).toMatchObject({
      code: 'invalid_grant',
      description: 'bounded description',
    });
    expect(error).not.toHaveProperty('responseText');
    expect(error.message).not.toContain('do-not-log');
  });

  it('rejects a malformed successful token payload before it reaches account state', async () => {
    vi.spyOn(OAuthClientRegistryService, 'getCandidateClients').mockReturnValue([
      {
        key: 'client-a',
        label: 'Client A',
        client_id: 'id',
        client_secret: 'secret',
        is_builtin: false,
      },
    ]);
    mockAxiosRequests(
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          expires_in: 'not-a-number',
          token_type: 'Bearer',
        }),
      }),
    );

    await expect(GoogleAPIService.refreshAccessToken('refresh-token')).rejects.toThrow(
      'Received malformed OAuth token response from Google APIs',
    );
  });
});
