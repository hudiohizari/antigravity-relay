import { describe, expect, it } from 'vitest';
import {
  GitHubReleaseSchema,
  ManualUpdateSnoozeSchema,
  PackageJsonVersionSchema,
  UpdaterJsonSchema,
} from '@/modules/app-shell/update/types';

describe('manual update response schemas', () => {
  it('accepts the GitHub release payload fields used by update policy', () => {
    expect(
      GitHubReleaseSchema.safeParse({
        draft: false,
        html_url: 'https://github.com/hudiohizari/antigravity-relay/releases/tag/v1.2.3',
        name: null,
        prerelease: false,
        tag_name: 'v1.2.3',
      }).success,
    ).toBe(true);
  });

  it('rejects malformed updater and package JSON before policy code receives them', () => {
    expect(UpdaterJsonSchema.safeParse({ version: 123 }).success).toBe(false);
    expect(PackageJsonVersionSchema.safeParse({ version: null }).success).toBe(false);
    expect(
      ManualUpdateSnoozeSchema.safeParse({
        dismissedAt: 'not-a-timestamp',
        version: '1.2.3',
      }).success,
    ).toBe(false);
  });
});
