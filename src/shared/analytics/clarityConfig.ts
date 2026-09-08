export interface ClarityBuildEnv {
  CLARITY_PROJECT_ID?: string;
  NODE_ENV?: string;
}

export interface ClarityBuildConfig {
  enabled: boolean;
  environment: string;
  projectId: string;
}

export function createClarityBuildConfig(env: ClarityBuildEnv): ClarityBuildConfig {
  const projectId = env.CLARITY_PROJECT_ID || '';
  const environment = env.NODE_ENV || 'production';

  return {
    enabled: Boolean(projectId),
    environment,
    projectId,
  };
}
