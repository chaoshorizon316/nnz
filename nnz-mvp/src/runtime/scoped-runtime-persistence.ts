import pg from 'pg';

import {
  ensurePostgresScopedSchema,
  type QueryablePool,
} from '../domain/postgres-scoped-soul-repository';
import {
  createPostgresScopedRuntimeAdapter,
  type ScopedRuntimeAdapter,
} from './scoped-runtime-adapter';
import {
  createPostgresScopedOpsStoreFromPool,
  type PostgresScopedOpsStore,
} from '../ops/postgres-scoped-ops-store';

const { Pool } = pg;

export interface ScopedRuntimePersistence {
  mode: 'scoped-postgres';
  adapter: ScopedRuntimeAdapter;
  ops: PostgresScopedOpsStore;
  ensureReady(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresScopedRuntimePersistence(
  connectionString: string,
  poolFactory: (connectionString: string) => QueryablePool = createPool,
): ScopedRuntimePersistence {
  const pool = poolFactory(connectionString);
  return createPostgresScopedRuntimePersistenceFromPool(pool);
}

export function createPostgresScopedRuntimePersistenceFromPool(
  pool: QueryablePool,
  ensureSchema: () => Promise<void> = () => ensurePostgresScopedSchema(pool),
): ScopedRuntimePersistence {
  let ready = false;
  return {
    mode: 'scoped-postgres',
    adapter: createPostgresScopedRuntimeAdapter(pool),
    ops: createPostgresScopedOpsStoreFromPool(pool),
    async ensureReady(): Promise<void> {
      if (ready) return;
      await ensureSchema();
      ready = true;
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function createPool(connectionString: string): QueryablePool {
  return new Pool(
    shouldUseSsl(connectionString)
      ? { connectionString, ssl: { rejectUnauthorized: false } }
      : { connectionString },
  );
}

function shouldUseSsl(connectionString: string): boolean {
  if (connectionString.includes('sslmode=disable')) return false;
  return connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://');
}
