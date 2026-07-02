import { describe, expect, it } from 'vitest';

import {
  RUNTIME_PERSISTENCE_MODE_ENV,
  SCOPED_RUNTIME_POSTGRES_ENV,
  buildRuntimePersistenceConfig,
} from './runtime-persistence-config';

describe('runtime persistence config', () => {
  it('defaults to snapshot mode and prefers NNZ_POSTGRES_URL over DATABASE_URL', () => {
    const config = buildRuntimePersistenceConfig({
      DATABASE_URL: 'postgres://prod.example/should-not-win',
      NNZ_POSTGRES_URL: 'postgres://snapshot.example/demo',
      NNZ_DB_PATH: './nnz.db',
    });

    expect(config).toMatchObject({
      runtimeMode: 'snapshot',
      requestedRuntimeMode: null,
      sqlitePath: './nnz.db',
      snapshotPostgresEnv: 'NNZ_POSTGRES_URL',
      snapshotPostgresUrl: 'postgres://snapshot.example/demo',
      scopedPostgresEnv: null,
      scopedPostgresUrl: null,
      startupBlockReason: null,
    });
  });

  it('keeps DATABASE_URL available only for the existing snapshot runtime path', () => {
    const config = buildRuntimePersistenceConfig({
      [RUNTIME_PERSISTENCE_MODE_ENV]: 'snapshot',
      DATABASE_URL: 'postgres://snapshot.example/database-url',
    });

    expect(config.snapshotPostgresEnv).toBe('DATABASE_URL');
    expect(config.snapshotPostgresUrl).toBe('postgres://snapshot.example/database-url');
    expect(config.startupBlockReason).toBeNull();
  });

  it('blocks invalid runtime modes before selecting any Postgres snapshot URL', () => {
    const config = buildRuntimePersistenceConfig({
      [RUNTIME_PERSISTENCE_MODE_ENV]: 'sideways',
      DATABASE_URL: 'postgres://prod.example/ignored',
      [SCOPED_RUNTIME_POSTGRES_ENV]: 'postgres://scoped.example/diagnostic-only',
    });

    expect(config.runtimeMode).toBe('snapshot');
    expect(config.requestedRuntimeMode).toBe('sideways');
    expect(config.snapshotPostgresEnv).toBeNull();
    expect(config.snapshotPostgresUrl).toBeNull();
    expect(config.scopedPostgresEnv).toBe(SCOPED_RUNTIME_POSTGRES_ENV);
    expect(config.scopedPostgresUrl).toBe('postgres://scoped.example/diagnostic-only');
    expect(config.startupBlockReason).toContain('NNZ_RUNTIME_PERSISTENCE_MODE');
  });

  it('requires a dedicated scoped runtime Postgres env and ignores DATABASE_URL in scoped mode', () => {
    const config = buildRuntimePersistenceConfig({
      [RUNTIME_PERSISTENCE_MODE_ENV]: 'scoped',
      DATABASE_URL: 'postgres://prod.example/ignored',
      NNZ_POSTGRES_URL: 'postgres://snapshot.example/ignored',
    });

    expect(config.runtimeMode).toBe('scoped');
    expect(config.snapshotPostgresEnv).toBeNull();
    expect(config.snapshotPostgresUrl).toBeNull();
    expect(config.scopedPostgresEnv).toBeNull();
    expect(config.scopedPostgresUrl).toBeNull();
    expect(config.startupBlockReason).toContain(SCOPED_RUNTIME_POSTGRES_ENV);
    expect(config.startupBlockReason).toContain('DATABASE_URL');
  });

  it('still blocks scoped mode with a dedicated URL until the runtime adapter is implemented', () => {
    const config = buildRuntimePersistenceConfig({
      [RUNTIME_PERSISTENCE_MODE_ENV]: 'scoped',
      [SCOPED_RUNTIME_POSTGRES_ENV]: 'postgres://disposable.example/scoped-runtime',
    });

    expect(config.runtimeMode).toBe('scoped');
    expect(config.scopedPostgresEnv).toBe(SCOPED_RUNTIME_POSTGRES_ENV);
    expect(config.scopedPostgresUrl).toBe('postgres://disposable.example/scoped-runtime');
    expect(config.snapshotPostgresEnv).toBeNull();
    expect(config.snapshotPostgresUrl).toBeNull();
    expect(config.startupBlockReason).toContain('reserved');
    expect(config.startupBlockReason).toContain('migration:smoke');
  });
});
