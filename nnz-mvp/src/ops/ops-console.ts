import { InMemorySoulStore } from '../domain/soul-store';
import type { RuntimePersistenceMode } from '../runtime-persistence-config';
import type {
  OpsAuditAction,
  OpsAuditEvent,
  Persona,
  RuntimeState,
  SoulMaturityReport,
  User,
} from '../domain/types';
import type { CredentialRecord } from '../auth/auth';

type StoreSnapshot = ReturnType<InMemorySoulStore['serialize']>;

export interface OpsPersistenceInfo {
  mode: 'memory' | 'sqlite' | 'postgres';
  runtimeMode: RuntimePersistenceMode;
  requestedRuntimeMode: string | null;
  postgresConfigured: boolean;
  postgresEnv: string | null;
  scopedPostgresConfigured: boolean;
  scopedPostgresEnv: string | null;
  sqliteConfigured: boolean;
  startupBlocked: boolean;
  startupBlockReason: string | null;
}

export interface OpsOverview {
  generatedAt: string;
  persistence: OpsPersistenceInfo;
  totals: OpsTotals;
  cleanupPlan: OpsCleanupPlan;
  audit: OpsAuditOverview;
  users: OpsUserSummary[];
}

export interface OpsTotals {
  users: number;
  personas: number;
  soulVersions: number;
  snapshots: number;
  memories: number;
  proposals: number;
  pendingProposals: number;
  nodes: number;
  conversations: number;
  sessions: number;
  credentials: number;
  testUsers: number;
  opsAuditEvents: number;
}

export interface OpsAuditOverview {
  total: number;
  recent: OpsAuditEvent[];
}

export interface OpsAuditQuery {
  action?: OpsAuditAction | undefined;
  actor?: string | undefined;
  targetUserId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface OpsAuditQueryResult {
  generatedAt: string;
  filters: {
    action: OpsAuditAction | null;
    actor: string | null;
    targetUserId: string | null;
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
    returned: number;
    hasMore: boolean;
  };
  events: OpsAuditEvent[];
}

export interface OpsUserSummary {
  id: string;
  displayName: string;
  email: string | null;
  createdAt: string;
  isDemoUser: boolean;
  isTestUser: boolean;
  counts: {
    personas: number;
    soulVersions: number;
    snapshots: number;
    memories: number;
    proposals: number;
    pendingProposals: number;
    nodes: number;
    conversations: number;
    sessions: number;
  };
  personas: OpsPersonaSummary[];
}

export interface OpsPersonaSummary {
  id: string;
  displayName: string;
  relationship: string;
  type: string;
  createdAt: string;
  latestSoulVersion: number | null;
  latestSoulStatus: string | null;
  runtimeState: RuntimeState;
  maturity: SoulMaturityReport;
  counts: {
    soulVersions: number;
    snapshots: number;
    memories: number;
    runtimeMemories: number;
    soulUpdateMemories: number;
    proposals: number;
    pendingProposals: number;
    nodes: number;
    conversations: number;
  };
}

export interface OpsCleanupPlan {
  generatedAt: string;
  users: OpsCleanupUser[];
  totals: {
    users: number;
    personas: number;
    soulVersions: number;
    snapshots: number;
    memories: number;
    proposals: number;
    nodes: number;
    conversations: number;
    sessions: number;
    credentials: number;
  };
}

export interface OpsCleanupUser {
  userId: string;
  displayName: string;
  email: string | null;
  createdAt: string;
  reason: string;
  counts: OpsCleanupPlan['totals'];
}

export interface OpsCleanupResult {
  dryRun: boolean;
  plan: OpsCleanupPlan;
  deletedUserIds: string[];
  receipts: OpsCleanupReceipt[];
}

export interface OpsCleanupReceipt {
  userId: string;
  displayName: string;
  email: string | null;
  reason: string;
  counts: OpsCleanupPlan['totals'];
  deletedAt: string;
  status: 'DELETED';
}

export function buildOpsOverview(store: InMemorySoulStore, persistence: OpsPersistenceInfo): OpsOverview {
  const snapshot = store.serialize();
  const cleanupPlan = buildTestUserCleanupPlan(store);
  const recentAuditEvents = store.listOpsAuditEvents(20);
  const users = snapshot.users
    .map((user) => summarizeUser(store, snapshot, user))
    .sort((left, right) => {
      if (left.isTestUser !== right.isTestUser) return left.isTestUser ? -1 : 1;
      return right.createdAt.localeCompare(left.createdAt);
    });

  return {
    generatedAt: new Date().toISOString(),
    persistence,
    totals: {
      users: snapshot.users.length,
      personas: snapshot.personas.length,
      soulVersions: snapshot.soulVersions.length,
      snapshots: snapshot.soulSnapshots.length,
      memories: snapshot.memoryItems.length,
      proposals: snapshot.soulUpdateProposals.length,
      pendingProposals: snapshot.soulUpdateProposals.filter((proposal) => proposal.status === 'PENDING').length,
      nodes: snapshot.nodeEvents.length,
      conversations: snapshot.conversationMessages.length,
      sessions: snapshot.sessions.length,
      credentials: snapshot.credentials.length,
      testUsers: cleanupPlan.totals.users,
      opsAuditEvents: snapshot.opsAuditEvents.length,
    },
    cleanupPlan,
    audit: {
      total: snapshot.opsAuditEvents.length,
      recent: recentAuditEvents,
    },
    users,
  };
}

export function queryOpsAuditEvents(store: InMemorySoulStore, query: OpsAuditQuery = {}): OpsAuditQueryResult {
  const limit = clampInteger(query.limit, 20, 1, 100);
  const offset = clampInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const actor = normalizeFilter(query.actor);
  const targetUserId = normalizeFilter(query.targetUserId);
  const events = store.listOpsAuditEvents().filter((event) => {
    if (query.action && event.action !== query.action) return false;
    if (actor && event.actor !== actor) return false;
    if (targetUserId && !event.targetUserIds.includes(targetUserId)) return false;
    return true;
  });
  const page = events.slice(offset, offset + limit);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      action: query.action ?? null,
      actor: actor ?? null,
      targetUserId: targetUserId ?? null,
    },
    pagination: {
      limit,
      offset,
      total: events.length,
      returned: page.length,
      hasMore: offset + page.length < events.length,
    },
    events: page,
  };
}

export function buildTestUserCleanupPlan(store: InMemorySoulStore): OpsCleanupPlan {
  const snapshot = store.serialize();
  const users = snapshot.users
    .map((user) => {
      const credential = credentialForUser(snapshot, user.id);
      const reason = getTestUserReason(user, credential);
      return reason ? buildCleanupUser(snapshot, user, credential, reason) : undefined;
    })
    .filter((user): user is OpsCleanupUser => Boolean(user))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    generatedAt: new Date().toISOString(),
    users,
    totals: sumCleanupTotals(users),
  };
}

export function cleanupTestUsers(store: InMemorySoulStore, dryRun = true): OpsCleanupResult {
  const plan = buildTestUserCleanupPlan(store);
  if (dryRun) {
    return { dryRun: true, plan, deletedUserIds: [], receipts: [] };
  }

  const deletedUserIds: string[] = [];
  const deletedAt = new Date().toISOString();
  const receipts: OpsCleanupReceipt[] = [];
  for (const user of plan.users) {
    store.deleteUserScopedData(user.userId);
    deletedUserIds.push(user.userId);
    receipts.push({
      userId: user.userId,
      displayName: user.displayName,
      email: user.email,
      reason: user.reason,
      counts: user.counts,
      deletedAt,
      status: 'DELETED',
    });
  }

  return { dryRun: false, plan, deletedUserIds, receipts };
}

function summarizeUser(store: InMemorySoulStore, snapshot: StoreSnapshot, user: User): OpsUserSummary {
  const credential = credentialForUser(snapshot, user.id);
  const personas = snapshot.personas.filter((persona) => persona.userId === user.id);
  const isDemoUser = user.displayName === '用户 A' || user.displayName === '用户 B';
  return {
    id: user.id,
    displayName: user.displayName,
    email: credential?.email ?? null,
    createdAt: user.createdAt.toISOString(),
    isDemoUser,
    isTestUser: Boolean(getTestUserReason(user, credential)),
    counts: {
      personas: personas.length,
      soulVersions: byUser(snapshot.soulVersions, user.id).length,
      snapshots: byUser(snapshot.soulSnapshots, user.id).length,
      memories: byUser(snapshot.memoryItems, user.id).length,
      proposals: byUser(snapshot.soulUpdateProposals, user.id).length,
      pendingProposals: byUser(snapshot.soulUpdateProposals, user.id).filter(
        (proposal) => proposal.status === 'PENDING',
      ).length,
      nodes: byUser(snapshot.nodeEvents, user.id).length,
      conversations: byUser(snapshot.conversationMessages, user.id).length,
      sessions: snapshot.sessions.filter((session) => session.userId === user.id).length,
    },
    personas: personas.map((persona) => summarizePersona(store, snapshot, persona)),
  };
}

function summarizePersona(store: InMemorySoulStore, snapshot: StoreSnapshot, persona: Persona): OpsPersonaSummary {
  const scope = { userId: persona.userId, personaId: persona.id };
  const soulVersions = byScope(snapshot.soulVersions, persona.userId, persona.id)
    .sort((left, right) => left.version - right.version);
  const latestSoul = soulVersions.at(-1);
  const memories = store.listMemory(scope);
  const proposals = store.listSoulUpdateProposals(scope);
  const maturity = store.buildSoulMaturityReport(scope);
  return {
    id: persona.id,
    displayName: persona.displayName,
    relationship: persona.relationship,
    type: persona.type,
    createdAt: persona.createdAt.toISOString(),
    latestSoulVersion: latestSoul?.version ?? null,
    latestSoulStatus: latestSoul?.status ?? null,
    runtimeState: maturity.runtimeState,
    maturity,
    counts: {
      soulVersions: soulVersions.length,
      snapshots: byScope(snapshot.soulSnapshots, persona.userId, persona.id).length,
      memories: memories.length,
      runtimeMemories: store.listRuntimeMemory(scope).length,
      soulUpdateMemories: store.listSoulUpdateMemory(scope).length,
      proposals: proposals.length,
      pendingProposals: proposals.filter((proposal) => proposal.status === 'PENDING').length,
      nodes: byScope(snapshot.nodeEvents, persona.userId, persona.id).length,
      conversations: byScope(snapshot.conversationMessages, persona.userId, persona.id).length,
    },
  };
}

function buildCleanupUser(
  snapshot: StoreSnapshot,
  user: User,
  credential: CredentialRecord | undefined,
  reason: string,
): OpsCleanupUser {
  const userPersonas = byUser(snapshot.personas, user.id);
  const sessions = snapshot.sessions.filter((session) => session.userId === user.id);

  return {
    userId: user.id,
    displayName: user.displayName,
    email: credential?.email ?? null,
    createdAt: user.createdAt.toISOString(),
    reason,
    counts: {
      users: 1,
      personas: userPersonas.length,
      soulVersions: byUser(snapshot.soulVersions, user.id).length,
      snapshots: byUser(snapshot.soulSnapshots, user.id).length,
      memories: byUser(snapshot.memoryItems, user.id).length,
      proposals: byUser(snapshot.soulUpdateProposals, user.id).length,
      nodes: byUser(snapshot.nodeEvents, user.id).length,
      conversations: byUser(snapshot.conversationMessages, user.id).length,
      sessions: sessions.length,
      credentials: credential ? 1 : 0,
    },
  };
}

function getTestUserReason(user: User, credential: CredentialRecord | undefined): string | null {
  const candidates = [user.displayName, credential?.email].filter((value): value is string => Boolean(value));
  for (const raw of candidates) {
    const value = raw.trim().toLowerCase();
    if (value.endsWith('@example.test')) return 'example.test smoke account';
    if (value.startsWith('codex-postgres-smoke-')) return 'codex postgres smoke account';
    if (value.startsWith('codex-ops-smoke-')) return 'codex ops smoke account';
    if (value.startsWith('nnz-smoke-')) return 'nnz smoke account';
  }
  return null;
}

function credentialForUser(snapshot: StoreSnapshot, userId: string): CredentialRecord | undefined {
  return snapshot.credentials.find((credential) => credential.userId === userId);
}

function byUser<T extends { userId: string }>(items: T[], userId: string): T[] {
  return items.filter((item) => item.userId === userId);
}

function byScope<T extends { userId: string; personaId: string }>(items: T[], userId: string, personaId: string): T[] {
  return items.filter((item) => item.userId === userId && item.personaId === personaId);
}

function sumCleanupTotals(users: OpsCleanupUser[]): OpsCleanupPlan['totals'] {
  return users.reduce<OpsCleanupPlan['totals']>(
    (totals, user) => ({
      users: totals.users + user.counts.users,
      personas: totals.personas + user.counts.personas,
      soulVersions: totals.soulVersions + user.counts.soulVersions,
      snapshots: totals.snapshots + user.counts.snapshots,
      memories: totals.memories + user.counts.memories,
      proposals: totals.proposals + user.counts.proposals,
      nodes: totals.nodes + user.counts.nodes,
      conversations: totals.conversations + user.counts.conversations,
      sessions: totals.sessions + user.counts.sessions,
      credentials: totals.credentials + user.counts.credentials,
    }),
    {
      users: 0,
      personas: 0,
      soulVersions: 0,
      snapshots: 0,
      memories: 0,
      proposals: 0,
      nodes: 0,
      conversations: 0,
      sessions: 0,
      credentials: 0,
    },
  );
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
