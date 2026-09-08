import { describe, expect, it } from 'vitest';
import { CloudAccountHealthSchema } from '@/modules/cloud-account/types';

describe('CloudAccountHealthSchema', () => {
  it('accepts the closed validation and OAuth health contract', () => {
    expect(
      CloudAccountHealthSchema.parse({
        validation: {
          status: 'requires_action',
          reason: 'VALIDATION_REQUIRED',
          detected_at_ms: 1,
          next_probe_at_ms: 2,
          verification_url: 'https://accounts.google.com/verify',
        },
        oauth: {
          refresh_blocked: true,
          invalid_grant_count: 2,
          invalid_grant_last_at_ms: 3,
          blocked_at_ms: 3,
          reason: 'invalid_grant',
        },
      }),
    ).toBeDefined();
  });

  it.each([
    {
      validation: {
        status: 'active',
        reason: 'VALIDATION_REQUIRED',
        detected_at_ms: 1,
        next_probe_at_ms: 2,
      },
    },
    { oauth: { refresh_blocked: false, invalid_grant_count: -1 } },
    {
      validation: {
        status: 'requires_action',
        reason: 'VALIDATION_REQUIRED',
        detected_at_ms: 1,
        next_probe_at_ms: 2,
        verification_url: 'http://accounts.google.com/verify',
      },
    },
    { oauth: { refresh_blocked: true, reason: 'unknown' } },
    { unexpected: true },
  ])('rejects invalid persisted health payload %#', (health) => {
    expect(CloudAccountHealthSchema.safeParse(health).success).toBe(false);
  });
});
