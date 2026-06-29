import {
  buildPostgresScopedMigrationRows,
  type BuildPostgresScopedMigrationRowsOptions,
} from './postgres-scoped-migration-rows';
import type { StoreSnapshot } from './persistence';
import type {
  PostgresScopedMigrationPlan,
  PostgresScopedMigrationTable,
} from './postgres-scoped-migration-plan';
import {
  ensurePostgresScopedSchema,
  type QueryableClient,
  type QueryablePool,
} from './postgres-scoped-soul-repository';

export const EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM = 'EXECUTE_POSTGRES_SCOPED_MIGRATION';

export interface ExecutePostgresScopedMigrationOptions extends BuildPostgresScopedMigrationRowsOptions {
  confirm: typeof EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM;
  ensureSchema?: boolean;
}

export interface ExecutePostgresScopedMigrationResult {
  plan: PostgresScopedMigrationPlan;
  tables: Array<{
    table: PostgresScopedMigrationTable;
    count: number;
  }>;
  totalRows: number;
  committed: true;
}

export interface PostgresScopedMigrationClient extends QueryableClient {
  release(): void;
}

export interface PostgresScopedMigrationPool extends QueryablePool {
  connect(): Promise<PostgresScopedMigrationClient>;
}

interface TableInsertConfig {
  table: PostgresScopedMigrationTable;
  columns: string[];
  jsonbColumns?: Set<string>;
  conflictColumns: string[];
  updateColumns?: string[];
  doNothing?: boolean;
}

const TABLE_INSERT_CONFIGS: Record<PostgresScopedMigrationTable, TableInsertConfig> = {
  nnz_users: config('nnz_users', ['id', 'display_name', 'created_at'], ['id']),
  nnz_personas: config('nnz_personas', ['id', 'user_id', 'display_name', 'relationship', 'type', 'created_at'], ['id']),
  nnz_soul_versions: config(
    'nnz_soul_versions',
    ['id', 'user_id', 'persona_id', 'version', 'kernel_json', 'status', 'knowledge_cutoff', 'created_at'],
    ['id'],
    ['kernel_json'],
  ),
  nnz_memory_items: config(
    'nnz_memory_items',
    [
      'id',
      'user_id',
      'persona_id',
      'type',
      'source',
      'content',
      'confidence',
      'sensitivity',
      'enabled_for_soul',
      'enabled_for_runtime',
      'enabled_for_soul_update',
      'evidence_ids',
      'created_by',
      'state',
      'created_at',
    ],
    ['id'],
    ['evidence_ids'],
  ),
  nnz_soul_snapshots: config(
    'nnz_soul_snapshots',
    ['id', 'user_id', 'persona_id', 'soul_version_id', 'kernel_json', 'memory_ids', 'sealed_at'],
    ['id'],
    ['kernel_json', 'memory_ids'],
  ),
  nnz_node_events: config(
    'nnz_node_events',
    ['id', 'user_id', 'persona_id', 'name', 'status', 'start_at', 'end_at'],
    ['id'],
  ),
  nnz_soul_update_proposals: config(
    'nnz_soul_update_proposals',
    ['id', 'user_id', 'persona_id', 'field_path', 'old_value', 'new_value', 'evidence_ids', 'status', 'created_at'],
    ['id'],
    ['old_value', 'new_value', 'evidence_ids'],
  ),
  nnz_conversation_messages: config(
    'nnz_conversation_messages',
    ['id', 'user_id', 'persona_id', 'node_id', 'role', 'content', 'created_at'],
    ['id'],
  ),
  nnz_runtime_sessions: config(
    'nnz_runtime_sessions',
    [
      'user_id',
      'persona_id',
      'state',
      'soul_snapshot_id',
      'node_id',
      'node_name',
      'daily_message_count',
      'last_message_date',
      'updated_at',
    ],
    ['user_id', 'persona_id'],
  ),
  nnz_credentials: config(
    'nnz_credentials',
    ['user_id', 'email', 'password_hash', 'created_at'],
    ['user_id'],
  ),
  nnz_ops_audit_events: {
    ...config(
      'nnz_ops_audit_events',
      ['id', 'action', 'outcome', 'actor', 'target_user_ids', 'metadata', 'created_at'],
      ['id'],
      ['target_user_ids', 'metadata'],
    ),
    doNothing: true,
  },
};

export async function executePostgresScopedMigration(
  pool: PostgresScopedMigrationPool,
  snapshot: StoreSnapshot,
  options: ExecutePostgresScopedMigrationOptions,
): Promise<ExecutePostgresScopedMigrationResult> {
  if (options.confirm !== EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM) {
    throw new Error(`executePostgresScopedMigration requires confirm="${EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM}".`);
  }

  const rows = buildPostgresScopedMigrationRows(snapshot, options);
  let transactionStarted = false;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    if (options.ensureSchema !== false) {
      await ensurePostgresScopedSchema(client);
    }
    for (const table of rows.tables) {
      const configForTable = TABLE_INSERT_CONFIGS[table.table];
      for (const row of table.rows) {
        await client.query(buildInsertSql(configForTable), buildParams(configForTable, row));
      }
    }
    await client.query('COMMIT');
    return {
      plan: rows.plan,
      tables: rows.tables.map((table) => ({ table: table.table, count: table.rows.length })),
      totalRows: rows.totalRows,
      committed: true,
    };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
}

function config(
  table: PostgresScopedMigrationTable,
  columns: string[],
  conflictColumns: string[],
  jsonbColumns: string[] = [],
): TableInsertConfig {
  return {
    table,
    columns,
    conflictColumns,
    jsonbColumns: new Set(jsonbColumns),
  };
}

function buildInsertSql(tableConfig: TableInsertConfig): string {
  const columns = tableConfig.columns.join(', ');
  const values = tableConfig.columns
    .map((column, index) => `$${index + 1}${tableConfig.jsonbColumns?.has(column) ? '::jsonb' : ''}`)
    .join(', ');
  const conflict = tableConfig.conflictColumns.join(', ');
  if (tableConfig.doNothing) {
    return `INSERT INTO ${tableConfig.table} (${columns}) VALUES (${values}) ON CONFLICT (${conflict}) DO NOTHING`;
  }

  const updateColumns = tableConfig.updateColumns
    ?? tableConfig.columns.filter((column) => !tableConfig.conflictColumns.includes(column));
  const updateClause = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ');
  return `INSERT INTO ${tableConfig.table} (${columns}) VALUES (${values}) ON CONFLICT (${conflict}) DO UPDATE SET ${updateClause}`;
}

function buildParams(tableConfig: TableInsertConfig, row: Record<string, unknown>): unknown[] {
  return tableConfig.columns.map((column) => {
    const value = row[column];
    if (tableConfig.jsonbColumns?.has(column)) {
      return JSON.stringify(value ?? null);
    }
    return value ?? null;
  });
}
