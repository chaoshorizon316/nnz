import Database from 'better-sqlite3';
import type { InMemorySoulStore } from './soul-store';
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS soul_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kernel_json TEXT NOT NULL,
  status TEXT NOT NULL,
  knowledge_cutoff TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS soul_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  soul_version_id TEXT NOT NULL,
  kernel_json TEXT NOT NULL,
  memory_ids TEXT NOT NULL,
  sealed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  sensitivity TEXT NOT NULL,
  enabled_for_soul INTEGER NOT NULL,
  enabled_for_runtime INTEGER NOT NULL,
  enabled_for_soul_update INTEGER NOT NULL,
  evidence_ids TEXT NOT NULL,
  created_by TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS soul_update_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  evidence_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS node_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  node_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  scope_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  state TEXT NOT NULL,
  soul_snapshot_id TEXT,
  node_id TEXT,
  node_name TEXT,
  daily_message_count INTEGER,
  last_message_date TEXT
);
`;

export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function saveStore(store: InMemorySoulStore, dbPath: string): void {
  const db = createDb(dbPath);

  // Clear existing data
    for (const table of ['users', 'personas', 'soul_versions', 'soul_snapshots', 'memory_items', 'soul_update_proposals', 'node_events', 'conversation_messages', 'sessions', 'credentials']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    // Use internal data access — we'll add getter methods to InMemorySoulStore
    const data = store.serialize();
    if (!data) return;

    const iso = (d: Date) => d.toISOString();

    for (const u of data.users) {
      db.prepare('INSERT INTO users VALUES (?,?,?)').run(u.id, u.displayName, iso(u.createdAt));
    }
    for (const p of data.personas) {
      db.prepare('INSERT INTO personas VALUES (?,?,?,?,?,?)').run(p.id, p.userId, p.displayName, p.relationship, p.type, iso(p.createdAt));
    }
    for (const sv of data.soulVersions) {
      db.prepare('INSERT INTO soul_versions VALUES (?,?,?,?,?,?,?,?)').run(sv.id, sv.userId, sv.personaId, sv.version, JSON.stringify(sv.kernelJson), sv.status, sv.knowledgeCutoff?.toISOString() ?? null, iso(sv.createdAt));
    }
    for (const ss of data.soulSnapshots) {
      db.prepare('INSERT INTO soul_snapshots VALUES (?,?,?,?,?,?,?)').run(ss.id, ss.userId, ss.personaId, ss.soulVersionId, JSON.stringify(ss.kernelJson), JSON.stringify(ss.memoryIds), iso(ss.sealedAt));
    }
    for (const m of data.memoryItems) {
      db.prepare('INSERT INTO memory_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(m.id, m.userId, m.personaId, m.type, m.source, m.content, m.confidence, m.sensitivity, m.enabledForSoul ? 1 : 0, m.enabledForRuntime ? 1 : 0, m.enabledForSoulUpdate ? 1 : 0, JSON.stringify(m.evidenceIds), m.createdBy, m.state, iso(m.createdAt));
    }
    for (const p of data.soulUpdateProposals) {
      db.prepare('INSERT INTO soul_update_proposals VALUES (?,?,?,?,?,?,?,?,?)').run(p.id, p.userId, p.personaId, p.fieldPath, p.oldValue != null ? JSON.stringify(p.oldValue) : null, JSON.stringify(p.newValue), JSON.stringify(p.evidenceIds), p.status, iso(p.createdAt));
    }
    for (const n of data.nodeEvents) {
      db.prepare('INSERT INTO node_events VALUES (?,?,?,?,?,?,?)').run(n.id, n.userId, n.personaId, n.name, n.status, iso(n.startAt), iso(n.endAt));
    }
    for (const c of data.conversationMessages) {
      db.prepare('INSERT INTO conversation_messages VALUES (?,?,?,?,?,?,?)').run(c.id, c.userId, c.personaId, c.nodeId ?? null, c.role, c.content, iso(c.createdAt));
    }
    for (const s of data.sessions) {
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)').run(s.scopeKey, s.userId, s.personaId, s.state, s.soulSnapshotId ?? null, s.nodeId ?? null, s.nodeName ?? null, s.dailyMessageCount ?? null, s.lastMessageDate ?? null);
    }
    for (const c of data.credentials) {
      db.prepare('INSERT INTO credentials VALUES (?,?,?,?)').run(c.userId, c.email, c.passwordHash, c.createdAt);
    }
  db.close();
}

export function loadStore(store: InMemorySoulStore, dbPath: string): boolean {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch {
    return false;
  }

  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    if (!count || count.c === 0) {
      db.close();
      return false;
    }

    const credRows = db.prepare('SELECT * FROM credentials').all() as any[];
    const credentials = credRows.map((r: any) => ({
      userId: r.user_id,
      email: r.email,
      passwordHash: r.password_hash,
      createdAt: r.created_at,
    }));

    store.deserialize({
      users: db.prepare('SELECT * FROM users').all().map((r: any) => ({
        id: r.id, displayName: r.display_name, createdAt: new Date(r.created_at),
      })) as User[],
      personas: db.prepare('SELECT * FROM personas').all().map((r: any) => ({
        id: r.id, userId: r.user_id, displayName: r.display_name, relationship: r.relationship, type: r.type, createdAt: new Date(r.created_at),
      })) as Persona[],
      soulVersions: db.prepare('SELECT * FROM soul_versions').all().map((r: any) => ({
        id: r.id, userId: r.user_id, personaId: r.persona_id, version: r.version, kernelJson: JSON.parse(r.kernel_json), status: r.status, knowledgeCutoff: r.knowledge_cutoff ? new Date(r.knowledge_cutoff) : undefined, createdAt: new Date(r.created_at),
      })) as SoulVersion[],
      soulSnapshots: db.prepare('SELECT * FROM soul_snapshots').all().map((r: any) => ({
        id: r.id, userId: r.user_id, personaId: r.persona_id, soulVersionId: r.soul_version_id, kernelJson: JSON.parse(r.kernel_json), memoryIds: JSON.parse(r.memory_ids), sealedAt: new Date(r.sealed_at),
      })) as SoulSnapshot[],
      memoryItems: db.prepare('SELECT * FROM memory_items').all().map((r: any) => ({
        id: r.id, userId: r.user_id, personaId: r.persona_id, type: r.type, source: r.source, content: r.content, confidence: r.confidence, sensitivity: r.sensitivity, enabledForSoul: !!r.enabled_for_soul, enabledForRuntime: !!r.enabled_for_runtime, enabledForSoulUpdate: !!r.enabled_for_soul_update, evidenceIds: JSON.parse(r.evidence_ids), createdBy: r.created_by, state: r.state, createdAt: new Date(r.created_at),
      })) as MemoryItem[],
      soulUpdateProposals: db.prepare('SELECT * FROM soul_update_proposals').all().map((r: any) => ({
        id: r.id, userId: r.user_id, personaId: r.persona_id, fieldPath: r.field_path, oldValue: r.old_value != null ? JSON.parse(r.old_value) : undefined, newValue: JSON.parse(r.new_value), evidenceIds: JSON.parse(r.evidence_ids), status: r.status, createdAt: new Date(r.created_at),
      })) as SoulUpdateProposal[],
      nodeEvents: db.prepare('SELECT * FROM node_events').all().map((r: any) => ({
        id: r.id, userId: r.user_id, personaId: r.persona_id, name: r.name, status: r.status, startAt: new Date(r.start_at), endAt: new Date(r.end_at),
      })) as NodeEvent[],
      conversationMessages: db.prepare('SELECT * FROM conversation_messages').all().map((r: any) => ({
        id: r.id, userId: r.user_id, personaId: r.persona_id, nodeId: r.node_id ?? undefined, role: r.role, content: r.content, createdAt: new Date(r.created_at),
      })) as ConversationMessage[],
      credentials,
      sessions: db.prepare('SELECT * FROM sessions').all().map((r: any) => ({
        scopeKey: r.scope_key, userId: r.user_id, personaId: r.persona_id, state: r.state, soulSnapshotId: r.soul_snapshot_id ?? undefined, nodeId: r.node_id ?? undefined, nodeName: r.node_name ?? undefined, dailyMessageCount: r.daily_message_count ?? undefined, lastMessageDate: r.last_message_date ?? undefined,
      })),
    });

    db.close();
    return true;
  } catch (err) {
    db.close();
    console.error('Failed to load store from SQLite:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ── Types for serialization ──

export interface StoreSnapshot {
  users: User[];
  personas: Persona[];
  soulVersions: SoulVersion[];
  soulSnapshots: SoulSnapshot[];
  memoryItems: MemoryItem[];
  soulUpdateProposals: SoulUpdateProposal[];
  nodeEvents: NodeEvent[];
  conversationMessages: ConversationMessage[];
  sessions: Array<{
    scopeKey: string;
    userId: string;
    personaId: string;
    state: string;
    soulSnapshotId?: string;
    nodeId?: string;
    nodeName?: string;
    dailyMessageCount?: number;
    lastMessageDate?: string;
  }>;
  credentials: Array<{
    userId: string;
    email: string;
    passwordHash: string;
    createdAt: string;
  }>;
}
