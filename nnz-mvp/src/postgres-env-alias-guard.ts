export const PRODUCTION_POSTGRES_ENV_KEYS = ['DATABASE_URL', 'NNZ_POSTGRES_URL'] as const;

export type ProductionPostgresEnvKey = typeof PRODUCTION_POSTGRES_ENV_KEYS[number];

export function readNonEmptyEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function findPostgresEnvAliasConflict(
  env: Record<string, string | undefined>,
  candidateEnvKey: string,
): ProductionPostgresEnvKey | undefined {
  const candidateUrl = readNonEmptyEnv(env, candidateEnvKey);
  if (!candidateUrl) return undefined;

  return PRODUCTION_POSTGRES_ENV_KEYS.find((key) => readNonEmptyEnv(env, key) === candidateUrl);
}
