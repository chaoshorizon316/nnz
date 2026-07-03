export const DISPOSABLE_POSTGRES_ENV = 'NNZ_POSTGRES_INTEGRATION_URL';
export const PRODUCTION_POSTGRES_ENV_KEYS = ['DATABASE_URL', 'NNZ_POSTGRES_URL'] as const;

export function readNonEmptyEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function findDisposablePostgresAliasConflict(
  env: Record<string, string | undefined>,
  disposableEnvKey: string = DISPOSABLE_POSTGRES_ENV,
): string | undefined {
  const disposableUrl = readNonEmptyEnv(env, disposableEnvKey);
  if (!disposableUrl) return undefined;

  return PRODUCTION_POSTGRES_ENV_KEYS.find((key) => readNonEmptyEnv(env, key) === disposableUrl);
}
