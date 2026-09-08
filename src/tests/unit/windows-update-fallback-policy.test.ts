import { describe, expect, it } from 'vitest';
import { selectWindowsUpdateResult } from '@/modules/app-shell/update/windowsUpdateFallbackPolicy';
import type { ManualUpdateCheckResult } from '@/modules/app-shell/update/types';

const electronUpdate: ManualUpdateCheckResult = {
  status: 'available',
  update: {
    version: '1.3.0',
    tagName: 'v1.3.0',
    releaseName: 'v1.3.0',
    releaseUrl: 'https://github.com/hudiohizari/antigravity-relay/releases/tag/v1.3.0',
    platform: 'win32',
    source: 'electron-updater',
    state: 'available',
  },
};

const manualUpdate: ManualUpdateCheckResult = {
  status: 'available',
  update: {
    version: '1.3.0',
    tagName: 'v1.3.0',
    releaseName: 'v1.3.0',
    releaseUrl: 'https://github.com/hudiohizari/antigravity-relay/releases/tag/v1.3.0',
    platform: 'win32',
  },
};

describe('windows update fallback policy', () => {
  it('prefers electron-updater when it finds an automatic update', () => {
    expect(
      selectWindowsUpdateResult({
        electronUpdaterResult: electronUpdate,
        manualResult: manualUpdate,
      }),
    ).toBe(electronUpdate);
  });

  it('uses GitHub release fallback when electron-updater misses an available update', () => {
    expect(
      selectWindowsUpdateResult({
        electronUpdaterResult: { status: 'up-to-date' },
        manualResult: manualUpdate,
      }),
    ).toBe(manualUpdate);
  });

  it('uses GitHub release fallback when electron-updater errors before finding an update', () => {
    expect(
      selectWindowsUpdateResult({
        electronUpdaterResult: { status: 'error', message: 'latest.yml failed' },
        manualResult: manualUpdate,
      }),
    ).toBe(manualUpdate);
  });

  it('returns the manual result for unmanaged Windows installs', () => {
    const manualUpToDate: ManualUpdateCheckResult = { status: 'up-to-date' };

    expect(
      selectWindowsUpdateResult({
        electronUpdaterResult: { status: 'unsupported' },
        manualResult: manualUpToDate,
      }),
    ).toBe(manualUpToDate);
  });
});
