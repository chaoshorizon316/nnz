import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { NotFoundError, OwnershipError, ScopeValidationError } from './errors';
import type {
  ConversationMessage,
  MemoryItem,
  Persona,
  PersonaType,
  User,
  UserPersonaScope,
} from './types';
import type { AddConversationInput, AddMemoryInput } from './soul-store';

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
`;

type OptionalScope = Partial<UserPersonaScope> | undefined;

export interface QueryablePool {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
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

export class PostgresScopedSoulRepository {
  private readonly scopeValue: UserPersonaScope;

  constructor(
    private readonly pool: QueryablePool,
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

  async addConversation(input: PostgresScopedAddConversationInput): Promise<ConversationMessage> {
    await this.ensureBoundPersona();
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
}

export async function ensurePostgresScopedSchema(pool: QueryablePool): Promise<void> {
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
  pool: QueryablePool,
  scopeInput: OptionalScope,
): PostgresScopedSoulRepository {
  return new PostgresScopedSoulRepository(pool, scopeInput);
}

export async function createPostgresUser(
  pool: QueryablePool,
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
  pool: QueryablePool,
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
  pool: QueryablePool,
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

async function requirePostgresUser(pool: QueryablePool, userId: string): Promise<User> {
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

async function getPersonaForUser(pool: QueryablePool, scope: UserPersonaScope): Promise<Persona> {
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

interface ConversationRow {
  id: string;
  user_id: string;
  persona_id: string;
  node_id: string | null;
  role: ConversationMessage['role'];
  content: string;
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

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseJsonArray(value: string[] | string): string[] {
  return Array.isArray(value) ? value : JSON.parse(value);
}
