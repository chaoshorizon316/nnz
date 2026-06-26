import type { StoreSnapshot } from './persistence';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  Persona,
  SoulSnapshot,
  SoulUpdateProposal,
  SoulVersion,
  User,
} from './types';

export const POSTGRES_SCOPED_MIGRATION_TABLE_ORDER = [
  'nnz_users',
  'nnz_personas',
  'nnz_soul_versions',
  'nnz_memory_items',
  'nnz_soul_snapshots',
  'nnz_node_events',
  'nnz_soul_update_proposals',
  'nnz_conversation_messages',
  'nnz_runtime_sessions',
  'nnz_credentials',
  'nnz_ops_audit_events',
] as const;

export type PostgresScopedMigrationTable = typeof POSTGRES_SCOPED_MIGRATION_TABLE_ORDER[number];

export interface PostgresScopedMigrationIssue {
  code: string;
  message: string;
  table?: PostgresScopedMigrationTable;
  id?: string;
}

export interface PostgresScopedMigrationTablePlan {
  table: PostgresScopedMigrationTable;
  count: number;
}

export interface PostgresScopedMigrationPlan {
  ready: boolean;
  tableOrder: PostgresScopedMigrationTable[];
  tables: PostgresScopedMigrationTablePlan[];
  totalRows: number;
  errors: PostgresScopedMigrationIssue[];
  warnings: PostgresScopedMigrationIssue[];
}

type ScopedRecord =
  | SoulVersion
  | SoulSnapshot
  | MemoryItem
  | SoulUpdateProposal
  | NodeEvent
  | ConversationMessage;

interface ScopedOwner {
  id: string;
  userId: string;
  personaId: string;
}

type SessionSnapshot = StoreSnapshot['sessions'][number] & {
  nodeContext?: {
    nodeId?: string;
    nodeName?: string;
  };
};
type CredentialSnapshot = StoreSnapshot['credentials'][number];

const RUNTIME_STATES = new Set(['ACTIVE', 'SEALED', 'NODE', 'GRADUATED']);

export function planPostgresScopedMigration(snapshot: StoreSnapshot): PostgresScopedMigrationPlan {
  const errors: PostgresScopedMigrationIssue[] = [];
  const warnings: PostgresScopedMigrationIssue[] = [];

  const usersById = collectUnique(snapshot.users, 'nnz_users', errors);
  const personasById = collectUnique(snapshot.personas, 'nnz_personas', errors);
  const soulVersionsById = collectUnique(snapshot.soulVersions, 'nnz_soul_versions', errors);
  const memoriesById = collectUnique(snapshot.memoryItems, 'nnz_memory_items', errors);
  const snapshotsById = collectUnique(snapshot.soulSnapshots, 'nnz_soul_snapshots', errors);
  const nodesById = collectUnique(snapshot.nodeEvents, 'nnz_node_events', errors);
  collectUnique(snapshot.soulUpdateProposals, 'nnz_soul_update_proposals', errors);
  collectUnique(snapshot.conversationMessages, 'nnz_conversation_messages', errors);
  collectUnique(snapshot.opsAuditEvents ?? [], 'nnz_ops_audit_events', errors);

  for (const persona of snapshot.personas) {
    requireUser(usersById, persona.userId, 'nnz_personas', persona.id, errors);
  }

  for (const version of snapshot.soulVersions) {
    requirePersonaScope(personasById, version, 'nnz_soul_versions', errors);
  }
  validateSingleActiveSoulVersion(snapshot.soulVersions, errors);

  for (const memory of snapshot.memoryItems) {
    requirePersonaScope(personasById, memory, 'nnz_memory_items', errors);
    validateScopedReferences(
      memory.evidenceIds,
      memoriesById,
      memory,
      'nnz_memory_items',
      memory.id,
      'MEMORY_EVIDENCE',
      errors,
    );
  }

  for (const soulSnapshot of snapshot.soulSnapshots) {
    requirePersonaScope(personasById, soulSnapshot, 'nnz_soul_snapshots', errors);
    validateScopedReference(
      soulSnapshot.soulVersionId,
      soulVersionsById,
      soulSnapshot,
      'nnz_soul_snapshots',
      soulSnapshot.id,
      'SNAPSHOT_SOUL_VERSION',
      errors,
    );
    validateScopedReferences(
      soulSnapshot.memoryIds,
      memoriesById,
      soulSnapshot,
      'nnz_soul_snapshots',
      soulSnapshot.id,
      'SNAPSHOT_MEMORY',
      errors,
    );
  }

  for (const node of snapshot.nodeEvents) {
    requirePersonaScope(personasById, node, 'nnz_node_events', errors);
  }

  for (const proposal of snapshot.soulUpdateProposals) {
    requirePersonaScope(personasById, proposal, 'nnz_soul_update_proposals', errors);
    validateScopedReferences(
      proposal.evidenceIds,
      memoriesById,
      proposal,
      'nnz_soul_update_proposals',
      proposal.id,
      'PROPOSAL_EVIDENCE',
      errors,
    );
  }

  for (const message of snapshot.conversationMessages) {
    requirePersonaScope(personasById, message, 'nnz_conversation_messages', errors);
    if (message.nodeId) {
      validateScopedReference(
        message.nodeId,
        nodesById,
        message,
        'nnz_conversation_messages',
        message.id,
        'CONVERSATION_NODE',
        errors,
      );
    }
  }

  validateSessions(snapshot.sessions, usersById, personasById, snapshotsById, nodesById, errors);
  validateCredentials(snapshot.credentials, usersById, errors);
  validateOpsAuditTargets(snapshot.opsAuditEvents ?? [], usersById, warnings);

  const tables = buildTablePlans(snapshot);
  return {
    ready: errors.length === 0,
    tableOrder: [...POSTGRES_SCOPED_MIGRATION_TABLE_ORDER],
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.count, 0),
    errors,
    warnings,
  };
}

function buildTablePlans(snapshot: StoreSnapshot): PostgresScopedMigrationTablePlan[] {
  const counts: Record<PostgresScopedMigrationTable, number> = {
    nnz_users: snapshot.users.length,
    nnz_personas: snapshot.personas.length,
    nnz_soul_versions: snapshot.soulVersions.length,
    nnz_memory_items: snapshot.memoryItems.length,
    nnz_soul_snapshots: snapshot.soulSnapshots.length,
    nnz_node_events: snapshot.nodeEvents.length,
    nnz_soul_update_proposals: snapshot.soulUpdateProposals.length,
    nnz_conversation_messages: snapshot.conversationMessages.length,
    nnz_runtime_sessions: snapshot.sessions.length,
    nnz_credentials: snapshot.credentials.length,
    nnz_ops_audit_events: (snapshot.opsAuditEvents ?? []).length,
  };
  return POSTGRES_SCOPED_MIGRATION_TABLE_ORDER.map((table) => ({ table, count: counts[table] }));
}

function collectUnique<T extends { id: string }>(
  records: T[],
  table: PostgresScopedMigrationTable,
  errors: PostgresScopedMigrationIssue[],
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const record of records) {
    if (!record.id) {
      errors.push(issue('MISSING_ID', `${table} contains a row with an empty id.`, table));
      continue;
    }
    if (byId.has(record.id)) {
      errors.push(issue('DUPLICATE_ID', `${table} contains duplicate id ${record.id}.`, table, record.id));
      continue;
    }
    byId.set(record.id, record);
  }
  return byId;
}

function requireUser(
  usersById: Map<string, User>,
  userId: string,
  table: PostgresScopedMigrationTable,
  id: string,
  errors: PostgresScopedMigrationIssue[],
): void {
  if (!usersById.has(userId)) {
    errors.push(issue('USER_MISSING', `${table} row ${id} references missing user ${userId}.`, table, id));
  }
}

function requirePersonaScope(
  personasById: Map<string, Persona>,
  record: ScopedOwner,
  table: PostgresScopedMigrationTable,
  errors: PostgresScopedMigrationIssue[],
): void {
  const persona = personasById.get(record.personaId);
  if (!persona) {
    errors.push(issue('PERSONA_MISSING', `${table} row ${record.id} references missing persona ${record.personaId}.`, table, record.id));
    return;
  }
  if (persona.userId !== record.userId) {
    errors.push(issue(
      'PERSONA_SCOPE_MISMATCH',
      `${table} row ${record.id} references persona ${record.personaId} owned by user ${persona.userId}, not ${record.userId}.`,
      table,
      record.id,
    ));
  }
}

function validateScopedReference<T extends ScopedRecord>(
  referencedId: string,
  recordsById: Map<string, T>,
  owner: ScopedOwner,
  table: PostgresScopedMigrationTable,
  id: string,
  codePrefix: string,
  errors: PostgresScopedMigrationIssue[],
): void {
  const referenced = recordsById.get(referencedId);
  if (!referenced) {
    errors.push(issue(`${codePrefix}_MISSING`, `${table} row ${id} references missing ${referencedId}.`, table, id));
    return;
  }
  if (referenced.userId !== owner.userId || referenced.personaId !== owner.personaId) {
    errors.push(issue(
      `${codePrefix}_SCOPE_MISMATCH`,
      `${table} row ${id} references ${referencedId} outside user/persona scope.`,
      table,
      id,
    ));
  }
}

function validateScopedReferences<T extends ScopedRecord>(
  referencedIds: string[],
  recordsById: Map<string, T>,
  owner: ScopedOwner,
  table: PostgresScopedMigrationTable,
  id: string,
  codePrefix: string,
  errors: PostgresScopedMigrationIssue[],
): void {
  for (const referencedId of referencedIds) {
    validateScopedReference(referencedId, recordsById, owner, table, id, codePrefix, errors);
  }
}

function validateSingleActiveSoulVersion(
  soulVersions: SoulVersion[],
  errors: PostgresScopedMigrationIssue[],
): void {
  const activeByScope = new Map<string, string>();
  for (const version of soulVersions) {
    if (version.status !== 'ACTIVE') continue;
    const scopeKey = `${version.userId}:${version.personaId}`;
    const existing = activeByScope.get(scopeKey);
    if (existing) {
      errors.push(issue(
        'MULTIPLE_ACTIVE_SOUL_VERSIONS',
        `Scope ${scopeKey} has multiple ACTIVE soul versions: ${existing}, ${version.id}.`,
        'nnz_soul_versions',
        version.id,
      ));
      continue;
    }
    activeByScope.set(scopeKey, version.id);
  }
}

function validateSessions(
  sessions: SessionSnapshot[],
  usersById: Map<string, User>,
  personasById: Map<string, Persona>,
  snapshotsById: Map<string, SoulSnapshot>,
  nodesById: Map<string, NodeEvent>,
  errors: PostgresScopedMigrationIssue[],
): void {
  const sessionsByScope = new Set<string>();
  for (const session of sessions) {
    const table = 'nnz_runtime_sessions';
    const sessionId = session.scopeKey;
    const sessionOwner = sessionRecord(session);
    const nodeId = session.nodeId ?? session.nodeContext?.nodeId;
    const nodeName = session.nodeName ?? session.nodeContext?.nodeName;
    requireUser(usersById, session.userId, table, sessionId, errors);
    requirePersonaScope(personasById, sessionOwner, table, errors);

    if (!RUNTIME_STATES.has(session.state)) {
      errors.push(issue('SESSION_STATE_INVALID', `Session ${sessionId} has invalid state ${session.state}.`, table, sessionId));
    }

    const expectedScopeKey = `${session.userId}:${session.personaId}`;
    if (session.scopeKey !== expectedScopeKey) {
      errors.push(issue(
        'SESSION_SCOPE_KEY_MISMATCH',
        `Session ${sessionId} should use scope key ${expectedScopeKey}.`,
        table,
        sessionId,
      ));
    }
    if (sessionsByScope.has(expectedScopeKey)) {
      errors.push(issue('DUPLICATE_SESSION_SCOPE', `Multiple sessions target scope ${expectedScopeKey}.`, table, sessionId));
    }
    sessionsByScope.add(expectedScopeKey);

    if (session.soulSnapshotId) {
      validateScopedReference(
        session.soulSnapshotId,
        snapshotsById,
        sessionOwner,
        table,
        sessionId,
        'SESSION_SNAPSHOT',
        errors,
      );
    } else if (session.state === 'NODE') {
      errors.push(issue('SESSION_NODE_SNAPSHOT_MISSING', `NODE session ${sessionId} is missing soulSnapshotId.`, table, sessionId));
    }

    if (nodeId) {
      validateScopedReference(nodeId, nodesById, sessionOwner, table, sessionId, 'SESSION_NODE', errors);
    } else if (session.state === 'NODE') {
      errors.push(issue('SESSION_NODE_MISSING', `NODE session ${sessionId} is missing nodeId.`, table, sessionId));
    }

    if (session.state === 'NODE' && !nodeName) {
      errors.push(issue('SESSION_NODE_NAME_MISSING', `NODE session ${sessionId} is missing nodeName.`, table, sessionId));
    }
  }
}

function validateCredentials(
  credentials: CredentialSnapshot[],
  usersById: Map<string, User>,
  errors: PostgresScopedMigrationIssue[],
): void {
  const usersSeen = new Set<string>();
  const emailsSeen = new Set<string>();
  for (const credential of credentials) {
    const table = 'nnz_credentials';
    requireUser(usersById, credential.userId, table, credential.userId, errors);
    if (usersSeen.has(credential.userId)) {
      errors.push(issue('DUPLICATE_CREDENTIAL_USER', `Multiple credentials target user ${credential.userId}.`, table, credential.userId));
    }
    usersSeen.add(credential.userId);
    if (emailsSeen.has(credential.email)) {
      errors.push(issue('DUPLICATE_CREDENTIAL_EMAIL', `Multiple credentials use email ${credential.email}.`, table, credential.userId));
    }
    emailsSeen.add(credential.email);
  }
}

function validateOpsAuditTargets(
  opsAuditEvents: StoreSnapshot['opsAuditEvents'],
  usersById: Map<string, User>,
  warnings: PostgresScopedMigrationIssue[],
): void {
  for (const event of opsAuditEvents) {
    for (const targetUserId of event.targetUserIds) {
      if (!usersById.has(targetUserId)) {
        warnings.push(issue(
          'OPS_AUDIT_TARGET_USER_MISSING',
          `Ops audit event ${event.id} references missing target user ${targetUserId}.`,
          'nnz_ops_audit_events',
          event.id,
        ));
      }
    }
  }
}

function sessionRecord(session: SessionSnapshot): ScopedOwner {
  return {
    id: session.scopeKey,
    userId: session.userId,
    personaId: session.personaId,
  };
}

function issue(
  code: string,
  message: string,
  table?: PostgresScopedMigrationTable,
  id?: string,
): PostgresScopedMigrationIssue {
  const result: PostgresScopedMigrationIssue = { code, message };
  if (table) result.table = table;
  if (id) result.id = id;
  return result;
}
