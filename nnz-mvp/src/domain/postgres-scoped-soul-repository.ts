import { randomUUID } from 'node:crypto';

import pg from 'pg';

import type { CredentialRecord } from '../auth/auth';
import { CovenantStateError, NotFoundError, OwnershipError, ScopeValidationError } from './errors';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  OpsAuditAction,
  OpsAuditEvent,
  OpsAuditOutcome,
  Persona,
  PersonaType,
  RuntimeSession,
  SoulSnapshot,
  SoulUpdateProposal,
  SoulVersion,
  User,
  UserPersonaScope,
} from './types';
import type {
  AddConversationInput,
  AddMemoryInput,
  CreateNodeInput,
  CreateSoulUpdateProposalInput,
  CreateSoulVersionInput,
} from './soul-store';

const { Pool } = pg;

const POSTGRES_SCOPED_SCHEMA = `
CREATE TABLE IF NOT EXISTS nnz_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS nnz_personas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES nnz_users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_nnz_personas_user_created
  ON nnz_personas (user_id, created_at, id);

CREATE TABLE IF NOT EXISTS nnz_memory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  sensitivity TEXT NOT NULL,
  enabled_for_soul BOOLEAN NOT NULL,
  enabled_for_runtime BOOLEAN NOT NULL,
  enabled_for_soul_update BOOLEAN NOT NULL,
  evidence_ids JSONB NOT NULL,
  created_by TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nnz_memory_scope_created
  ON nnz_memory_items (user_id, persona_id, created_at, id);

CREATE TABLE IF NOT EXISTS nnz_soul_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kernel_json JSONB NOT NULL,
  status TEXT NOT NULL,
  knowledge_cutoff TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, persona_id, id),
  UNIQUE (user_id, persona_id, version),
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nnz_soul_versions_scope_version
  ON nnz_soul_versions (user_id, persona_id, version);

CREATE INDEX IF NOT EXISTS idx_nnz_soul_versions_scope_status
  ON nnz_soul_versions (user_id, persona_id, status, version);

CREATE TABLE IF NOT EXISTS nnz_soul_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  soul_version_id TEXT NOT NULL,
  kernel_json JSONB NOT NULL,
  memory_ids JSONB NOT NULL,
  sealed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, persona_id, id),
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, persona_id, soul_version_id)
    REFERENCES nnz_soul_versions (user_id, persona_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nnz_soul_snapshots_scope_sealed
  ON nnz_soul_snapshots (user_id, persona_id, sealed_at, id);

CREATE TABLE IF NOT EXISTS nnz_node_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, persona_id, id),
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nnz_node_events_scope_start
  ON nnz_node_events (user_id, persona_id, start_at, id);

CREATE TABLE IF NOT EXISTS nnz_soul_update_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  old_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  evidence_ids JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nnz_soul_update_proposals_scope_status
  ON nnz_soul_update_proposals (user_id, persona_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS nnz_conversation_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  node_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nnz_conversation_scope_created
  ON nnz_conversation_messages (user_id, persona_id, created_at, id);

CREATE TABLE IF NOT EXISTS nnz_runtime_sessions (
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  state TEXT NOT NULL,
  soul_snapshot_id TEXT,
  node_id TEXT,
  node_name TEXT,
  daily_message_count INTEGER,
  last_message_date TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, persona_id),
  FOREIGN KEY (user_id, persona_id) REFERENCES nnz_personas (user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nnz_credentials (
  user_id TEXT PRIMARY KEY REFERENCES nnz_users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nnz_credentials_email
  ON nnz_credentials (email);

CREATE TABLE IF NOT EXISTS nnz_ops_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_user_ids JSONB NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nnz_ops_audit_created
  ON nnz_ops_audit_events (created_at DESC, id);
`;

type OptionalScope = Partial<UserPersonaScope> | undefined;

export interface QueryableClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface QueryablePool extends QueryableClient {
  end(): Promise<void>;
}

export interface CreatePersonaRowInput {
  userId: string;
  displayName: string;
  relationship: string;
  type: PersonaType;
}

export type PostgresScopedAddMemoryInput = Omit<AddMemoryInput, 'userId' | 'personaId'>;
export type PostgresScopedAddConversationInput = Omit<AddConversationInput, 'userId' | 'personaId'>;
export type PostgresScopedCreateSoulVersionInput = Omit<CreateSoulVersionInput, 'userId' | 'personaId'>;
export type PostgresScopedCreateNodeInput = Omit<CreateNodeInput, 'userId' | 'personaId'>;
export type PostgresScopedCreateSoulUpdateProposalInput = Omit<
  CreateSoulUpdateProposalInput,
  'userId' | 'personaId'
>;

interface RecordOpsAuditEventInput {
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor?: string;
  targetUserIds?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export class PostgresScopedSoulRepository {
  private readonly scopeValue: UserPersonaScope;

  constructor(
    private readonly pool: QueryableClient,
    scopeInput: OptionalScope,
  ) {
    this.scopeValue = requireBoundScope(scopeInput);
  }

  get scope(): UserPersonaScope {
    return { ...this.scopeValue };
  }

  async ensureBoundPersona(): Promise<Persona> {
    return this.getPersona();
  }

  async getPersona(): Promise<Persona> {
    return getPersonaForUser(this.pool, this.scopeValue);
  }

  async createSoulVersion(input: PostgresScopedCreateSoulVersionInput): Promise<SoulVersion> {
    await this.ensureBoundPersona();
    const status = input.status ?? 'ACTIVE';

    if (status === 'ACTIVE') {
      await this.pool.query(
        `UPDATE nnz_soul_versions
         SET status = 'ARCHIVED'
         WHERE user_id = $1 AND persona_id = $2 AND status = 'ACTIVE'`,
        [this.scopeValue.userId, this.scopeValue.personaId],
      );
    }

    const versionNumber = await this.nextSoulVersionNumber();
    const soulVersion = createSoulVersion({ ...input, ...this.scopeValue }, versionNumber);
    await this.pool.query(
      `INSERT INTO nnz_soul_versions (
        id, user_id, persona_id, version, kernel_json, status, knowledge_cutoff, created_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7, $8
      )`,
      [
        soulVersion.id,
        soulVersion.userId,
        soulVersion.personaId,
        soulVersion.version,
        JSON.stringify(soulVersion.kernelJson),
        soulVersion.status,
        soulVersion.knowledgeCutoff ?? null,
        soulVersion.createdAt,
      ],
    );
    return soulVersion;
  }

  async getLatestSoulVersion(): Promise<SoulVersion> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<SoulVersionRow>(
      `SELECT *
       FROM nnz_soul_versions
       WHERE user_id = $1 AND persona_id = $2 AND status = 'ACTIVE'
       ORDER BY version DESC
       LIMIT 1`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError(
        `No ACTIVE soul version found for user ${this.scopeValue.userId} and persona ${this.scopeValue.personaId}.`,
      );
    }
    return mapSoulVersionRow(row);
  }

  async listSoulVersions(): Promise<SoulVersion[]> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<SoulVersionRow>(
      `SELECT *
       FROM nnz_soul_versions
       WHERE user_id = $1 AND persona_id = $2
       ORDER BY version ASC`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return result.rows.map(mapSoulVersionRow);
  }

  async createSoulSnapshot(): Promise<SoulSnapshot> {
    await this.ensureBoundPersona();
    const soulVersion = await this.getLatestSoulVersion();
    const memories = await this.listMemory();
    const snapshot = createSoulSnapshot(this.scopeValue, soulVersion, memories);
    await this.pool.query(
      `INSERT INTO nnz_soul_snapshots (
        id, user_id, persona_id, soul_version_id, kernel_json, memory_ids, sealed_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7
      )`,
      [
        snapshot.id,
        snapshot.userId,
        snapshot.personaId,
        snapshot.soulVersionId,
        JSON.stringify(snapshot.kernelJson),
        JSON.stringify(snapshot.memoryIds),
        snapshot.sealedAt,
      ],
    );
    return snapshot;
  }

  async getSoulSnapshot(snapshotId: string): Promise<SoulSnapshot> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<SoulSnapshotRow>(
      `SELECT *
       FROM nnz_soul_snapshots
       WHERE user_id = $1 AND persona_id = $2 AND id = $3`,
      [this.scopeValue.userId, this.scopeValue.personaId, snapshotId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError(`Soul snapshot ${snapshotId} was not found in the requested user/persona scope.`);
    }
    return mapSoulSnapshotRow(row);
  }

  async listSoulSnapshots(): Promise<SoulSnapshot[]> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<SoulSnapshotRow>(
      `SELECT *
       FROM nnz_soul_snapshots
       WHERE user_id = $1 AND persona_id = $2
       ORDER BY sealed_at ASC, id ASC`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return result.rows.map(mapSoulSnapshotRow);
  }

  async addMemory(input: PostgresScopedAddMemoryInput): Promise<MemoryItem> {
    await this.ensureBoundPersona();
    const memory = createMemory({ ...input, ...this.scopeValue });
    await this.pool.query(
      `INSERT INTO nnz_memory_items (
        id, user_id, persona_id, type, source, content, confidence, sensitivity,
        enabled_for_soul, enabled_for_runtime, enabled_for_soul_update,
        evidence_ids, created_by, state, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12::jsonb, $13, $14, $15
      )`,
      [
        memory.id,
        memory.userId,
        memory.personaId,
        memory.type,
        memory.source,
        memory.content,
        memory.confidence,
        memory.sensitivity,
        memory.enabledForSoul,
        memory.enabledForRuntime,
        memory.enabledForSoulUpdate,
        JSON.stringify(memory.evidenceIds),
        memory.createdBy,
        memory.state,
        memory.createdAt,
      ],
    );
    return memory;
  }

  async listMemory(): Promise<MemoryItem[]> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<MemoryRow>(
      `SELECT *
       FROM nnz_memory_items
       WHERE user_id = $1 AND persona_id = $2
       ORDER BY created_at ASC, id ASC`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return result.rows.map(mapMemoryRow);
  }

  async listRuntimeMemory(): Promise<MemoryItem[]> {
    return (await this.listMemory()).filter(
      (memory) => memory.state === 'ACTIVE'
        && memory.enabledForRuntime
        && memory.type !== 'RISK'
        && memory.sensitivity !== 'RESTRICTED',
    );
  }

  async listSoulUpdateMemory(): Promise<MemoryItem[]> {
    return (await this.listMemory()).filter(
      (memory) => memory.state === 'ACTIVE'
        && memory.enabledForSoulUpdate
        && memory.type !== 'NODE_MEMORY'
        && memory.type !== 'RISK'
        && memory.sensitivity !== 'RESTRICTED',
    );
  }

  async createSoulUpdateProposal(
    input: PostgresScopedCreateSoulUpdateProposalInput,
  ): Promise<SoulUpdateProposal> {
    await this.ensureBoundPersona();
    requireAllowedSoulFieldPath(input.fieldPath);
    await this.requireSoulUpdateEvidence(input.evidenceIds);
    const latest = await this.getLatestSoulVersion();
    const proposal = createSoulUpdateProposal({ ...input, ...this.scopeValue }, latest);
    await this.pool.query(
      `INSERT INTO nnz_soul_update_proposals (
        id, user_id, persona_id, field_path, old_value, new_value, evidence_ids, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9
      )`,
      [
        proposal.id,
        proposal.userId,
        proposal.personaId,
        proposal.fieldPath,
        JSON.stringify(proposal.oldValue),
        JSON.stringify(proposal.newValue),
        JSON.stringify(proposal.evidenceIds),
        proposal.status,
        proposal.createdAt,
      ],
    );
    return proposal;
  }

  async listSoulUpdateProposals(status?: SoulUpdateProposal['status']): Promise<SoulUpdateProposal[]> {
    await this.ensureBoundPersona();
    const result = status
      ? await this.pool.query<SoulUpdateProposalRow>(
        `SELECT *
         FROM nnz_soul_update_proposals
         WHERE user_id = $1 AND persona_id = $2 AND status = $3
         ORDER BY created_at ASC, id ASC`,
        [this.scopeValue.userId, this.scopeValue.personaId, status],
      )
      : await this.pool.query<SoulUpdateProposalRow>(
        `SELECT *
         FROM nnz_soul_update_proposals
         WHERE user_id = $1 AND persona_id = $2
         ORDER BY created_at ASC, id ASC`,
        [this.scopeValue.userId, this.scopeValue.personaId],
      );
    return result.rows.map(mapSoulUpdateProposalRow);
  }

  async listSoulUpdateProposalEvidence(proposalId: string): Promise<MemoryItem[]> {
    const proposal = await this.requireSoulUpdateProposal(proposalId);
    const memories = await this.listMemory();
    const byId = new Map(memories.map((memory) => [memory.id, memory]));
    return proposal.evidenceIds.map((evidenceId) => {
      const memory = byId.get(evidenceId);
      if (!memory) {
        throw new NotFoundError(`Memory ${evidenceId} was not found in the requested user/persona scope.`);
      }
      return memory;
    });
  }

  async acceptSoulUpdateProposal(proposalId: string): Promise<SoulVersion> {
    const proposal = await this.requireSoulUpdateProposal(proposalId);
    if (proposal.status !== 'PENDING') {
      throw new Error(`Soul update proposal ${proposalId} is already ${proposal.status}.`);
    }

    const latest = await this.getLatestSoulVersion();
    const nextKernel = cloneJson(latest.kernelJson);
    setByPath(nextKernel, proposal.fieldPath, cloneJsonValue(proposal.newValue));

    await this.pool.query(
      `UPDATE nnz_soul_update_proposals
       SET status = 'ACCEPTED'
       WHERE user_id = $1 AND persona_id = $2 AND id = $3 AND status = 'PENDING'`,
      [this.scopeValue.userId, this.scopeValue.personaId, proposalId],
    );

    return this.createSoulVersion({
      kernelJson: nextKernel,
      status: 'ACTIVE',
    });
  }

  async rejectSoulUpdateProposal(proposalId: string): Promise<SoulUpdateProposal> {
    const proposal = await this.requireSoulUpdateProposal(proposalId);
    if (proposal.status !== 'PENDING') {
      throw new Error(`Soul update proposal ${proposalId} is already ${proposal.status}.`);
    }

    await this.pool.query(
      `UPDATE nnz_soul_update_proposals
       SET status = 'REJECTED'
       WHERE user_id = $1 AND persona_id = $2 AND id = $3 AND status = 'PENDING'`,
      [this.scopeValue.userId, this.scopeValue.personaId, proposalId],
    );

    return {
      ...proposal,
      status: 'REJECTED',
    };
  }

  async addConversation(input: PostgresScopedAddConversationInput): Promise<ConversationMessage> {
    await this.ensureBoundPersona();
    if (input.nodeId) {
      await this.requireNodeOwnership(input.nodeId);
    }
    const message = createConversation({ ...input, ...this.scopeValue });
    await this.pool.query(
      `INSERT INTO nnz_conversation_messages (
        id, user_id, persona_id, node_id, role, content, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      )`,
      [
        message.id,
        message.userId,
        message.personaId,
        message.nodeId ?? null,
        message.role,
        message.content,
        message.createdAt,
      ],
    );
    return message;
  }

  async listConversations(): Promise<ConversationMessage[]> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<ConversationRow>(
      `SELECT *
       FROM nnz_conversation_messages
       WHERE user_id = $1 AND persona_id = $2
       ORDER BY created_at ASC, id ASC`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return result.rows.map(mapConversationRow);
  }

  async createNode(input: PostgresScopedCreateNodeInput): Promise<NodeEvent> {
    await this.ensureBoundPersona();
    const node = createNode({ ...input, ...this.scopeValue });
    await this.pool.query(
      `INSERT INTO nnz_node_events (
        id, user_id, persona_id, name, status, start_at, end_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      )`,
      [
        node.id,
        node.userId,
        node.personaId,
        node.name,
        node.status,
        node.startAt,
        node.endAt,
      ],
    );
    return node;
  }

  async listNodes(): Promise<NodeEvent[]> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<NodeEventRow>(
      `SELECT *
       FROM nnz_node_events
       WHERE user_id = $1 AND persona_id = $2
       ORDER BY start_at ASC, id ASC`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return result.rows.map(mapNodeEventRow);
  }

  async getRuntimeSession(): Promise<RuntimeSession> {
    await this.ensureBoundPersona();
    const existing = await this.getRuntimeSessionRow();
    if (existing) {
      return mapRuntimeSessionRow(existing);
    }

    const fresh: RuntimeSession = {
      userId: this.scopeValue.userId,
      personaId: this.scopeValue.personaId,
      state: 'ACTIVE',
      dailyMessageCount: 0,
      lastMessageDate: todayString(),
    };
    await this.setSession(fresh);
    return fresh;
  }

  async updateRuntimeUsage(input: { dailyMessageCount: number; lastMessageDate: string }): Promise<RuntimeSession> {
    await this.ensureBoundPersona();
    const current = await this.getRuntimeSession();
    const session: RuntimeSession = {
      ...current,
      dailyMessageCount: input.dailyMessageCount,
      lastMessageDate: input.lastMessageDate,
    };
    await this.setSession(session);
    return session;
  }

  async sealSoul(): Promise<{ snapshot: SoulSnapshot; session: RuntimeSession }> {
    await this.ensureBoundPersona();
    const current = await this.getRuntimeSession();
    if (current.state !== 'ACTIVE') {
      throw new CovenantStateError(current.state);
    }

    const snapshot = await this.createSoulSnapshot();
    await this.pool.query(
      `UPDATE nnz_soul_versions
       SET status = 'ARCHIVED'
       WHERE user_id = $1 AND persona_id = $2 AND id = $3`,
      [this.scopeValue.userId, this.scopeValue.personaId, snapshot.soulVersionId],
    );

    const session: RuntimeSession = {
      userId: this.scopeValue.userId,
      personaId: this.scopeValue.personaId,
      state: 'SEALED',
      soulSnapshotId: snapshot.id,
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    await this.setSession(session);
    return { snapshot, session };
  }

  async activateNode(nodeName: string, durationDays?: number): Promise<{ node: NodeEvent; session: RuntimeSession }> {
    await this.ensureBoundPersona();
    const current = await this.getRuntimeSession();
    if (current.state !== 'SEALED') {
      throw new CovenantStateError(current.state);
    }

    const node = await this.findReusableNode(nodeName) ?? await this.createNode({
      name: nodeName,
      ...(durationDays === undefined ? {} : { durationDays }),
    });
    await this.addNodeMemoryIfMissing(nodeName);

    const session: RuntimeSession = {
      userId: this.scopeValue.userId,
      personaId: this.scopeValue.personaId,
      state: 'NODE',
      soulSnapshotId: current.soulSnapshotId!,
      nodeContext: {
        nodeId: node.id,
        nodeName,
      },
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    await this.setSession(session);
    return { node, session };
  }

  async completeNode(): Promise<RuntimeSession> {
    await this.ensureBoundPersona();
    const current = await this.getRuntimeSession();
    if (current.state !== 'NODE') {
      throw new CovenantStateError(current.state);
    }
    if (!current.nodeContext) {
      throw new Error('NODE session is missing nodeContext.');
    }

    await this.pool.query(
      `UPDATE nnz_node_events
       SET status = 'COMPLETED'
       WHERE user_id = $1 AND persona_id = $2 AND id = $3`,
      [this.scopeValue.userId, this.scopeValue.personaId, current.nodeContext.nodeId],
    );

    const session: RuntimeSession = {
      userId: this.scopeValue.userId,
      personaId: this.scopeValue.personaId,
      state: 'SEALED',
      soulSnapshotId: current.soulSnapshotId!,
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    await this.setSession(session);
    return session;
  }

  async graduateSoul(): Promise<RuntimeSession> {
    await this.ensureBoundPersona();
    const current = await this.getRuntimeSession();
    if (current.state === 'GRADUATED') {
      throw new CovenantStateError(current.state);
    }

    await this.pool.query(
      `UPDATE nnz_soul_versions
       SET status = 'GRADUATED'
       WHERE user_id = $1 AND persona_id = $2`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );

    const session: RuntimeSession = {
      userId: this.scopeValue.userId,
      personaId: this.scopeValue.personaId,
      state: 'GRADUATED',
      dailyMessageCount: current.dailyMessageCount ?? 0,
      lastMessageDate: current.lastMessageDate ?? todayString(),
    };
    await this.setSession(session);
    return session;
  }

  async storeCredential(userId: string, email: string, passwordHash: string): Promise<void> {
    await requirePostgresUser(this.pool, userId);
    await this.pool.query(
      `INSERT INTO nnz_credentials (user_id, email, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         created_at = EXCLUDED.created_at`,
      [userId, email, passwordHash, new Date()],
    );
  }

  async getCredentialByEmail(email: string): Promise<CredentialRecord | undefined> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT *
       FROM nnz_credentials
       WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row ? mapCredentialRow(row) : undefined;
  }

  async recordOpsAuditEvent(input: RecordOpsAuditEventInput): Promise<OpsAuditEvent> {
    const event = createOpsAuditEvent(input);
    await this.pool.query(
      `INSERT INTO nnz_ops_audit_events (
        id, action, outcome, actor, target_user_ids, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7
      )`,
      [
        event.id,
        event.action,
        event.outcome,
        event.actor,
        JSON.stringify(event.targetUserIds),
        JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
    return event;
  }

  async listOpsAuditEvents(limit?: number): Promise<OpsAuditEvent[]> {
    const result = limit === undefined
      ? await this.pool.query<OpsAuditEventRow>(
        `SELECT *
         FROM nnz_ops_audit_events
         ORDER BY created_at DESC, id DESC`,
      )
      : await this.pool.query<OpsAuditEventRow>(
        `SELECT *
         FROM nnz_ops_audit_events
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        [limit],
      );
    return result.rows.map(mapOpsAuditEventRow);
  }

  private async nextSoulVersionNumber(): Promise<number> {
    const result = await this.pool.query<{ next_version: number | string }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM nnz_soul_versions
       WHERE user_id = $1 AND persona_id = $2`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return Number(result.rows[0]?.next_version ?? 1);
  }

  private async requireNodeOwnership(nodeId: string): Promise<NodeEvent> {
    const result = await this.pool.query<NodeEventRow>(
      `SELECT *
       FROM nnz_node_events
       WHERE user_id = $1 AND persona_id = $2 AND id = $3`,
      [this.scopeValue.userId, this.scopeValue.personaId, nodeId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new OwnershipError(`Node ${nodeId} does not belong to the requested user/persona scope.`);
    }
    return mapNodeEventRow(row);
  }

  private async requireSoulUpdateEvidence(evidenceIds: string[]): Promise<void> {
    const allowedIds = new Set((await this.listSoulUpdateMemory()).map((memory) => memory.id));
    for (const evidenceId of evidenceIds) {
      if (!allowedIds.has(evidenceId)) {
        throw new OwnershipError(`Memory ${evidenceId} is not allowed as Soul update evidence in this scope.`);
      }
    }
  }

  private async requireSoulUpdateProposal(proposalId: string): Promise<SoulUpdateProposal> {
    await this.ensureBoundPersona();
    const result = await this.pool.query<SoulUpdateProposalRow>(
      `SELECT *
       FROM nnz_soul_update_proposals
       WHERE user_id = $1 AND persona_id = $2 AND id = $3`,
      [this.scopeValue.userId, this.scopeValue.personaId, proposalId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError(`Soul update proposal ${proposalId} was not found in the requested user/persona scope.`);
    }
    return mapSoulUpdateProposalRow(row);
  }

  private async findReusableNode(nodeName: string): Promise<NodeEvent | undefined> {
    const result = await this.pool.query<NodeEventRow>(
      `SELECT *
       FROM nnz_node_events
       WHERE user_id = $1 AND persona_id = $2 AND name = $3 AND status = 'ACTIVE'
       ORDER BY start_at ASC, id ASC
       LIMIT 1`,
      [this.scopeValue.userId, this.scopeValue.personaId, nodeName],
    );
    const row = result.rows[0];
    return row ? mapNodeEventRow(row) : undefined;
  }

  private async addNodeMemoryIfMissing(nodeName: string): Promise<void> {
    const content = `节点「${nodeName}」已激活。`;
    const memories = await this.listMemory();
    const exists = memories.some((memory) => memory.type === 'NODE_MEMORY' && memory.content === content);
    if (exists) {
      return;
    }
    await this.addMemory({
      type: 'NODE_MEMORY',
      content,
      confidence: 1,
      enabledForSoul: false,
    });
  }

  private async getRuntimeSessionRow(): Promise<RuntimeSessionRow | undefined> {
    const result = await this.pool.query<RuntimeSessionRow>(
      `SELECT *
       FROM nnz_runtime_sessions
       WHERE user_id = $1 AND persona_id = $2`,
      [this.scopeValue.userId, this.scopeValue.personaId],
    );
    return result.rows[0];
  }

  private async setSession(session: RuntimeSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO nnz_runtime_sessions (
        user_id, persona_id, state, soul_snapshot_id, node_id, node_name,
        daily_message_count, last_message_date, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      ON CONFLICT (user_id, persona_id) DO UPDATE SET
        state = EXCLUDED.state,
        soul_snapshot_id = EXCLUDED.soul_snapshot_id,
        node_id = EXCLUDED.node_id,
        node_name = EXCLUDED.node_name,
        daily_message_count = EXCLUDED.daily_message_count,
        last_message_date = EXCLUDED.last_message_date,
        updated_at = EXCLUDED.updated_at`,
      [
        session.userId,
        session.personaId,
        session.state,
        session.soulSnapshotId ?? null,
        session.nodeContext?.nodeId ?? null,
        session.nodeContext?.nodeName ?? null,
        session.dailyMessageCount ?? null,
        session.lastMessageDate ?? null,
        new Date(),
      ],
    );
  }
}

export async function ensurePostgresScopedSchema(pool: QueryableClient): Promise<void> {
  await pool.query(POSTGRES_SCOPED_SCHEMA);
}

export function createPostgresScopedSoulRepository(
  connectionString: string,
  scopeInput: OptionalScope,
  poolFactory: (connectionString: string) => QueryablePool = createPool,
): PostgresScopedSoulRepository {
  return new PostgresScopedSoulRepository(poolFactory(connectionString), scopeInput);
}

export function createPostgresScopedSoulRepositoryFromPool(
  pool: QueryableClient,
  scopeInput: OptionalScope,
): PostgresScopedSoulRepository {
  return new PostgresScopedSoulRepository(pool, scopeInput);
}

export async function createPostgresUser(
  pool: QueryableClient,
  displayName: string,
  id = createId('user'),
): Promise<User> {
  const user: User = {
    id,
    displayName,
    createdAt: new Date(),
  };
  await pool.query(
    `INSERT INTO nnz_users (id, display_name, created_at)
     VALUES ($1, $2, $3)`,
    [user.id, user.displayName, user.createdAt],
  );
  return user;
}

export async function createPostgresPersona(
  pool: QueryableClient,
  input: CreatePersonaRowInput,
  id = createId('persona'),
): Promise<Persona> {
  await requirePostgresUser(pool, input.userId);
  const persona: Persona = {
    id,
    userId: input.userId,
    displayName: input.displayName,
    relationship: input.relationship,
    type: input.type,
    createdAt: new Date(),
  };
  await pool.query(
    `INSERT INTO nnz_personas (id, user_id, display_name, relationship, type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      persona.id,
      persona.userId,
      persona.displayName,
      persona.relationship,
      persona.type,
      persona.createdAt,
    ],
  );
  return persona;
}

export async function listPostgresPersonasForUser(
  pool: QueryableClient,
  userId: string,
): Promise<Persona[]> {
  await requirePostgresUser(pool, userId);
  const result = await pool.query<PersonaRow>(
    `SELECT *
     FROM nnz_personas
     WHERE user_id = $1
     ORDER BY created_at ASC, id ASC`,
    [userId],
  );
  return result.rows.map(mapPersonaRow);
}

async function requirePostgresUser(pool: QueryableClient, userId: string): Promise<User> {
  const result = await pool.query<UserRow>(
    'SELECT * FROM nnz_users WHERE id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError(`User ${userId} was not found.`);
  }
  return mapUserRow(row);
}

async function getPersonaForUser(pool: QueryableClient, scope: UserPersonaScope): Promise<Persona> {
  await requirePostgresUser(pool, scope.userId);
  const result = await pool.query<PersonaRow>(
    `SELECT *
     FROM nnz_personas
     WHERE user_id = $1 AND id = $2`,
    [scope.userId, scope.personaId],
  );
  const row = result.rows[0];
  if (!row) {
    const exists = await pool.query<{ id: string }>(
      'SELECT id FROM nnz_personas WHERE id = $1',
      [scope.personaId],
    );
    if (exists.rows[0]) {
      throw new OwnershipError(`Persona ${scope.personaId} does not belong to user ${scope.userId}.`);
    }
    throw new NotFoundError(`Persona ${scope.personaId} was not found.`);
  }
  return mapPersonaRow(row);
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

function requireBoundScope(scopeInput: OptionalScope): UserPersonaScope {
  if (!scopeInput?.userId || !scopeInput.personaId) {
    throw new ScopeValidationError('PostgresScopedSoulRepository requires both userId and personaId.');
  }
  return {
    userId: scopeInput.userId,
    personaId: scopeInput.personaId,
  };
}

function createMemory(input: AddMemoryInput): MemoryItem {
  requireConfidence(input.confidence);

  return {
    id: createId('memory'),
    userId: input.userId,
    personaId: input.personaId,
    type: input.type,
    source: input.source ?? defaultMemorySource(input.type),
    content: input.content,
    confidence: input.confidence,
    sensitivity: input.sensitivity ?? defaultMemorySensitivity(input.type),
    enabledForSoul: input.enabledForSoul,
    enabledForRuntime: input.enabledForRuntime ?? defaultEnabledForRuntime(input.type, input.enabledForSoul),
    enabledForSoulUpdate: input.enabledForSoulUpdate ?? defaultEnabledForSoulUpdate(input.type, input.enabledForSoul),
    evidenceIds: [...(input.evidenceIds ?? [])],
    createdBy: input.createdBy ?? defaultCreatedBy(input.type),
    state: input.state ?? 'ACTIVE',
    createdAt: new Date(),
  };
}

function createSoulVersion(input: CreateSoulVersionInput, versionNumber: number): SoulVersion {
  const soulVersion: SoulVersion = {
    id: createId('soul'),
    userId: input.userId,
    personaId: input.personaId,
    version: versionNumber,
    kernelJson: cloneJson(input.kernelJson),
    status: input.status ?? 'ACTIVE',
    createdAt: new Date(),
  };
  return soulVersion;
}

function createSoulSnapshot(
  scope: UserPersonaScope,
  soulVersion: SoulVersion,
  memories: MemoryItem[],
): SoulSnapshot {
  return {
    id: createId('snapshot'),
    userId: scope.userId,
    personaId: scope.personaId,
    soulVersionId: soulVersion.id,
    kernelJson: cloneJson(soulVersion.kernelJson),
    memoryIds: memories.map((memory) => memory.id),
    sealedAt: new Date(),
  };
}

function createSoulUpdateProposal(
  input: CreateSoulUpdateProposalInput,
  latest: SoulVersion,
): SoulUpdateProposal {
  return {
    id: createId('proposal'),
    userId: input.userId,
    personaId: input.personaId,
    fieldPath: input.fieldPath,
    oldValue: cloneJsonValue(getByPath(latest.kernelJson, input.fieldPath)),
    newValue: cloneJsonValue(input.newValue),
    evidenceIds: [...input.evidenceIds],
    status: 'PENDING',
    createdAt: new Date(),
  };
}

function createConversation(input: AddConversationInput): ConversationMessage {
  const message: ConversationMessage = {
    id: createId('message'),
    userId: input.userId,
    personaId: input.personaId,
    role: input.role,
    content: input.content,
    createdAt: new Date(),
  };
  if (input.nodeId) {
    message.nodeId = input.nodeId;
  }
  return message;
}

function createNode(input: CreateNodeInput): NodeEvent {
  const startAt = new Date();
  const endAt = new Date(startAt);
  endAt.setDate(endAt.getDate() + (input.durationDays ?? 3));

  return {
    id: createId('node'),
    userId: input.userId,
    personaId: input.personaId,
    name: input.name,
    status: 'ACTIVE',
    startAt,
    endAt,
  };
}

function createOpsAuditEvent(input: RecordOpsAuditEventInput): OpsAuditEvent {
  return {
    id: createId('ops_audit'),
    action: input.action,
    outcome: input.outcome,
    actor: input.actor ?? 'ops-token',
    targetUserIds: [...new Set(input.targetUserIds ?? [])],
    metadata: cloneMetadata(input.metadata ?? {}),
    createdAt: new Date(),
  };
}

function requireAllowedSoulFieldPath(fieldPath: string): void {
  const allowed = new Set([
    'affectModel.humorLevel',
    'languageModel.petPhrases',
    'identityCore.relationship',
  ]);
  if (!allowed.has(fieldPath)) {
    throw new Error(`Soul update fieldPath "${fieldPath}" is not allowed.`);
  }
}

function defaultMemorySource(type: MemoryItem['type']): MemoryItem['source'] {
  switch (type) {
    case 'CHAT_EXCERPT':
      return 'CONVERSATION';
    case 'CORRECTION':
      return 'CORRECTION';
    case 'NODE_MEMORY':
      return 'NODE';
    case 'RISK':
      return 'SYSTEM';
    default:
      return 'USER_INPUT';
  }
}

function defaultMemorySensitivity(type: MemoryItem['type']): MemoryItem['sensitivity'] {
  if (type === 'RISK') return 'RESTRICTED';
  if (type === 'USER_CHRONICLE') return 'MEDIUM';
  return 'LOW';
}

function defaultEnabledForRuntime(type: MemoryItem['type'], enabledForSoul: boolean): boolean {
  if (type === 'RISK') return false;
  if (type === 'NODE_MEMORY') return true;
  return enabledForSoul;
}

function defaultEnabledForSoulUpdate(type: MemoryItem['type'], enabledForSoul: boolean): boolean {
  if (type === 'CORRECTION') return enabledForSoul;
  if (type === 'DESCRIPTION' || type === 'CHAT_EXCERPT' || type === 'USER_CHRONICLE') return enabledForSoul;
  return false;
}

function defaultCreatedBy(type: MemoryItem['type']): MemoryItem['createdBy'] {
  return type === 'RISK' ? 'SYSTEM' : 'USER';
}

function requireConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError('Memory confidence must be a number between 0 and 1.');
  }
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function cloneJson(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value));
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function cloneMetadata(
  value: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return JSON.parse(JSON.stringify(value));
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

interface UserRow {
  id: string;
  display_name: string;
  created_at: string | Date;
}

interface PersonaRow {
  id: string;
  user_id: string;
  display_name: string;
  relationship: string;
  type: PersonaType;
  created_at: string | Date;
}

interface MemoryRow {
  id: string;
  user_id: string;
  persona_id: string;
  type: MemoryItem['type'];
  source: MemoryItem['source'];
  content: string;
  confidence: number;
  sensitivity: MemoryItem['sensitivity'];
  enabled_for_soul: boolean;
  enabled_for_runtime: boolean;
  enabled_for_soul_update: boolean;
  evidence_ids: string[] | string;
  created_by: MemoryItem['createdBy'];
  state: MemoryItem['state'];
  created_at: string | Date;
}

interface SoulVersionRow {
  id: string;
  user_id: string;
  persona_id: string;
  version: number;
  kernel_json: Record<string, unknown> | string;
  status: SoulVersion['status'];
  knowledge_cutoff: string | Date | null;
  created_at: string | Date;
}

interface SoulSnapshotRow {
  id: string;
  user_id: string;
  persona_id: string;
  soul_version_id: string;
  kernel_json: Record<string, unknown> | string;
  memory_ids: string[] | string;
  sealed_at: string | Date;
}

interface SoulUpdateProposalRow {
  id: string;
  user_id: string;
  persona_id: string;
  field_path: string;
  old_value: unknown;
  new_value: unknown;
  evidence_ids: string[] | string;
  status: SoulUpdateProposal['status'];
  created_at: string | Date;
}

interface NodeEventRow {
  id: string;
  user_id: string;
  persona_id: string;
  name: string;
  status: NodeEvent['status'];
  start_at: string | Date;
  end_at: string | Date;
}

interface ConversationRow {
  id: string;
  user_id: string;
  persona_id: string;
  node_id: string | null;
  role: ConversationMessage['role'];
  content: string;
  created_at: string | Date;
}

interface RuntimeSessionRow {
  user_id: string;
  persona_id: string;
  state: RuntimeSession['state'];
  soul_snapshot_id: string | null;
  node_id: string | null;
  node_name: string | null;
  daily_message_count: number | null;
  last_message_date: string | null;
  updated_at: string | Date;
}

interface CredentialRow {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: string | Date;
}

interface OpsAuditEventRow {
  id: string;
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor: string;
  target_user_ids: string[] | string;
  metadata: Record<string, string | number | boolean | null> | string;
  created_at: string | Date;
}

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: toDate(row.created_at),
  };
}

function mapPersonaRow(row: PersonaRow): Persona {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    relationship: row.relationship,
    type: row.type,
    createdAt: toDate(row.created_at),
  };
}

function mapSoulVersionRow(row: SoulVersionRow): SoulVersion {
  const soulVersion: SoulVersion = {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    version: Number(row.version),
    kernelJson: parseJsonObject(row.kernel_json),
    status: row.status,
    createdAt: toDate(row.created_at),
  };
  if (row.knowledge_cutoff) {
    soulVersion.knowledgeCutoff = toDate(row.knowledge_cutoff);
  }
  return soulVersion;
}

function mapSoulSnapshotRow(row: SoulSnapshotRow): SoulSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    soulVersionId: row.soul_version_id,
    kernelJson: parseJsonObject(row.kernel_json),
    memoryIds: parseJsonArray(row.memory_ids),
    sealedAt: toDate(row.sealed_at),
  };
}

function mapSoulUpdateProposalRow(row: SoulUpdateProposalRow): SoulUpdateProposal {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    fieldPath: row.field_path,
    oldValue: parseJsonValue(row.old_value),
    newValue: parseJsonValue(row.new_value),
    evidenceIds: parseJsonArray(row.evidence_ids),
    status: row.status,
    createdAt: toDate(row.created_at),
  };
}

function mapMemoryRow(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    type: row.type,
    source: row.source,
    content: row.content,
    confidence: Number(row.confidence),
    sensitivity: row.sensitivity,
    enabledForSoul: Boolean(row.enabled_for_soul),
    enabledForRuntime: Boolean(row.enabled_for_runtime),
    enabledForSoulUpdate: Boolean(row.enabled_for_soul_update),
    evidenceIds: parseJsonArray(row.evidence_ids),
    createdBy: row.created_by,
    state: row.state,
    createdAt: toDate(row.created_at),
  };
}

function mapNodeEventRow(row: NodeEventRow): NodeEvent {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    name: row.name,
    status: row.status,
    startAt: toDate(row.start_at),
    endAt: toDate(row.end_at),
  };
}

function mapConversationRow(row: ConversationRow): ConversationMessage {
  const message: ConversationMessage = {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    role: row.role,
    content: row.content,
    createdAt: toDate(row.created_at),
  };
  if (row.node_id) {
    message.nodeId = row.node_id;
  }
  return message;
}

function mapRuntimeSessionRow(row: RuntimeSessionRow): RuntimeSession {
  const session: RuntimeSession = {
    userId: row.user_id,
    personaId: row.persona_id,
    state: row.state,
  };
  if (row.soul_snapshot_id) {
    session.soulSnapshotId = row.soul_snapshot_id;
  }
  if (row.node_id && row.node_name) {
    session.nodeContext = {
      nodeId: row.node_id,
      nodeName: row.node_name,
    };
  }
  if (row.daily_message_count !== null) {
    session.dailyMessageCount = Number(row.daily_message_count);
  }
  if (row.last_message_date !== null) {
    session.lastMessageDate = row.last_message_date;
  }
  return session;
}

function mapCredentialRow(row: CredentialRow): CredentialRecord {
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: toDate(row.created_at).toISOString(),
  };
}

function mapOpsAuditEventRow(row: OpsAuditEventRow): OpsAuditEvent {
  return {
    id: row.id,
    action: row.action,
    outcome: row.outcome,
    actor: row.actor,
    targetUserIds: parseJsonArray(row.target_user_ids),
    metadata: parseMetadata(row.metadata),
    createdAt: toDate(row.created_at),
  };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseJsonArray(value: string[] | string): string[] {
  return Array.isArray(value) ? value : JSON.parse(value);
}

function parseJsonObject(value: Record<string, unknown> | string): Record<string, unknown> {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (
    trimmed.startsWith('{')
    || trimmed.startsWith('[')
    || trimmed.startsWith('"')
    || trimmed === 'null'
    || trimmed === 'true'
    || trimmed === 'false'
    || /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    return JSON.parse(trimmed);
  }
  return value;
}

function parseMetadata(
  value: Record<string, string | number | boolean | null> | string,
): Record<string, string | number | boolean | null> {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
