import { describe, expect, it } from 'vitest';
import { getWindowsUpdateBaseUrl } from '@/modules/app-shell/update/windowsUpdateSource';

describe('Windows update source', () => {
  it('uses per-arch static storage paths for Squirrel feeds', () => {
    expect(getWindowsUpdateBaseUrl({ platform: 'win32', arch: 'x64' })).toBe(
      'https://raw.githubusercontent.com/hudiohizari/antigravity-relay/release-updates/win32/x64',
    );
    expect(getWindowsUpdateBaseUrl({ platform: 'win32', arch: 'arm64' })).toBe(
      'https://raw.githubusercontent.com/hudiohizari/antigravity-relay/release-updates/win32/arm64',
    );
  });
});
