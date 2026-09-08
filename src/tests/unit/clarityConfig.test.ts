import { describe, expect, it } from 'vitest';

import { createClarityBuildConfig } from '@/shared/analytics/clarityConfig';

describe('createClarityBuildConfig', () => {
  it('enables Clarity when a project ID is configured', () => {
    const config = createClarityBuildConfig({
      CLARITY_PROJECT_ID: 'project-id',
      NODE_ENV: 'production',
    });

    expect(config).toEqual({
      enabled: true,
      environment: 'production',
      projectId: 'project-id',
    });
  });

  it('keeps Clarity unavailable when no project ID is configured', () => {
    const config = createClarityBuildConfig({
      NODE_ENV: 'production',
    });

    expect(config.enabled).toBe(false);
  });

  it('does not use environment variables as user consent switches', () => {
    const config = createClarityBuildConfig({
      CLARITY_PROJECT_ID: 'project-id',
      NODE_ENV: 'development',
    });

    expect(config.enabled).toBe(true);
  });
});
