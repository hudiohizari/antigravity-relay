import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  agentDir: '',
  warn: vi.fn(),
}));

vi.mock('@/shared/platform/paths', () => ({
  getAgentDir: () => fixture.agentDir,
  getAntigravityDbPaths: () => [],
  getAntigravityStoragePaths: () => [],
}));
vi.mock('@/shared/logging/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: fixture.warn,
  },
}));

import { loadGlobalOriginalProfile } from '@/modules/identity-profile/ipc/handler';

describe('global identity-profile baseline boundary', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-profile-baseline-'));
    fixture.agentDir = tempDir;
    fixture.warn.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it('loads a complete schema-valid baseline profile', () => {
    const profile = {
      machineId: 'machine-id',
      macMachineId: 'mac-machine-id',
      devDeviceId: 'device-id',
      sqmId: '{SQM-ID}',
    };
    fs.writeFileSync(path.join(tempDir, 'device_original.json'), JSON.stringify(profile), 'utf-8');

    expect(loadGlobalOriginalProfile()).toEqual(profile);
  });

  it('fails closed when the stored baseline does not match the device-profile schema', () => {
    fs.writeFileSync(
      path.join(tempDir, 'device_original.json'),
      JSON.stringify({ machineId: 'machine-id' }),
      'utf-8',
    );

    expect(loadGlobalOriginalProfile()).toBeNull();
    expect(fixture.warn).toHaveBeenCalledWith(
      'Failed to load global original device profile',
      expect.anything(),
    );
  });
});
