import type { StoreSnapshot } from './persistence';
import {
  POSTGRES_SCOPED_MIGRATION_TABLE_ORDER,
  planPostgresScopedMigration,
  type PostgresScopedMigrationPlan,
  type PostgresScopedMigrationTable,
} from './postgres-scoped-migration-plan';

export interface PostgresScopedMigrationRowTable {
  table: PostgresScopedMigrationTable;
  rows: Array<Record<string, unknown>>;
}

export interface PostgresScopedMigrationRows {
  plan: PostgresScopedMigrationPlan;
  tables: PostgresScopedMigrationRowTable[];
  totalRows: number;
}

export interface BuildPostgresScopedMigrationRowsOptions {
  migratedAt?: Date | string;
}

export class PostgresScopedMigrationRowsError extends Error {
  constructor(readonly plan: PostgresScopedMigrationPlan) {
    super(`Cannot build scoped migration rows while plan has blocking errors: ${plan.errors.map((error) => error.code).join(', ')}`);
    this.name = 'PostgresScopedMigrationRowsError';
  }
}

type SessionSnapshot = StoreSnapshot['sessions'][number] & {
  nodeContext?: {
    nodeId?: string;
    nodeName?: string;
  };
};

export function buildPostgresScopedMigrationRows(
  snapshot: StoreSnapshot,
  options: BuildPostgresScopedMigrationRowsOptions = {},
): PostgresScopedMigrationRows {
  const plan = planPostgresScopedMigration(snapshot);
  if (!plan.ready) {
    throw new PostgresScopedMigrationRowsError(plan);
  }

  const migratedAt = toIso(options.migratedAt ?? new Date());
  const rowsByTable: Record<PostgresScopedMigrationTable, Array<Record<string, unknown>>> = {
    nnz_users: snapshot.users.map((user) => ({
      id: user.id,
      display_name: user.displayName,
      created_at: toIso(user.createdAt),
    })),
    nnz_personas: snapshot.personas.map((persona) => ({
      id: persona.id,
      user_id: persona.userId,
      display_name: persona.displayName,
      relationship: persona.relationship,
      type: persona.type,
      created_at: toIso(persona.createdAt),
    })),
    nnz_soul_versions: snapshot.soulVersions.map((version) => ({
      id: version.id,
      user_id: version.userId,
      persona_id: version.personaId,
      version: version.version,
      kernel_json: cloneJsonValue(version.kernelJson),
      status: version.status,
      knowledge_cutoff: version.knowledgeCutoff ? toIso(version.knowledgeCutoff) : null,
      created_at: toIso(version.createdAt),
    })),
    nnz_memory_items: snapshot.memoryItems.map((memory) => ({
      id: memory.id,
      user_id: memory.userId,
      persona_id: memory.personaId,
      type: memory.type,
      source: memory.source,
      content: memory.content,
      confidence: memory.confidence,
      sensitivity: memory.sensitivity,
      enabled_for_soul: memory.enabledForSoul,
      enabled_for_runtime: memory.enabledForRuntime,
      enabled_for_soul_update: memory.enabledForSoulUpdate,
      evidence_ids: [...memory.evidenceIds],
      created_by: memory.createdBy,
      state: memory.state,
      created_at: toIso(memory.createdAt),
    })),
    nnz_soul_snapshots: snapshot.soulSnapshots.map((soulSnapshot) => ({
      id: soulSnapshot.id,
      user_id: soulSnapshot.userId,
      persona_id: soulSnapshot.personaId,
      soul_version_id: soulSnapshot.soulVersionId,
      kernel_json: cloneJsonValue(soulSnapshot.kernelJson),
      memory_ids: [...soulSnapshot.memoryIds],
      sealed_at: toIso(soulSnapshot.sealedAt),
    })),
    nnz_node_events: snapshot.nodeEvents.map((node) => ({
      id: node.id,
      user_id: node.userId,
      persona_id: node.personaId,
      name: node.name,
      status: node.status,
      start_at: toIso(node.startAt),
      end_at: toIso(node.endAt),
    })),
    nnz_soul_update_proposals: snapshot.soulUpdateProposals.map((proposal) => ({
      id: proposal.id,
      user_id: proposal.userId,
      persona_id: proposal.personaId,
      field_path: proposal.fieldPath,
      old_value: cloneJsonValue(proposal.oldValue),
      new_value: cloneJsonValue(proposal.newValue),
      evidence_ids: [...proposal.evidenceIds],
      status: proposal.status,
      created_at: toIso(proposal.createdAt),
    })),
    nnz_conversation_messages: snapshot.conversationMessages.map((message) => ({
      id: message.id,
      user_id: message.userId,
      persona_id: message.personaId,
      node_id: message.nodeId ?? null,
      role: message.role,
      content: message.content,
      created_at: toIso(message.createdAt),
    })),
    nnz_runtime_sessions: snapshot.sessions.map((session) => sessionRow(session as SessionSnapshot, migratedAt)),
    nnz_credentials: snapshot.credentials.map((credential) => ({
      user_id: credential.userId,
      email: credential.email,
      password_hash: credential.passwordHash,
      created_at: toIso(credential.createdAt),
    })),
    nnz_ops_audit_events: (snapshot.opsAuditEvents ?? []).map((event) => ({
      id: event.id,
      action: event.action,
      outcome: event.outcome,
      actor: event.actor,
      target_user_ids: [...event.targetUserIds],
      metadata: cloneJsonValue(event.metadata),
      created_at: toIso(event.createdAt),
    })),
  };

  const tables = POSTGRES_SCOPED_MIGRATION_TABLE_ORDER.map((table) => ({
    table,
    rows: rowsByTable[table],
  }));
  return {
    plan,
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rows.length, 0),
  };
}

function sessionRow(session: SessionSnapshot, migratedAt: string): Record<string, unknown> {
  return {
    user_id: session.userId,
    persona_id: session.personaId,
    state: session.state,
    soul_snapshot_id: session.soulSnapshotId ?? null,
    node_id: session.nodeId ?? session.nodeContext?.nodeId ?? null,
    node_name: session.nodeName ?? session.nodeContext?.nodeName ?? null,
    daily_message_count: session.dailyMessageCount ?? null,
    last_message_date: session.lastMessageDate ?? null,
    updated_at: migratedAt,
  };
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
