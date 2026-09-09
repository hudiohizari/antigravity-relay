import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  agentDir: '',
  storagePath: '',
  dbPath: '',
}));

const dbStore = new Map<string, string>();

vi.mock('better-sqlite3', () => {
  return {
    default: class MockDatabase {
      pragma() {}
      exec() {}
      prepare() {
        return {
          run: (key: string, value: string) => {
            dbStore.set(key, value);
          },
          get: () => {
            const val = dbStore.get('storage.serviceMachineId');
            return val ? { value: val } : undefined;
          },
        };
      }
      close() {}
    },
  };
});

vi.mock('@/shared/platform/paths', () => ({
  getAgentDir: () => fixture.agentDir,
  getAntigravityDbPaths: () => (fixture.dbPath ? [fixture.dbPath] : []),
  getAntigravityStoragePath: () => fixture.storagePath,
  getAntigravityStoragePaths: () => (fixture.storagePath ? [fixture.storagePath] : []),
}));

vi.mock('@/shared/logging/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  applyDeviceProfile,
  getStorageDirectoryPath,
} from '@/modules/identity-profile/ipc/handler';

describe('applyDeviceProfile storage initialization', () => {
  let tempDir: string;
  let globalStorageDir: string;
  const testProfile = {
    machineId: 'test-machine-id',
    macMachineId: '11111111-2222-4333-8444-555555555555',
    devDeviceId: '66666666-7777-4888-8999-000000000000',
    sqmId: '{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}',
  };

  beforeEach(() => {
    dbStore.clear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-profile-apply-'));
    fixture.agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(fixture.agentDir, { recursive: true });

    globalStorageDir = path.join(tempDir, 'User', 'globalStorage');
    fs.mkdirSync(globalStorageDir, { recursive: true });

    fixture.storagePath = path.join(globalStorageDir, 'storage.json');
    fixture.dbPath = path.join(globalStorageDir, 'state.vscdb');
    fs.writeFileSync(fixture.dbPath, '', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it('creates storage.json when it does not exist but storage directory exists', () => {
    expect(fs.existsSync(fixture.storagePath)).toBe(false);

    const resultPath = applyDeviceProfile(testProfile, 'classic');

    expect(resultPath).toBe(fixture.storagePath);
    expect(fs.existsSync(fixture.storagePath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(fixture.storagePath, 'utf-8'));
    expect(written['telemetry.machineId']).toBe(testProfile.machineId);
    expect(written['telemetry.macMachineId']).toBe(testProfile.macMachineId);
    expect(written['telemetry.devDeviceId']).toBe(testProfile.devDeviceId);
    expect(written['telemetry.sqmId']).toBe(testProfile.sqmId);
    expect(written['storage.serviceMachineId']).toBe(testProfile.devDeviceId);
    expect(dbStore.get('storage.serviceMachineId')).toBe(testProfile.devDeviceId);
  });

  it('updates existing storage.json preserving other keys', () => {
    fs.writeFileSync(
      fixture.storagePath,
      JSON.stringify({ customSetting: true, 'telemetry.machineId': 'old-id' }),
      'utf-8',
    );

    applyDeviceProfile(testProfile, 'classic');

    const written = JSON.parse(fs.readFileSync(fixture.storagePath, 'utf-8'));
    expect(written.customSetting).toBe(true);
    expect(written['telemetry.machineId']).toBe(testProfile.machineId);
    expect(written['telemetry.devDeviceId']).toBe(testProfile.devDeviceId);
  });

  it('throws storage_json_not_found when directory does not exist and no db exists', () => {
    const nonExistentDir = path.join(tempDir, 'non-existent', 'dir');
    fixture.storagePath = path.join(nonExistentDir, 'storage.json');
    fixture.dbPath = '';

    expect(() => applyDeviceProfile(testProfile, 'classic')).toThrow('storage_json_not_found');
  });

  it('returns storage directory path via fallback when storage.json does not exist yet', () => {
    expect(fs.existsSync(fixture.storagePath)).toBe(false);
    expect(getStorageDirectoryPath('classic')).toBe(globalStorageDir);
  });
});
