import type { CredentialRecord } from '../auth/auth';
import { CovenantStateError, NotFoundError } from '../domain/errors';
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
  SoulUpdateProposal,
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

export interface UserDataExportCredential {
  email: string;
  createdAt: string;
}

export interface UserDataExportTotals {
  users: number;
  personas: number;
  soulVersions: number;
  soulSnapshots: number;
  memoryItems: number;
  soulUpdateProposals: number;
  nodeEvents: number;
  conversationMessages: number;
  sessions: number;
  credentials: number;
}

export interface UserDataExport {
  exportedAt: string;
  user: User;
  credential: UserDataExportCredential | null;
  personas: Persona[];
  soulVersions: SoulVersion[];
  soulSnapshots: SoulSnapshot[];
  memoryItems: MemoryItem[];
  soulUpdateProposals: SoulUpdateProposal[];
  nodeEvents: NodeEvent[];
  conversationMessages: ConversationMessage[];
  sessions: RuntimeSession[];
  totals: UserDataExportTotals;
}

export interface DeleteUserDataResult {
  userId: string;
  deletedAt: string;
  deleted: UserDataExportTotals;
}

export interface ScopedRuntimeAdapter {
  createUser(displayName: string): Promise<User>;
  storeCredential(userId: string, email: string, passwordHash: string): Promise<void>;
  getCredentialByEmail(email: string): Promise<CredentialRecord | undefined>;
  createPersona(input: ScopedRuntimeCreatePersonaInput): Promise<Persona>;
  listPersonasForUser(userId: string): Promise<Persona[]>;
  exportUserData(userId: string): Promise<UserDataExport>;
  deleteUserData(userId: string): Promise<DeleteUserDataResult>;
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
  exportUserData(userId: string): Promise<UserDataExport>;
  deleteUserData(userId: string): Promise<DeleteUserDataResult>;
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

interface UserRow {
  id: string;
  display_name: string;
  created_at: string | Date;
}

interface CredentialExportRow {
  email: string;
  created_at: string | Date;
}

interface RuntimeSessionRow {
  user_id: string;
  persona_id: string;
  state: RuntimeSession['state'];
  soul_snapshot_id: string | null;
  node_id: string | null;
  node_name: string | null;
  daily_message_count: number | string | null;
  last_message_date: string | null;
}

export function createScopedRuntimeAdapter(driver: ScopedRuntimeDriver): ScopedRuntimeAdapter {
  return {
    createUser: (displayName) => driver.createUser(displayName),
    storeCredential: (userId, email, passwordHash) => driver.storeCredential(userId, email, passwordHash),
    getCredentialByEmail: (email) => driver.getCredentialByEmail(email),
    createPersona: (input) => driver.createPersona(input),
    listPersonasForUser: (userId) => driver.listPersonasForUser(userId),
    exportUserData: (userId) => driver.exportUserData(userId),
    deleteUserData: (userId) => driver.deleteUserData(userId),
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
    exportUserData: async (userId) => exportInMemoryUserData(store, userId),
    deleteUserData: async (userId) => deleteInMemoryUserData(store, userId),
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
    exportUserData: (userId) => exportPostgresUserData(pool, userId),
    deleteUserData: (userId) => deletePostgresUserData(pool, userId),
    bind: (scope) => createPostgresScopedSoulRepositoryFromPool(pool, scope),
  });
}

async function exportInMemoryUserData(store: InMemorySoulStore, userId: string): Promise<UserDataExport> {
  const snapshot = store.serialize();
  const user = snapshot.users.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new NotFoundError(`User ${userId} was not found.`);
  }

  const personas = store.listPersonasForUser(userId);
  const soulVersions: SoulVersion[] = [];
  const soulSnapshots: SoulSnapshot[] = [];
  const memoryItems: MemoryItem[] = [];
  const soulUpdateProposals: SoulUpdateProposal[] = [];
  const nodeEvents: NodeEvent[] = [];
  const conversationMessages: ConversationMessage[] = [];

  for (const persona of personas) {
    const scope = { userId, personaId: persona.id };
    soulVersions.push(...store.listSoulVersions(scope));
    soulSnapshots.push(...store.listSoulSnapshots(scope));
    memoryItems.push(...store.listMemory(scope));
    soulUpdateProposals.push(...store.listSoulUpdateProposals(scope));
    nodeEvents.push(...store.listNodes(scope));
    conversationMessages.push(...store.listConversations(scope));
  }

  const personaIds = new Set(personas.map((persona) => persona.id));
  const sessions = snapshot.sessions
    .filter((session) => session.userId === userId && personaIds.has(session.personaId))
    .map(mapSerializedSession);
  const credentialRecord = snapshot.credentials.find((credential) => credential.userId === userId);
  const exportData = buildUserDataExport({
    user,
    credential: credentialRecord
      ? { email: credentialRecord.email, createdAt: credentialRecord.createdAt }
      : null,
    personas,
    soulVersions,
    soulSnapshots,
    memoryItems,
    soulUpdateProposals,
    nodeEvents,
    conversationMessages,
    sessions,
  });
  return exportData;
}

async function deleteInMemoryUserData(store: InMemorySoulStore, userId: string): Promise<DeleteUserDataResult> {
  const exportData = await exportInMemoryUserData(store, userId);
  store.deleteUserScopedData(userId);
  return buildDeleteUserDataResult(exportData);
}

async function exportPostgresUserData(pool: QueryableClient, userId: string): Promise<UserDataExport> {
  const userResult = await pool.query<UserRow>(
    `SELECT *
     FROM nnz_users
     WHERE id = $1`,
    [userId],
  );
  const userRow = userResult.rows[0];
  if (!userRow) {
    throw new NotFoundError(`User ${userId} was not found.`);
  }

  const personas = await listPostgresPersonasForUser(pool, userId);
  const credentialResult = await pool.query<CredentialExportRow>(
    `SELECT email, created_at
     FROM nnz_credentials
     WHERE user_id = $1`,
    [userId],
  );

  const scopedExports = await Promise.all(personas.map(async (persona) => {
    const scope = { userId, personaId: persona.id };
    const repository = createPostgresScopedSoulRepositoryFromPool(pool, scope);
    const [
      soulVersions,
      soulSnapshots,
      memoryItems,
      soulUpdateProposals,
      nodeEvents,
      conversationMessages,
      sessions,
    ] = await Promise.all([
      repository.listSoulVersions(),
      repository.listSoulSnapshots(),
      repository.listMemory(),
      repository.listSoulUpdateProposals(),
      repository.listNodes(),
      repository.listConversations(),
      listPostgresRuntimeSessionsForScope(pool, scope),
    ]);
    return {
      soulVersions,
      soulSnapshots,
      memoryItems,
      soulUpdateProposals,
      nodeEvents,
      conversationMessages,
      sessions,
    };
  }));

  const credentialRow = credentialResult.rows[0];
  return buildUserDataExport({
    user: mapPostgresUserRow(userRow),
    credential: credentialRow
      ? { email: credentialRow.email, createdAt: toIsoString(credentialRow.created_at) }
      : null,
    personas,
    soulVersions: scopedExports.flatMap((item) => item.soulVersions),
    soulSnapshots: scopedExports.flatMap((item) => item.soulSnapshots),
    memoryItems: scopedExports.flatMap((item) => item.memoryItems),
    soulUpdateProposals: scopedExports.flatMap((item) => item.soulUpdateProposals),
    nodeEvents: scopedExports.flatMap((item) => item.nodeEvents),
    conversationMessages: scopedExports.flatMap((item) => item.conversationMessages),
    sessions: scopedExports.flatMap((item) => item.sessions),
  });
}

async function deletePostgresUserData(pool: QueryableClient, userId: string): Promise<DeleteUserDataResult> {
  const exportData = await exportPostgresUserData(pool, userId);
  await pool.query(
    `DELETE FROM nnz_users
     WHERE id = $1`,
    [userId],
  );
  return buildDeleteUserDataResult(exportData);
}

async function listPostgresRuntimeSessionsForScope(
  pool: QueryableClient,
  scope: UserPersonaScope,
): Promise<RuntimeSession[]> {
  const result = await pool.query<RuntimeSessionRow>(
    `SELECT user_id, persona_id, state, soul_snapshot_id, node_id, node_name,
            daily_message_count, last_message_date
     FROM nnz_runtime_sessions
     WHERE user_id = $1 AND persona_id = $2
     ORDER BY user_id ASC, persona_id ASC`,
    [scope.userId, scope.personaId],
  );
  return result.rows.map(mapPostgresRuntimeSessionRow);
}

function buildUserDataExport(input: Omit<UserDataExport, 'exportedAt' | 'totals'>): UserDataExport {
  const exportData: UserDataExport = {
    exportedAt: new Date().toISOString(),
    ...input,
    totals: {
      users: 1,
      personas: input.personas.length,
      soulVersions: input.soulVersions.length,
      soulSnapshots: input.soulSnapshots.length,
      memoryItems: input.memoryItems.length,
      soulUpdateProposals: input.soulUpdateProposals.length,
      nodeEvents: input.nodeEvents.length,
      conversationMessages: input.conversationMessages.length,
      sessions: input.sessions.length,
      credentials: input.credential ? 1 : 0,
    },
  };
  return exportData;
}

function buildDeleteUserDataResult(exportData: UserDataExport): DeleteUserDataResult {
  return {
    userId: exportData.user.id,
    deletedAt: new Date().toISOString(),
    deleted: { ...exportData.totals },
  };
}

function mapSerializedSession(session: {
  userId: string;
  personaId: string;
  state: string;
  soulSnapshotId?: string;
  nodeId?: string;
  nodeName?: string;
  dailyMessageCount?: number;
  lastMessageDate?: string;
}): RuntimeSession {
  const mapped: RuntimeSession = {
    userId: session.userId,
    personaId: session.personaId,
    state: session.state as RuntimeSession['state'],
  };
  if (session.soulSnapshotId) {
    mapped.soulSnapshotId = session.soulSnapshotId;
  }
  if (session.nodeId && session.nodeName) {
    mapped.nodeContext = {
      nodeId: session.nodeId,
      nodeName: session.nodeName,
    };
  }
  if (session.dailyMessageCount !== undefined) {
    mapped.dailyMessageCount = session.dailyMessageCount;
  }
  if (session.lastMessageDate !== undefined) {
    mapped.lastMessageDate = session.lastMessageDate;
  }
  return mapped;
}

function mapPostgresUserRow(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: toDate(row.created_at),
  };
}

function mapPostgresRuntimeSessionRow(row: RuntimeSessionRow): RuntimeSession {
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

function toIsoString(value: string | Date): string {
  return toDate(value).toISOString();
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
