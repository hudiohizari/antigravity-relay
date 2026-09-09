import fs from 'fs';
import { getAgyCliCandidateTokenPaths } from '@/modules/cloud-account/persistence/agyCliTokenPaths';
import { parseCredentialStorePayload } from '@/modules/cloud-account/persistence/antigravityCredentialStore';
import {
  createLocalAccountDiscoveryFailure,
  createLocalAccountDiscoveryFailureByCode,
} from '../discovery-errors';
import type { LocalAccountDiscoverySource, LocalAccountSourceResult } from '../types';

export const MAX_CLI_TOKEN_FILE_SIZE_BYTES = 64 * 1024;

export interface AntigravityCliDiscoverySourceDependencies {
  existsSync?: (candidatePath: string) => boolean;
  statSync?: (candidatePath: string) => { size: number };
  readFileSync?: (candidatePath: string, encoding: BufferEncoding) => string;
  getCandidatePaths?: () => string[];
}

export class AntigravityCliDiscoverySource implements LocalAccountDiscoverySource {
  readonly id = 'antigravity-cli-token' as const;

  constructor(
    private readonly dependencies: AntigravityCliDiscoverySourceDependencies = {},
  ) {}

  async discover(): Promise<LocalAccountSourceResult> {
    const existsSync = this.dependencies.existsSync ?? fs.existsSync;
    const statSync = this.dependencies.statSync ?? fs.statSync;
    const readFileSync = this.dependencies.readFileSync ?? fs.readFileSync;
    const getCandidatePaths =
      this.dependencies.getCandidatePaths ?? (() => getAgyCliCandidateTokenPaths());

    const candidates: LocalAccountSourceResult['candidates'] = [];
    const failures: LocalAccountSourceResult['failures'] = [];
    const tokenPaths = getCandidatePaths();
    let existingPathCount = 0;

    for (const tokenPath of tokenPaths) {
      const source = {
        id: this.id,
        location: tokenPath,
      };

      try {
        if (!existsSync(tokenPath)) {
          continue;
        }
        existingPathCount += 1;

        const stat = statSync(tokenPath);
        if (stat.size > MAX_CLI_TOKEN_FILE_SIZE_BYTES) {
          failures.push(
            createLocalAccountDiscoveryFailureByCode(source, 'malformed'),
          );
          continue;
        }

        const raw = readFileSync(tokenPath, 'utf-8');
        const token = parseCredentialStorePayload(raw);

        candidates.push({
          source,
          credential: {
            refreshToken: token.refreshToken,
            ...(token.accessToken ? { accessToken: token.accessToken } : {}),
            ...(token.idToken ? { idToken: token.idToken } : {}),
            ...(token.projectId ? { projectId: token.projectId } : {}),
            ...(token.expiryTimestamp !== undefined
              ? { expiryTimestamp: token.expiryTimestamp }
              : {}),
          },
        });
      } catch (error) {
        failures.push(createLocalAccountDiscoveryFailure(source, error));
      }
    }

    if (existingPathCount === 0) {
      failures.push(
        createLocalAccountDiscoveryFailureByCode(
          { id: this.id },
          'missing',
        ),
      );
    }

    return {
      candidates,
      failures,
      inspectedLocations: tokenPaths.length,
    };
  }
}
