export const RUNTIME_PERSISTENCE_MODE_ENV = 'NNZ_RUNTIME_PERSISTENCE_MODE';
export const SCOPED_RUNTIME_POSTGRES_ENV = 'NNZ_POSTGRES_SCOPED_RUNTIME_URL';

const SNAPSHOT_POSTGRES_ENV_KEYS = ['NNZ_POSTGRES_URL', 'DATABASE_URL'] as const;

export type RuntimePersistenceMode = 'snapshot' | 'scoped';
export type SnapshotPostgresEnvKey = typeof SNAPSHOT_POSTGRES_ENV_KEYS[number];
export type ScopedRuntimePostgresEnvKey = typeof SCOPED_RUNTIME_POSTGRES_ENV;

export interface RuntimePersistenceConfig {
  runtimeMode: RuntimePersistenceMode;
  requestedRuntimeMode: string | null;
  sqlitePath: string | null;
  snapshotPostgresEnv: SnapshotPostgresEnvKey | null;
  snapshotPostgresUrl: string | null;
  scopedPostgresEnv: ScopedRuntimePostgresEnvKey | null;
  scopedPostgresUrl: string | null;
  startupBlockReason: string | null;
}

type EnvSource = Record<string, string | undefined>;

export function buildRuntimePersistenceConfig(env: EnvSource): RuntimePersistenceConfig {
  const requestedRuntimeMode = readNonEmptyEnv(env, RUNTIME_PERSISTENCE_MODE_ENV);
  const sqlitePath = readNonEmptyEnv(env, 'NNZ_DB_PATH');
  const scopedPostgresUrl = readNonEmptyEnv(env, SCOPED_RUNTIME_POSTGRES_ENV);
  const scopedPostgresEnv = scopedPostgresUrl ? SCOPED_RUNTIME_POSTGRES_ENV : null;

  if (requestedRuntimeMode && !isRuntimePersistenceMode(requestedRuntimeMode)) {
    return {
      runtimeMode: 'snapshot',
      requestedRuntimeMode,
      sqlitePath,
      snapshotPostgresEnv: null,
      snapshotPostgresUrl: null,
      scopedPostgresEnv,
      scopedPostgresUrl,
      startupBlockReason: `${RUNTIME_PERSISTENCE_MODE_ENV} must be either "snapshot" or "scoped".`,
    };
  }

  const runtimeMode: RuntimePersistenceMode = requestedRuntimeMode === 'scoped' ? 'scoped' : 'snapshot';
  if (runtimeMode === 'scoped') {
    return {
      runtimeMode,
      requestedRuntimeMode,
      sqlitePath,
      snapshotPostgresEnv: null,
      snapshotPostgresUrl: null,
      scopedPostgresEnv,
      scopedPostgresUrl,
      startupBlockReason: scopedPostgresUrl
        ? null
        : `${RUNTIME_PERSISTENCE_MODE_ENV}=scoped requires ${SCOPED_RUNTIME_POSTGRES_ENV}; DATABASE_URL and NNZ_POSTGRES_URL are intentionally ignored for scoped runtime mode.`,
    };
  }

  const snapshotPostgres = readFirstConfiguredEnv(env, SNAPSHOT_POSTGRES_ENV_KEYS);
  return {
    runtimeMode,
    requestedRuntimeMode,
    sqlitePath,
    snapshotPostgresEnv: snapshotPostgres?.key ?? null,
    snapshotPostgresUrl: snapshotPostgres?.value ?? null,
    scopedPostgresEnv,
    scopedPostgresUrl,
    startupBlockReason: null,
  };
}

function isRuntimePersistenceMode(value: string): value is RuntimePersistenceMode {
  return value === 'snapshot' || value === 'scoped';
}

function readNonEmptyEnv(env: EnvSource, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function readFirstConfiguredEnv(
  env: EnvSource,
  keys: readonly SnapshotPostgresEnvKey[],
): { key: SnapshotPostgresEnvKey; value: string } | null {
  for (const key of keys) {
    const value = readNonEmptyEnv(env, key);
    if (value) return { key, value };
  }
  return null;
}
