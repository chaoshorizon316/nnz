import {
  PRODUCTION_POSTGRES_ENV_KEYS,
  findPostgresEnvAliasConflict,
  readNonEmptyEnv,
} from '../postgres-env-alias-guard';

export const DISPOSABLE_POSTGRES_ENV = 'NNZ_POSTGRES_INTEGRATION_URL';
export { PRODUCTION_POSTGRES_ENV_KEYS, readNonEmptyEnv };

export function findDisposablePostgresAliasConflict(
  env: Record<string, string | undefined>,
  disposableEnvKey: string = DISPOSABLE_POSTGRES_ENV,
): string | undefined {
  return findPostgresEnvAliasConflict(env, disposableEnvKey);
}
