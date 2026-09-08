import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { normalizeSquirrelArtifacts } from '@/shared/packaging/squirrelArtifacts';

function writeTextFile(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

describe('Forge Squirrel artifact normalization', () => {
  it('keeps x64 update assets canonical and qualifies arm64 package names in RELEASES', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'agm-squirrel-artifacts-'));
    const x64Dir = path.join(rootDir, 'out/make/squirrel.windows/x64');
    const arm64Dir = path.join(rootDir, 'out/make/squirrel.windows/arm64');
    const x64Nupkg = path.join(x64Dir, 'antigravity_relay-0.17.1-full.nupkg');
    const arm64Nupkg = path.join(arm64Dir, 'antigravity_relay-0.17.1-full.nupkg');
    const x64Releases = path.join(x64Dir, 'RELEASES');
    const arm64Releases = path.join(arm64Dir, 'RELEASES');

    writeTextFile(x64Nupkg, 'x64-package');
    writeTextFile(arm64Nupkg, 'arm64-package');
    writeTextFile(x64Releases, 'hash 123 antigravity_relay-0.17.1-full.nupkg\n');
    writeTextFile(arm64Releases, 'hash 456 antigravity_relay-0.17.1-full.nupkg\n');

    const arm64Artifacts = normalizeSquirrelArtifacts({
      artifacts: [arm64Releases, arm64Nupkg],
      platform: 'win32',
      arch: 'arm64',
    });
    const x64Artifacts = normalizeSquirrelArtifacts({
      artifacts: [x64Releases, x64Nupkg],
      platform: 'win32',
      arch: 'x64',
    });

    expect(arm64Artifacts).toEqual([
      path.join(arm64Dir, 'RELEASES'),
      path.join(arm64Dir, 'antigravity_relay-0.17.1-arm64-full.nupkg'),
    ]);
    expect(x64Artifacts).toEqual([x64Releases, x64Nupkg]);
    expect(readFileSync(arm64Releases, 'utf8')).toContain(
      'antigravity_relay-0.17.1-arm64-full.nupkg',
    );
    expect(readFileSync(x64Releases, 'utf8')).toContain('antigravity_relay-0.17.1-full.nupkg');
  });
});
