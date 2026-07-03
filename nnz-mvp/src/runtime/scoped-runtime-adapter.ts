import type { CredentialRecord } from '../auth/auth';
import { CovenantStateError } from '../domain/errors';
import {
  createPostgresPersona,
  createPostgresScopedSoulRepositoryFromPool,
  createPostgresUser,
  listPostgresPersonasForUser,
  type PostgresScopedAddConversationInput,
  type PostgresScopedAddMemoryInput,
  type PostgresScopedCreateNodeInput,
  type PostgresScopedCreateSoulVersionInput,
  type QueryableClient,
} from '../domain/postgres-scoped-soul-repository';
import { InMemorySoulStore } from '../domain/soul-store';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  Persona,
  PersonaType,
  RuntimeContext,
  RuntimeSession,
  SoulSnapshot,
  SoulVersion,
  User,
  UserPersonaScope,
} from '../domain/types';

export interface ScopedRuntimeCreatePersonaInput {
  userId: string;
  displayName: string;
  relationship: string;
  type: PersonaType;
}

export interface ScopedRuntimeAdapter {
  createUser(displayName: string): Promise<User>;
  storeCredential(userId: string, email: string, passwordHash: string): Promise<void>;
  getCredentialByEmail(email: string): Promise<CredentialRecord | undefined>;
  createPersona(input: ScopedRuntimeCreatePersonaInput): Promise<Persona>;
  listPersonasForUser(userId: string): Promise<Persona[]>;
  forPersona(scope: UserPersonaScope): ScopedPersonaRuntimeAdapter;
}

export interface ScopedPersonaRuntimeAdapter {
  readonly scope: UserPersonaScope;
  getPersona(): Promise<Persona>;
  createSoulVersion(input: PostgresScopedCreateSoulVersionInput): Promise<SoulVersion>;
  getLatestSoulVersion(): Promise<SoulVersion>;
  addMemory(input: PostgresScopedAddMemoryInput): Promise<MemoryItem>;
  listMemory(): Promise<MemoryItem[]>;
  listRuntimeMemory(): Promise<MemoryItem[]>;
  addConversation(input: PostgresScopedAddConversationInput): Promise<ConversationMessage>;
  listConversations(): Promise<ConversationMessage[]>;
  createNode(input: PostgresScopedCreateNodeInput): Promise<NodeEvent>;
  getSoulSnapshot(snapshotId: string): Promise<SoulSnapshot>;
  getRuntimeSession(): Promise<RuntimeSession>;
  getRuntimeContext(): Promise<RuntimeContext>;
  sealSoul(): Promise<{ snapshot: SoulSnapshot; session: RuntimeSession }>;
  activateNode(nodeName: string, durationDays?: number): Promise<{ node: NodeEvent; session: RuntimeSession }>;
  completeNode(): Promise<RuntimeSession>;
  graduateSoul(): Promise<RuntimeSession>;
}

interface ScopedRuntimeDriver {
  createUser(displayName: string): Promise<User>;
  storeCredential(userId: string, email: string, passwordHash: string): Promise<void>;
  getCredentialByEmail(email: string): Promise<CredentialRecord | undefined>;
  createPersona(input: ScopedRuntimeCreatePersonaInput): Promise<Persona>;
  listPersonasForUser(userId: string): Promise<Persona[]>;
  bind(scope: UserPersonaScope): ScopedPersonaRuntimeRepository;
}

interface ScopedPersonaRuntimeRepository {
  readonly scope: UserPersonaScope;
  getPersona(): Promise<Persona>;
  createSoulVersion(input: PostgresScopedCreateSoulVersionInput): Promise<SoulVersion>;
  getLatestSoulVersion(): Promise<SoulVersion>;
  addMemory(input: PostgresScopedAddMemoryInput): Promise<MemoryItem>;
  listMemory(): Promise<MemoryItem[]>;
  listRuntimeMemory(): Promise<MemoryItem[]>;
  addConversation(input: PostgresScopedAddConversationInput): Promise<ConversationMessage>;
  listConversations(): Promise<ConversationMessage[]>;
  createNode(input: PostgresScopedCreateNodeInput): Promise<NodeEvent>;
  getSoulSnapshot(snapshotId: string): Promise<SoulSnapshot>;
  getRuntimeSession(): Promise<RuntimeSession>;
  sealSoul(): Promise<{ snapshot: SoulSnapshot; session: RuntimeSession }>;
  activateNode(nodeName: string, durationDays?: number): Promise<{ node: NodeEvent; session: RuntimeSession }>;
  completeNode(): Promise<RuntimeSession>;
  graduateSoul(): Promise<RuntimeSession>;
}

interface CredentialRow {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: string | Date;
}

export function createScopedRuntimeAdapter(driver: ScopedRuntimeDriver): ScopedRuntimeAdapter {
  return {
    createUser: (displayName) => driver.createUser(displayName),
    storeCredential: (userId, email, passwordHash) => driver.storeCredential(userId, email, passwordHash),
    getCredentialByEmail: (email) => driver.getCredentialByEmail(email),
    createPersona: (input) => driver.createPersona(input),
    listPersonasForUser: (userId) => driver.listPersonasForUser(userId),
    forPersona: (scope) => createScopedPersonaRuntimeAdapter(driver.bind(scope)),
  };
}

export function createInMemoryScopedRuntimeAdapter(store: InMemorySoulStore): ScopedRuntimeAdapter {
  return createScopedRuntimeAdapter({
    createUser: async (displayName) => store.createUser(displayName),
    storeCredential: async (userId, email, passwordHash) => {
      store.storeCredential(userId, email, passwordHash);
    },
    getCredentialByEmail: async (email) => store.getCredentialByEmail(email),
    createPersona: async (input) => store.createPersona(input),
    listPersonasForUser: async (userId) => store.listPersonasForUser(userId),
    bind: (scope) => new InMemoryScopedPersonaRuntimeRepository(store, scope),
  });
}

export function createPostgresScopedRuntimeAdapter(pool: QueryableClient): ScopedRuntimeAdapter {
  return createScopedRuntimeAdapter({
    createUser: (displayName) => createPostgresUser(pool, displayName),
    storeCredential: (userId, email, passwordHash) => storePostgresCredential(pool, userId, email, passwordHash),
    getCredentialByEmail: (email) => getPostgresCredentialByEmail(pool, email),
    createPersona: (input) => createPostgresPersona(pool, input),
    listPersonasForUser: (userId) => listPostgresPersonasForUser(pool, userId),
    bind: (scope) => createPostgresScopedSoulRepositoryFromPool(pool, scope),
  });
}

function createScopedPersonaRuntimeAdapter(
  repository: ScopedPersonaRuntimeRepository,
): ScopedPersonaRuntimeAdapter {
  return {
    get scope() {
      return { ...repository.scope };
    },
    getPersona: () => repository.getPersona(),
    createSoulVersion: (input) => repository.createSoulVersion(input),
    getLatestSoulVersion: () => repository.getLatestSoulVersion(),
    addMemory: (input) => repository.addMemory(input),
    listMemory: () => repository.listMemory(),
    listRuntimeMemory: () => repository.listRuntimeMemory(),
    addConversation: (input) => repository.addConversation(input),
    listConversations: () => repository.listConversations(),
    createNode: (input) => repository.createNode(input),
    getSoulSnapshot: (snapshotId) => repository.getSoulSnapshot(snapshotId),
    getRuntimeSession: () => repository.getRuntimeSession(),
    getRuntimeContext: () => buildRuntimeContext(repository),
    sealSoul: () => repository.sealSoul(),
    activateNode: (nodeName, durationDays) => repository.activateNode(nodeName, durationDays),
    completeNode: () => repository.completeNode(),
    graduateSoul: () => repository.graduateSoul(),
  };
}

async function buildRuntimeContext(repository: ScopedPersonaRuntimeRepository): Promise<RuntimeContext> {
  const session = await repository.getRuntimeSession();

  if (session.state === 'SEALED') {
    throw new CovenantStateError('SEALED');
  }
  if (session.state === 'GRADUATED') {
    throw new CovenantStateError('GRADUATED');
  }

  if (session.state === 'NODE') {
    if (!session.soulSnapshotId) {
      throw new Error('NODE session is missing soulSnapshotId.');
    }
    const snapshot = await repository.getSoulSnapshot(session.soulSnapshotId);
    const memories = await repository.listMemory();
    const byId = new Map(memories.map((memory) => [memory.id, memory]));
    const snapshotMemories = snapshot.memoryIds
      .map((memoryId) => byId.get(memoryId))
      .filter((memory): memory is MemoryItem => Boolean(memory));
    const nodeMemories = memories.filter(
      (memory) => memory.state === 'ACTIVE' && memory.enabledForRuntime && memory.type === 'NODE_MEMORY',
    );
    const soul: SoulVersion = {
      id: snapshot.id,
      userId: repository.scope.userId,
      personaId: repository.scope.personaId,
      version: -1,
      kernelJson: { ...snapshot.kernelJson },
      status: 'ARCHIVED',
      createdAt: snapshot.sealedAt,
    };
    const context: RuntimeContext = {
      state: 'NODE',
      soul,
      memories: [...snapshotMemories, ...nodeMemories],
    };
    if (session.nodeContext?.nodeName) {
      context.nodeName = session.nodeContext.nodeName;
    }
    return context;
  }

  return {
    state: 'ACTIVE',
    soul: await repository.getLatestSoulVersion(),
    memories: await repository.listRuntimeMemory(),
  };
}

class InMemoryScopedPersonaRuntimeRepository implements ScopedPersonaRuntimeRepository {
  constructor(
    private readonly store: InMemorySoulStore,
    private readonly scopeValue: UserPersonaScope,
  ) {}

  get scope(): UserPersonaScope {
    return { ...this.scopeValue };
  }

  async getPersona(): Promise<Persona> {
    return this.store.getPersonaForUser(this.scopeValue.userId, this.scopeValue.personaId);
  }

  async createSoulVersion(input: PostgresScopedCreateSoulVersionInput): Promise<SoulVersion> {
    return this.store.createSoulVersion({ ...input, ...this.scopeValue });
  }

  async getLatestSoulVersion(): Promise<SoulVersion> {
    return this.store.getLatestSoulVersion(this.scopeValue);
  }

  async addMemory(input: PostgresScopedAddMemoryInput): Promise<MemoryItem> {
    return this.store.addMemory({ ...input, ...this.scopeValue });
  }

  async listMemory(): Promise<MemoryItem[]> {
    return this.store.listMemory(this.scopeValue);
  }

  async listRuntimeMemory(): Promise<MemoryItem[]> {
    return this.store.listRuntimeMemory(this.scopeValue);
  }

  async addConversation(input: PostgresScopedAddConversationInput): Promise<ConversationMessage> {
    return this.store.addConversation({ ...input, ...this.scopeValue });
  }

  async listConversations(): Promise<ConversationMessage[]> {
    return this.store.listConversations(this.scopeValue);
  }

  async createNode(input: PostgresScopedCreateNodeInput): Promise<NodeEvent> {
    return this.store.createNode({ ...input, ...this.scopeValue });
  }

  async getSoulSnapshot(snapshotId: string): Promise<SoulSnapshot> {
    return this.store.getSoulSnapshot(this.scopeValue, snapshotId);
  }

  async getRuntimeSession(): Promise<RuntimeSession> {
    return this.store.getRuntimeSession(this.scopeValue);
  }

  async sealSoul(): Promise<{ snapshot: SoulSnapshot; session: RuntimeSession }> {
    return this.store.sealSoul(this.scopeValue);
  }

  async activateNode(nodeName: string, durationDays?: number): Promise<{ node: NodeEvent; session: RuntimeSession }> {
    return this.store.activateNode(this.scopeValue, nodeName, durationDays);
  }

  async completeNode(): Promise<RuntimeSession> {
    return this.store.completeNode(this.scopeValue);
  }

  async graduateSoul(): Promise<RuntimeSession> {
    return this.store.graduateSoul(this.scopeValue);
  }
}

async function storePostgresCredential(
  pool: QueryableClient,
  userId: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO nnz_credentials (user_id, email, password_hash, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       created_at = EXCLUDED.created_at`,
    [userId, email, passwordHash, new Date()],
  );
}

async function getPostgresCredentialByEmail(
  pool: QueryableClient,
  email: string,
): Promise<CredentialRecord | undefined> {
  const result = await pool.query<CredentialRow>(
    `SELECT user_id, email, password_hash, created_at
     FROM nnz_credentials
     WHERE email = $1`,
    [email],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: toDate(row.created_at).toISOString(),
  };
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
