import { describe, expect, it } from 'vitest';
import { buildElectronUpdaterNotification } from '@/modules/app-shell/update/electronUpdaterPolicy';

describe('electron updater notification policy', () => {
  it('builds a Windows download prompt from an available app update', () => {
    const notification = buildElectronUpdaterNotification({
      state: 'available',
      platform: 'win32',
      version: '0.19.0',
      releaseName: 'Antigravity Relay 0.19.0',
    });

    expect(notification).toEqual({
      version: '0.19.0',
      tagName: 'v0.19.0',
      releaseName: 'Antigravity Relay 0.19.0',
      releaseUrl: 'https://github.com/hudiohizari/antigravity-relay/releases/tag/v0.19.0',
      platform: 'win32',
      source: 'electron-updater',
      state: 'available',
    });
  });

  it('builds a restart prompt after the app update is downloaded', () => {
    const notification = buildElectronUpdaterNotification({
      state: 'downloaded',
      platform: 'win32',
      version: '0.19.0',
      releaseName: null,
    });

    expect(notification.state).toBe('downloaded');
    expect(notification.releaseName).toBe('v0.19.0');
  });
});
