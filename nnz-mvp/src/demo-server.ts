import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadEnv } from './env';
loadEnv(process.cwd());

import type { LlmAdapter } from './llm/types';
import { createExtractionOrchestrator } from './extraction/orchestrator';
import { loadStore, saveStore } from './domain/persistence';
import { createPostgresPersistence, type PostgresPersistence } from './domain/postgres-persistence';
import { CovenantStateError, NotFoundError, OwnershipError } from './domain/errors';
import { InMemorySoulStore } from './domain/soul-store';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  OpsAuditAction,
  OpsAuditOutcome,
  Persona,
  RuntimeSession,
  SoulUpdateProposal,
  SoulVersion,
  User,
  UserPersonaScope,
} from './domain/types';
import { generateLlmReply } from './runtime/llm-reply';
import { GRADUATED_REPLY, SEALED_REPLY, generateSoulReply } from './runtime/soul-runtime';
import {
  createInMemoryScopedRuntimeAdapter,
  type ScopedRuntimeAdapter,
  type ScopedPersonaRuntimeAdapter,
} from './runtime/scoped-runtime-adapter';
import {
  createPostgresScopedRuntimePersistence,
  type ScopedRuntimePersistence,
} from './runtime/scoped-runtime-persistence';
import { extractToken, hashPassword, signToken, verifyPassword, verifyToken } from './auth/auth';
import { checkDailyLimit, checkMessageSafety, incrementDailyCount } from './runtime/soul-guard';
import { buildOpsOverview, cleanupTestUsers, queryOpsAuditEvents } from './ops/ops-console';
import { buildRuntimePersistenceConfig } from './runtime-persistence-config';
import {
  buildOpsPermissions,
  buildOpsTokenEntries,
  resolveOpsPrincipal,
  roleAllows,
  type OpsPrincipal,
  type OpsRole,
} from './ops/ops-auth';

interface DemoFixture {
  store: InMemorySoulStore;
  userA: User;
  userB: User;
  personaA: Persona;
  personaB: Persona;
  soulA: SoulVersion;
  soulB: SoulVersion;
  correction?: MemoryItem;
  correctionProposalId?: string;
  node?: NodeEvent;
}

let fixture = createFixture();
let runtimeAdapter: ScopedRuntimeAdapter = createInMemoryScopedRuntimeAdapter(fixture.store);

function getRuntimeAdapter() {
  return runtimeAdapter;
}

const RUNTIME_PERSISTENCE = buildRuntimePersistenceConfig(process.env);
const DB_PATH = RUNTIME_PERSISTENCE.sqlitePath;
const POSTGRES_ENV_SOURCE = RUNTIME_PERSISTENCE.snapshotPostgresEnv;
const POSTGRES_URL = RUNTIME_PERSISTENCE.snapshotPostgresUrl;
const OPS_TOKEN = readNonEmptyEnv('NNZ_OPS_TOKEN');
const OPS_TOKEN_ENTRIES = buildOpsTokenEntries({
  legacyAdminToken: OPS_TOKEN,
  viewerToken: readNonEmptyEnv('NNZ_OPS_VIEWER_TOKEN'),
  operatorToken: readNonEmptyEnv('NNZ_OPS_OPERATOR_TOKEN'),
  adminToken: readNonEmptyEnv('NNZ_OPS_ADMIN_TOKEN'),
});
let postgresPersistence: PostgresPersistence | undefined;
let scopedRuntimePersistence: ScopedRuntimePersistence | undefined;
let persistenceMode: 'memory' | 'sqlite' | 'postgres' | 'scoped-postgres' = 'memory';

const extractionOrchestrator = createExtractionOrchestrator();
let llmAdapter: LlmAdapter | undefined;
(async () => {
  try {
    const adapterModule = await import('./llm/adapter');
    llmAdapter = adapterModule.createAdapterFromEnv();
    console.log('LLM adapter initialized for extraction pipeline.');
  } catch {
    console.log('LLM adapter not available — extraction pipeline disabled.');
  }
})();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const indexPath = join(process.cwd(), 'public', 'index.html');
      if (existsSync(indexPath)) {
        return sendHtml(res, readFileSync(indexPath, 'utf-8'));
      }
      return sendHtml(res, renderPage());
    }

    if (req.method === 'GET' && url.pathname === '/styles.css') {
      const cssPath = join(process.cwd(), 'public', 'styles.css');
      if (existsSync(cssPath)) {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
        res.end(readFileSync(cssPath, 'utf-8'));
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/demo') {
      return sendHtml(res, renderPage());
    }

    if (req.method === 'GET' && url.pathname === '/ops') {
      return sendHtml(res, renderOpsPage(OPS_TOKEN_ENTRIES.length > 0));
    }

    if (url.pathname.startsWith('/api/ops/')) {
      const principal = await requireOpsAccess(req, res);
      if (!principal) return;

      if (req.method === 'GET' && url.pathname === '/api/ops/overview') {
        await recordOpsAudit(principal, 'OVERVIEW_READ', 'SUCCESS', {
          method: req.method ?? 'GET',
          path: url.pathname,
        });
        return sendJson(res, {
          ...await buildCurrentOpsOverview(),
          principal,
          permissions: buildOpsPermissions(principal.role),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/ops/audit-events') {
        const query = parseOpsAuditQuery(url);
        await recordOpsAudit(principal, 'AUDIT_QUERY', 'SUCCESS', {
          action: query.action ?? null,
          actor: query.actor ?? null,
          targetUserId: query.targetUserId ?? null,
          limit: query.limit ?? null,
          offset: query.offset ?? null,
        }, query.targetUserId ? [query.targetUserId] : []);
        return sendJson(res, {
          ...await queryCurrentOpsAuditEvents(query),
          principal,
          permissions: buildOpsPermissions(principal.role),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/ops/cleanup-test-users') {
        const body = await readJsonBody<{ dryRun?: boolean; confirm?: string }>(req);
        const dryRun = body.dryRun !== false;
        const requiredRole: OpsRole = dryRun ? 'operator' : 'admin';
        if (!roleAllows(principal.role, requiredRole)) {
          const preview = await cleanupCurrentTestUsers(true);
          await recordOpsAudit(principal, dryRun ? 'CLEANUP_DRY_RUN' : 'CLEANUP_DELETE', 'DENIED', {
            reason: 'insufficient-role',
            requiredRole,
            actorRole: principal.role,
            candidateUsers: preview.plan.totals.users,
          }, preview.plan.users.map((user) => user.userId));
          return sendJson(res, {
            error: dryRun ? '当前后台角色不能执行 dry-run。' : '当前后台角色不能执行删除。',
            requiredRole,
            principal,
          }, 403);
        }

        if (!dryRun && body.confirm !== 'DELETE_TEST_USERS') {
          const preview = await cleanupCurrentTestUsers(true);
          await recordOpsAudit(principal, 'CLEANUP_DELETE', 'DENIED', {
            reason: 'missing-confirmation',
            candidateUsers: preview.plan.totals.users,
          }, preview.plan.users.map((user) => user.userId));
          return sendJson(res, {
            error: '需要确认码 DELETE_TEST_USERS 才能执行清理。',
            result: preview,
          }, 400);
        }

        const result = await cleanupCurrentTestUsers(dryRun);
        await recordOpsAudit(principal, dryRun ? 'CLEANUP_DRY_RUN' : 'CLEANUP_DELETE', 'SUCCESS', {
          dryRun,
          candidateUsers: result.plan.totals.users,
          deletedUsers: result.deletedUserIds.length,
          receipts: result.receipts.length,
        }, result.plan.users.map((user) => user.userId));
        if (!dryRun) {
          await persistIfEnabled();
        }
        return sendJson(res, { result });
      }

      return sendJson(res, { error: 'Unknown Soul Ops endpoint.' }, 404);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'GET' && url.pathname === '/api/verification') {
      return sendJson(res, buildVerification());
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      return sendJson(res, await buildMeResponse(authUser));
    }

    if (req.method === 'GET' && url.pathname === '/api/me/export') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      return sendJson(res, { export: await getRuntimeAdapter().exportUserData(authUser.userId) });
    }

    if (req.method === 'POST' && url.pathname === '/api/me/delete') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{ confirm?: string }>(req);
      if (body.confirm !== 'DELETE_MY_DATA') {
        return sendJson(res, { error: '请确认后再删除全部数据。' }, 400);
      }
      const result = await getRuntimeAdapter().deleteUserData(authUser.userId);
      await persistIfEnabled();
      return sendJson(res, { result });
    }

    if (req.method === 'GET' && url.pathname === '/api/me/personas') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      return sendJson(res, { personas: await listUserPersonaSummaries(authUser.userId) });
    }

    if (req.method === 'POST' && url.pathname === '/api/me/persona') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{
        displayName?: string;
        relationship?: string;
        description?: string;
        petPhrase?: string;
        traits?: Record<string, string>;
      }>(req);
      if (!normalizeVisibleText(body.displayName, 24) || !normalizeVisibleText(body.relationship, 24)) {
        return sendJson(res, { error: '请填写称呼和关系。' }, 400);
      }
      return sendJson(res, await createUserPersona(authUser.userId, body));
    }

    if (req.method === 'GET' && url.pathname === '/api/me/chat-history') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const personaId = url.searchParams.get('personaId') ?? '';
      if (!personaId) {
        return sendJson(res, { error: '请先选择要对话的人。' }, 400);
      }
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, personaId);
      if (!runtime) return;
      return sendJson(res, {
        persona: await summarizeUserPersona(runtime),
        messages: await serializeUserMessages(runtime),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/me/chat') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{ personaId?: string; message?: string }>(req);
      if (!body.personaId) {
        return sendJson(res, { error: '请先选择要对话的人。' }, 400);
      }
      const message = normalizeVisibleText(body.message, 600);
      if (!message) {
        return sendJson(res, { error: '请输入想说的话。' }, 400);
      }
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, body.personaId);
      if (!runtime) return;
      const reply = await sendMessageToUserPersona(runtime, message);
      return sendJson(res, reply);
    }

    if (req.method === 'GET' && url.pathname === '/api/me/covenant-state') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const personaId = url.searchParams.get('personaId');
      if (!personaId) {
        return sendJson(res, { error: '请提供 personaId。' }, 400);
      }
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, personaId);
      if (!runtime) return;
      const session = await runtime.getRuntimeSession();
      return sendJson(res, { state: session.state, nodeContext: session.nodeContext ?? null });
    }

    if (req.method === 'POST' && url.pathname === '/api/me/seal') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{ personaId?: string }>(req);
      if (!body.personaId) return sendJson(res, { error: '请提供 personaId。' }, 400);
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, body.personaId);
      if (!runtime) return;
      try {
        const { session } = await runtime.sealSoul();
        await persistIfEnabled();
        return sendJson(res, { state: session.state });
      } catch (error) {
        if (error instanceof CovenantStateError) {
          return sendJson(res, { error: '当前状态不允许封存。' }, 409);
        }
        throw error;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/me/activate-node') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{ personaId?: string; nodeName?: string }>(req);
      if (!body.personaId) return sendJson(res, { error: '请提供 personaId。' }, 400);
      const nodeName = normalizeVisibleText(body.nodeName, 20) || '重要时刻';
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, body.personaId);
      if (!runtime) return;
      try {
        const { session } = await runtime.activateNode(nodeName);
        await persistIfEnabled();
        return sendJson(res, { state: session.state, nodeName: session.nodeContext?.nodeName });
      } catch (error) {
        if (error instanceof CovenantStateError) {
          return sendJson(res, { error: '当前状态不允许节点重启。请先封存。' }, 409);
        }
        throw error;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/me/complete-node') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{ personaId?: string }>(req);
      if (!body.personaId) return sendJson(res, { error: '请提供 personaId。' }, 400);
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, body.personaId);
      if (!runtime) return;
      try {
        const session = await runtime.completeNode();
        await persistIfEnabled();
        return sendJson(res, { state: session.state });
      } catch (error) {
        if (error instanceof CovenantStateError) {
          return sendJson(res, { error: '当前状态不允许完成节点。' }, 409);
        }
        throw error;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/me/graduate') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{ personaId?: string }>(req);
      if (!body.personaId) return sendJson(res, { error: '请提供 personaId。' }, 400);
      const runtime = await requireUserPersonaRuntime(res, authUser.userId, body.personaId);
      if (!runtime) return;
      try {
        const session = await runtime.graduateSoul();
        await persistIfEnabled();
        return sendJson(res, { state: session.state });
      } catch (error) {
        if (error instanceof CovenantStateError) {
          return sendJson(res, { error: '当前状态不允许毕业。' }, 409);
        }
        throw error;
      }
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, {
        ok: true,
        service: 'nnz-mvp-demo',
        fixture: persistenceMode === 'memory' ? 'in-memory' : persistenceMode,
        persistence: {
          mode: persistenceMode === 'memory' ? 'in-memory' : persistenceMode,
          runtimeMode: RUNTIME_PERSISTENCE.runtimeMode,
          requestedRuntimeMode: RUNTIME_PERSISTENCE.requestedRuntimeMode,
          postgresConfigured: Boolean(POSTGRES_URL),
          postgresEnv: POSTGRES_ENV_SOURCE,
          scopedPostgresConfigured: Boolean(RUNTIME_PERSISTENCE.scopedPostgresUrl),
          scopedPostgresEnv: RUNTIME_PERSISTENCE.scopedPostgresEnv,
          sqliteConfigured: Boolean(DB_PATH),
          startupBlocked: Boolean(RUNTIME_PERSISTENCE.startupBlockReason),
          startupBlockReason: RUNTIME_PERSISTENCE.startupBlockReason,
        },
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJsonBody<{ message?: string }>(req);
      return sendJson(res, await sendMessageToBothUsers(body.message ?? '爸，我今天有点紧张。'));
    }

    if (req.method === 'POST' && url.pathname === '/api/run-all') {
      applyUserACorrection();
      acceptUserACorrectionProposal();
      createUserANodeMemory();
      await persistIfEnabled();
      return sendJson(res, buildVerification());
    }

    if (req.method === 'POST' && url.pathname === '/api/apply-correction') {
      applyUserACorrection();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/accept-correction') {
      acceptUserACorrectionProposal();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/reject-correction') {
      rejectUserACorrectionProposal();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/create-node') {
      createUserANodeMemory();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/seal') {
      sealUserA();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/activate-node') {
      activateNodeForUserA();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/complete-node') {
      completeNodeForUserA();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/graduate') {
      graduateUserA();
      await persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      fixture = createFixture();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/register') {
      const body = await readJsonBody<{ email?: string; password?: string }>(req);
      return await handleRegister(res, body.email ?? '', body.password ?? '');
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJsonBody<{ email?: string; password?: string }>(req);
      return await handleLogin(res, body.email ?? '', body.password ?? '');
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    const status = error instanceof OwnershipError ? 403 : error instanceof NotFoundError ? 404 : 500;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

startServer().catch((error) => {
  console.error('Failed to start demo server:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});


async function handleRegister(res: ServerResponse, email: string, password: string): Promise<void> {
  if (!email || !password || password.length < 6) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '邮箱和密码不能为空，密码至少 6 位。' }));
    return;
  }

  const runtimeAdapter = getRuntimeAdapter();
  const existing = await runtimeAdapter.getCredentialByEmail(email);
  if (existing) {
    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '该邮箱已注册。' }));
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await runtimeAdapter.createUser(email); // displayName = email for now
  await runtimeAdapter.storeCredential(user.id, email, passwordHash);
  await persistIfEnabled();

  const token = signToken({ userId: user.id, email });
  res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ token, userId: user.id, email }));
}

async function handleLogin(res: ServerResponse, email: string, password: string): Promise<void> {
  const cred = await getRuntimeAdapter().getCredentialByEmail(email);
  if (!cred) {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '邮箱或密码错误。' }));
    return;
  }

  const valid = await verifyPassword(password, cred.passwordHash);
  if (!valid) {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '邮箱或密码错误。' }));
    return;
  }

  const token = signToken({ userId: cred.userId, email: cred.email });
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ token, userId: cred.userId, email: cred.email }));
}

function getAuthUser(req: IncomingMessage): { userId: string; email: string } | null {
  const authHeader = req.headers['authorization'];
  const token = extractToken(authHeader);
  if (!token) return null;
  return verifyToken(token);
}

function requireAuth(req: IncomingMessage, res: ServerResponse): { userId: string; email: string } | null {
  const authUser = getAuthUser(req);
  if (!authUser) {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '请先登录。' }));
    return null;
  }
  return authUser;
}

async function requireOpsAccess(req: IncomingMessage, res: ServerResponse): Promise<OpsPrincipal | null> {
  if (OPS_TOKEN_ENTRIES.length === 0) {
    sendJson(res, { error: 'Soul Ops 后台未启用。请设置 NNZ_OPS_TOKEN 或角色化 token。' }, 404);
    return null;
  }

  const token = getOpsRequestToken(req);
  if (!token) {
    await recordOpsAudit(null, 'ACCESS_DENIED', 'DENIED', {
      reason: 'missing-token',
      path: req.url ?? null,
    });
    sendJson(res, { error: '缺少 Soul Ops 访问 token。' }, 401);
    return null;
  }

  const principal = resolveOpsPrincipal(token, OPS_TOKEN_ENTRIES, safeSecretEquals);
  if (!principal) {
    await recordOpsAudit(null, 'ACCESS_DENIED', 'DENIED', {
      reason: 'invalid-token',
      path: req.url ?? null,
    });
    sendJson(res, { error: 'Soul Ops 访问 token 无效。' }, 403);
    return null;
  }
  return principal;
}

async function recordOpsAudit(
  principal: OpsPrincipal | null,
  action: OpsAuditAction,
  outcome: OpsAuditOutcome,
  metadata: Record<string, string | number | boolean | null> = {},
  targetUserIds: string[] = [],
): Promise<void> {
  const event = {
    action,
    outcome,
    actor: principal?.actor ?? 'ops:anonymous',
    targetUserIds,
    metadata: {
      ...metadata,
      actorRole: principal?.role ?? 'anonymous',
    },
  };
  const scopedOps = getScopedOpsStore();
  if (scopedOps) await scopedOps.recordOpsAuditEvent(event);
  else fixture.store.recordOpsAuditEvent(event);
  await persistIfEnabled();
}

function getScopedOpsStore() {
  return scopedRuntimePersistence?.ops;
}

async function buildCurrentOpsOverview() {
  const scopedOps = getScopedOpsStore();
  return scopedOps
    ? scopedOps.buildOverview(getOpsPersistenceInfo())
    : buildOpsOverview(fixture.store, getOpsPersistenceInfo());
}

async function queryCurrentOpsAuditEvents(query: ReturnType<typeof parseOpsAuditQuery>) {
  const scopedOps = getScopedOpsStore();
  return scopedOps ? scopedOps.queryOpsAuditEvents(query) : queryOpsAuditEvents(fixture.store, query);
}

async function cleanupCurrentTestUsers(dryRun: boolean) {
  const scopedOps = getScopedOpsStore();
  return scopedOps ? scopedOps.cleanupTestUsers(dryRun) : cleanupTestUsers(fixture.store, dryRun);
}

function getOpsRequestToken(req: IncomingMessage): string | null {
  const header = req.headers['x-ops-token'];
  if (Array.isArray(header)) {
    if (header[0]) return header[0];
  } else if (header) {
    return header;
  }
  return extractToken(req.headers['authorization']);
}

function safeSecretEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getOpsPersistenceInfo() {
  return {
    mode: persistenceMode,
    runtimeMode: RUNTIME_PERSISTENCE.runtimeMode,
    requestedRuntimeMode: RUNTIME_PERSISTENCE.requestedRuntimeMode,
    postgresConfigured: Boolean(POSTGRES_URL),
    postgresEnv: POSTGRES_ENV_SOURCE,
    scopedPostgresConfigured: Boolean(RUNTIME_PERSISTENCE.scopedPostgresUrl),
    scopedPostgresEnv: RUNTIME_PERSISTENCE.scopedPostgresEnv,
    sqliteConfigured: Boolean(DB_PATH),
    startupBlocked: Boolean(RUNTIME_PERSISTENCE.startupBlockReason),
    startupBlockReason: RUNTIME_PERSISTENCE.startupBlockReason,
  };
}

function parseOpsAuditQuery(url: URL): {
  action?: OpsAuditAction;
  actor?: string;
  targetUserId?: string;
  limit?: number;
  offset?: number;
} {
  const query: {
    action?: OpsAuditAction;
    actor?: string;
    targetUserId?: string;
    limit?: number;
    offset?: number;
  } = {};
  const action = url.searchParams.get('action');
  if (isOpsAuditAction(action)) query.action = action;
  const actor = normalizeQueryText(url.searchParams.get('actor'));
  if (actor) query.actor = actor;
  const targetUserId = normalizeQueryText(url.searchParams.get('targetUserId'));
  if (targetUserId) query.targetUserId = targetUserId;
  const limit = parseIntegerParam(url.searchParams.get('limit'));
  if (limit !== undefined) query.limit = limit;
  const offset = parseIntegerParam(url.searchParams.get('offset'));
  if (offset !== undefined) query.offset = offset;
  return query;
}

function isOpsAuditAction(value: string | null): value is OpsAuditAction {
  return value === 'ACCESS_DENIED'
    || value === 'OVERVIEW_READ'
    || value === 'CLEANUP_DRY_RUN'
    || value === 'CLEANUP_DELETE'
    || value === 'AUDIT_QUERY';
}

function normalizeQueryText(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseIntegerParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function requireUserPersonaRuntime(
  res: ServerResponse,
  userId: string,
  personaId: string,
): Promise<ScopedPersonaRuntimeAdapter | null> {
  const runtime = getRuntimeAdapter().forPersona({ userId, personaId });
  try {
    await runtime.getPersona();
    return runtime;
  } catch (error) {
    if (error instanceof OwnershipError) {
      sendJson(res, { error: '没有权限访问这段对话。' }, 403);
      return null;
    }
    if (error instanceof NotFoundError) {
      sendJson(res, { error: '没有找到这段对话。' }, 404);
      return null;
    }
    throw error;
  }
}

async function startServer(): Promise<void> {
  await initializePersistence();

  const port = Number(process.env.PORT ?? 3007);
  const host = process.env.HOST ?? '0.0.0.0';
  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`念念在 Soul 作用域演示已启动: http://${displayHost}:${port}`);
  });
}

async function initializePersistence(): Promise<void> {
  if (RUNTIME_PERSISTENCE.startupBlockReason) {
    throw new Error(RUNTIME_PERSISTENCE.startupBlockReason);
  }

  if (RUNTIME_PERSISTENCE.runtimeMode === 'scoped') {
    if (!RUNTIME_PERSISTENCE.scopedPostgresUrl) {
      throw new Error('Scoped runtime mode requires a dedicated Postgres URL.');
    }
    console.log(`Scoped Postgres runtime configured via ${RUNTIME_PERSISTENCE.scopedPostgresEnv ?? 'unknown'}.`);
    scopedRuntimePersistence = createPostgresScopedRuntimePersistence(RUNTIME_PERSISTENCE.scopedPostgresUrl);
    await scopedRuntimePersistence.ensureReady();
    runtimeAdapter = scopedRuntimePersistence.adapter;
    persistenceMode = scopedRuntimePersistence.mode;
    console.log('Scoped runtime adapter initialized from Postgres tables.');
    return;
  }

  if (POSTGRES_URL) {
    console.log(`Postgres persistence configured via ${POSTGRES_ENV_SOURCE ?? 'unknown'}.`);
    postgresPersistence = createPostgresPersistence(POSTGRES_URL);
    const loaded = await postgresPersistence.load(fixture.store);
    persistenceMode = 'postgres';
    if (loaded) {
      refreshDemoFixtureReferences();
      console.log('Store loaded from Postgres.');
    } else {
      console.log('No existing Postgres snapshot, starting fresh.');
      await postgresPersistence.save(fixture.store);
    }
    return;
  }

  if (DB_PATH) {
    console.log('SQLite persistence configured via NNZ_DB_PATH.');
    persistenceMode = 'sqlite';
    const loaded = loadStore(fixture.store, DB_PATH);
    if (loaded) {
      refreshDemoFixtureReferences();
      console.log(`Store loaded from ${DB_PATH}`);
    } else {
      console.log(`No existing data at ${DB_PATH}, starting fresh.`);
      saveStore(fixture.store, DB_PATH);
    }
    return;
  }

  console.log('No persistent store configured; using in-memory demo store.');
}

function readNonEmptyEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function refreshDemoFixtureReferences(): void {
  const data = fixture.store.serialize();
  const userA = data.users.find((user) => user.displayName === '用户 A');
  const userB = data.users.find((user) => user.displayName === '用户 B');
  if (!userA || !userB) {
    throw new Error('Persisted demo store is missing 用户 A or 用户 B.');
  }

  const personaA = data.personas.find((persona) => persona.userId === userA.id && persona.displayName === '爸爸');
  const personaB = data.personas.find((persona) => persona.userId === userB.id && persona.displayName === '爸爸');
  if (!personaA || !personaB) {
    throw new Error('Persisted demo store is missing A/B 爸爸 personas.');
  }

  fixture.userA = userA;
  fixture.userB = userB;
  fixture.personaA = personaA;
  fixture.personaB = personaB;
  fixture.soulA = fixture.store.getLatestSoulVersion({ userId: userA.id, personaId: personaA.id });
  fixture.soulB = fixture.store.getLatestSoulVersion({ userId: userB.id, personaId: personaB.id });
  const correction = fixture.store
    .listMemory({ userId: userA.id, personaId: personaA.id })
    .find((memory) => memory.type === 'CORRECTION');
  if (correction) fixture.correction = correction;
  else delete fixture.correction;

  const correctionProposalId = fixture.store
    .listSoulUpdateProposals({ userId: userA.id, personaId: personaA.id })
    .at(-1)?.id;
  if (correctionProposalId) fixture.correctionProposalId = correctionProposalId;
  else delete fixture.correctionProposalId;

  const node = fixture.store
    .listNodes({ userId: userA.id, personaId: personaA.id })
    .find((node) => node.name === '婚礼');
  if (node) fixture.node = node;
  else delete fixture.node;
}

function createFixture(): DemoFixture {
  const store = new InMemorySoulStore();
  const userA = store.createUser('用户 A');
  const userB = store.createUser('用户 B');
  const personaA = store.createPersona({
    userId: userA.id,
    displayName: '爸爸',
    relationship: '女儿',
    type: 'DECEASED',
  });
  const personaB = store.createPersona({
    userId: userB.id,
    displayName: '爸爸',
    relationship: '儿子',
    type: 'DECEASED',
  });
  const soulA = store.createSoulVersion({
    userId: userA.id,
    personaId: personaA.id,
    kernelJson: {
      identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' },
      affectModel: { humorLevel: 'low' },
      languageModel: { petPhrases: ['你自己拿主意'] },
    },
  });
  const soulB = store.createSoulVersion({
    userId: userB.id,
    personaId: personaB.id,
    kernelJson: {
      identityCore: { displayName: '爸爸', relationship: '儿子心中的父亲' },
      affectModel: { humorLevel: 'medium' },
      languageModel: { petPhrases: ['慢慢来'] },
    },
  });

  return { store, userA, userB, personaA, personaB, soulA, soulB };
}

function applyUserACorrection(): void {
  const pendingProposal = getPendingUserACorrectionProposal();
  if (pendingProposal) {
    fixture.correctionProposalId = pendingProposal.id;
    return;
  }

  if (getUserAHumorLevel() === 'high') {
    const latestProposal = getLatestUserACorrectionProposal();
    if (latestProposal) {
      fixture.correctionProposalId = latestProposal.id;
    }
    return;
  }

  const evidence = fixture.store.addMemory({
    userId: fixture.userA.id,
    personaId: fixture.personaA.id,
    type: 'CORRECTION',
    content: '爸爸其实很幽默，只是不太主动开玩笑。',
    confidence: 1,
    enabledForSoul: true,
  });
  const proposal = fixture.store.createSoulUpdateProposal({
    userId: fixture.userA.id,
    personaId: fixture.personaA.id,
    fieldPath: 'affectModel.humorLevel',
    newValue: 'high',
    evidenceIds: [evidence.id],
  });
  fixture.correction = evidence;
  fixture.correctionProposalId = proposal.id;
}

function userAScope(): UserPersonaScope {
  return { userId: fixture.userA.id, personaId: fixture.personaA.id };
}

function getUserACorrectionProposals(): SoulUpdateProposal[] {
  return fixture.store
    .listSoulUpdateProposals(userAScope())
    .filter((proposal) => proposal.fieldPath === 'affectModel.humorLevel');
}

function getPendingUserACorrectionProposal(): SoulUpdateProposal | undefined {
  return getLastItem(getUserACorrectionProposals().filter((proposal) => proposal.status === 'PENDING'));
}

function getLatestUserACorrectionProposal(): SoulUpdateProposal | undefined {
  return getLastItem(getUserACorrectionProposals());
}

function getUserAHumorLevel(): string | undefined {
  return readStringField(fixture.store.getLatestSoulVersion(userAScope()).kernelJson, 'affectModel', 'humorLevel');
}

function acceptUserACorrectionProposal(): void {
  const scope = userAScope();
  const proposal = getPendingUserACorrectionProposal();
  if (!proposal) return;
  fixture.store.acceptSoulUpdateProposal(scope, proposal.id);
  fixture.correctionProposalId = proposal.id;
}

function rejectUserACorrectionProposal(): void {
  const scope = userAScope();
  const proposal = getPendingUserACorrectionProposal();
  if (!proposal) return;
  fixture.store.rejectSoulUpdateProposal(scope, proposal.id);
  fixture.correctionProposalId = proposal.id;
}

function createUserANodeMemory(): void {
  if (fixture.node) return;

  const node = fixture.store.createNode({
    userId: fixture.userA.id,
    personaId: fixture.personaA.id,
    name: '婚礼',
  });
  fixture.store.addMemory({
    userId: fixture.userA.id,
    personaId: fixture.personaA.id,
    type: 'NODE_MEMORY',
    content: '节点「婚礼」已激活。',
    confidence: 1,
    enabledForSoul: false,
  });
  fixture.store.addConversation({
    userId: fixture.userA.id,
    personaId: fixture.personaA.id,
    nodeId: node.id,
    role: 'USER',
    content: '爸，我要结婚了。',
  });
  fixture.node = node;
}

function sealUserA(): void {
  const scope = { userId: fixture.userA.id, personaId: fixture.personaA.id };
  fixture.store.sealSoul(scope);
}

function activateNodeForUserA(): void {
  const scope = { userId: fixture.userA.id, personaId: fixture.personaA.id };
  fixture.store.activateNode(scope, '婚礼');
}

function completeNodeForUserA(): void {
  const scope = { userId: fixture.userA.id, personaId: fixture.personaA.id };
  fixture.store.completeNode(scope);
}

function graduateUserA(): void {
  const scope = { userId: fixture.userA.id, personaId: fixture.personaA.id };
  fixture.store.graduateSoul(scope);
}

function applySafetyGuard(
  scope: { userId: string; personaId: string },
  message: string,
): { blocked: boolean; reply?: string } {
  const safetyCheck = checkMessageSafety(message);
  if (safetyCheck.blocked) {
    fixture.store.addMemory({
      ...scope,
      type: 'RISK',
      content: `安全护栏触发：用户消息包含敏感内容。原文："${message.slice(0, 80)}"`,
      confidence: 1,
      enabledForSoul: false,
    });
    return safetyCheck;
  }

  const session = fixture.store.getRuntimeSession(scope);
  if (session.state === 'ACTIVE' || session.state === 'NODE') {
    const limitCheck = checkDailyLimit(session);
    if (limitCheck.blocked) {
      return limitCheck;
    }
    incrementDailyCount(session);
  }

  return { blocked: false };
}

function getLastAssistantReply(scope: { userId: string; personaId: string }): string | undefined {
  const conversations = fixture.store.listConversations(scope);
  for (let i = conversations.length - 1; i >= 0; i--) {
    if (conversations[i]!.role === 'ASSISTANT') {
      return conversations[i]!.content;
    }
  }
  return undefined;
}

function isDuplicateMessage(scope: { userId: string; personaId: string }, text: string): boolean {
  const conversations = fixture.store.listConversations(scope);
  for (let i = conversations.length - 1; i >= 0; i--) {
    if (conversations[i]!.role === 'USER') {
      return conversations[i]!.content === text;
    }
  }
  return false;
}

async function applyUserRuntimeSafetyGuard(
  runtime: ScopedPersonaRuntimeAdapter,
  message: string,
): Promise<{ blocked: boolean; reply?: string }> {
  const safetyCheck = checkMessageSafety(message);
  if (safetyCheck.blocked) {
    await runtime.addMemory({
      type: 'RISK',
      content: `安全护栏触发：用户消息包含敏感内容。原文："${message.slice(0, 80)}"`,
      confidence: 1,
      enabledForSoul: false,
    });
    return safetyCheck;
  }

  const session = await runtime.getRuntimeSession();
  if (session.state === 'ACTIVE' || session.state === 'NODE') {
    const limitCheck = checkDailyLimit(session);
    if (limitCheck.blocked) {
      return limitCheck;
    }
    incrementDailyCount(session);
  }

  return { blocked: false };
}

async function getLastUserRuntimeAssistantReply(runtime: ScopedPersonaRuntimeAdapter): Promise<string | undefined> {
  const conversations = await runtime.listConversations();
  for (let i = conversations.length - 1; i >= 0; i--) {
    if (conversations[i]!.role === 'ASSISTANT') {
      return conversations[i]!.content;
    }
  }
  return undefined;
}

async function isDuplicateUserRuntimeMessage(
  runtime: ScopedPersonaRuntimeAdapter,
  text: string,
): Promise<boolean> {
  const conversations = await runtime.listConversations();
  for (let i = conversations.length - 1; i >= 0; i--) {
    if (conversations[i]!.role === 'USER') {
      return conversations[i]!.content === text;
    }
  }
  return false;
}

interface UserPersonaSummary {
  id: string;
  displayName: string;
  relationship: string;
  createdAt: Date;
  memoryCount: number;
  messageCount: number;
}

interface SerializedUserMessage {
  role: ConversationMessage['role'];
  content: string;
  createdAt: Date;
}

async function buildMeResponse(authUser: { userId: string; email: string }) {
  return {
    email: authUser.email,
    personas: await listUserPersonaSummaries(authUser.userId),
  };
}

async function listUserPersonaSummaries(userId: string): Promise<UserPersonaSummary[]> {
  const runtimeAdapter = getRuntimeAdapter();
  const personas = await runtimeAdapter.listPersonasForUser(userId);
  return Promise.all(personas.map(async (persona) => {
    const runtime = runtimeAdapter.forPersona({ userId, personaId: persona.id });
    const [memory, conversations] = await Promise.all([
      runtime.listMemory(),
      runtime.listConversations(),
    ]);
    return {
      id: persona.id,
      displayName: persona.displayName,
      relationship: persona.relationship,
      createdAt: persona.createdAt,
      memoryCount: memory.length,
      messageCount: conversations.length,
    };
  }));
}

async function createUserPersona(
  userId: string,
  input: { displayName?: string; relationship?: string; description?: string; petPhrase?: string; traits?: Record<string, string> },
): Promise<{ persona: UserPersonaSummary; messages: SerializedUserMessage[] }> {
  const displayName = normalizeVisibleText(input.displayName, 24);
  const relationship = normalizeVisibleText(input.relationship, 24);
  const description = normalizeVisibleText(input.description, 600);
  const petPhrase = normalizeVisibleText(input.petPhrase, 40);

  if (!displayName || !relationship) {
    throw new Error('请填写称呼和关系。');
  }

  const runtimeAdapter = getRuntimeAdapter();
  const persona = await runtimeAdapter.createPersona({
    userId,
    displayName,
    relationship,
    type: 'DECEASED',
  });
  const scope = { userId, personaId: persona.id };
  const runtime = runtimeAdapter.forPersona(scope);
  await runtime.createSoulVersion({
    kernelJson: {
      identityCore: {
        displayName,
        relationship,
      },
      affectModel: {
        humorLevel: (input.traits?.humorLevel === 'high' ? 'high' : input.traits?.humorLevel === 'low' ? 'low' : 'medium'),
      },
      languageModel: {
        petPhrases: petPhrase ? [petPhrase] : [],
      },
    },
  });

  if (description) {
    await runtime.addMemory({
      type: 'DESCRIPTION',
      content: description,
      confidence: 0.85,
      enabledForSoul: true,
    });
  }

  await persistIfEnabled();

  return {
    persona: await summarizeUserPersona(runtime),
    messages: await serializeUserMessages(runtime),
  };
}

async function sendMessageToUserPersona(runtime: ScopedPersonaRuntimeAdapter, message: string) {
  const scope = runtime.scope;
  const text = message.trim();
  if (!text) {
    throw new Error('请输入想说的话。');
  }

  const guard = await applyUserRuntimeSafetyGuard(runtime, text);
  const duplicate = await isDuplicateUserRuntimeMessage(runtime, text);
  await runtime.addConversation({ role: 'USER', content: text });

  let reply: string;
  if (duplicate) {
    reply = await getLastUserRuntimeAssistantReply(runtime) ?? '嗯，我听见了。';
  } else if (guard.blocked && guard.reply) {
    reply = guard.reply;
  } else {
    try {
      const ctx = await runtime.getRuntimeContext();
      if (llmAdapter) {
        reply = await generateLlmReply(llmAdapter, {
          soul: ctx.soul,
          memories: ctx.memories,
          recentConversations: await runtime.listConversations(),
          message: text,
        });
      } else {
        reply = generateSoulReply({
          soul: ctx.soul,
          memories: ctx.memories,
          message: text,
        }).content;
      }
    } catch (error) {
      if (error instanceof CovenantStateError) {
        reply = error.message.includes('SEALED') ? '现在先让这段思念休息一下。等到重要时刻，我们再重新打开。' : '这段告别已经完成了。谢谢你曾经认真说过这些话。';
      } else {
        throw error;
      }
    }
  }

  await runtime.addConversation({ role: 'ASSISTANT', content: reply });

  if (llmAdapter && RUNTIME_PERSISTENCE.runtimeMode !== 'scoped') {
    const adapter = llmAdapter;
    setImmediate(async () => {
      try {
        await extractionOrchestrator.maybeExtractAndPropose(scope, fixture.store, adapter);
        await persistIfEnabled();
      } catch (err) {
        console.error('Extraction error (user persona):', err instanceof Error ? err.message : String(err));
      }
    });
  }

  await persistIfEnabled();

  return {
    persona: await summarizeUserPersona(runtime),
    messages: await serializeUserMessages(runtime),
    reply,
  };
}

async function summarizeUserPersona(runtime: ScopedPersonaRuntimeAdapter): Promise<UserPersonaSummary> {
  const [persona, memory, conversations] = await Promise.all([
    runtime.getPersona(),
    runtime.listMemory(),
    runtime.listConversations(),
  ]);
  return {
    id: persona.id,
    displayName: persona.displayName,
    relationship: persona.relationship,
    createdAt: persona.createdAt,
    memoryCount: memory.length,
    messageCount: conversations.length,
  };
}

async function serializeUserMessages(runtime: ScopedPersonaRuntimeAdapter): Promise<SerializedUserMessage[]> {
  const conversations = await runtime.listConversations();
  return conversations.map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));
}

function normalizeVisibleText(value: string | undefined, maxLength: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}


async function persistIfEnabled(): Promise<void> {
  if (RUNTIME_PERSISTENCE.runtimeMode === 'scoped') {
    return;
  }

  if (postgresPersistence) {
    await postgresPersistence.save(fixture.store).catch((err: unknown) => {
      console.error('Failed to persist store to Postgres:', err instanceof Error ? err.message : String(err));
    });
    return;
  }

  if (!DB_PATH) return;

  try {
    saveStore(fixture.store, DB_PATH);
  } catch (err) {
    console.error('Failed to persist store:', err instanceof Error ? err.message : String(err));
  }
}

async function sendMessageToBothUsers(message: string) {
  const text = message.trim() || '爸，我今天有点紧张。';
  const scopeA = { userId: fixture.userA.id, personaId: fixture.personaA.id };
  const scopeB = { userId: fixture.userB.id, personaId: fixture.personaB.id };

  // Safety guard: check message before generating replies
  const guardA = applySafetyGuard(scopeA, text);
  const guardB = applySafetyGuard(scopeB, text);

  const duplicateA = isDuplicateMessage(scopeA, text);
  const duplicateB = isDuplicateMessage(scopeB, text);

  fixture.store.addConversation({ ...scopeA, role: 'USER', content: text });
  fixture.store.addConversation({ ...scopeB, role: 'USER', content: text });

  let replyA: string;
  let replyB: string;

  if (duplicateA) {
    replyA = getLastAssistantReply(scopeA) ?? '（嗯，我听见了。）';
  } else if (guardA.blocked && guardA.reply) {
    replyA = guardA.reply;
  } else {
    try {
      const ctxA = fixture.store.getRuntimeContext(scopeA);
      if (llmAdapter) {
        replyA = await generateLlmReply(llmAdapter, {
          soul: ctxA.soul,
          memories: ctxA.memories,
          recentConversations: fixture.store.listConversations(scopeA),
          message: text,
        });
      } else {
        replyA = generateSoulReply({
          soul: ctxA.soul,
          memories: ctxA.memories,
          message: text,
        }).content;
      }
    } catch (error) {
      if (error instanceof CovenantStateError) {
        replyA = error.message.includes('SEALED') ? SEALED_REPLY : GRADUATED_REPLY;
      } else {
        throw error;
      }
    }
  }

  if (duplicateB) {
    replyB = getLastAssistantReply(scopeB) ?? '（嗯，我听见了。）';
  } else if (guardB.blocked && guardB.reply) {
    replyB = guardB.reply;
  } else {
    try {
      const ctxB = fixture.store.getRuntimeContext(scopeB);
      if (llmAdapter) {
        replyB = await generateLlmReply(llmAdapter, {
          soul: ctxB.soul,
          memories: ctxB.memories,
          recentConversations: fixture.store.listConversations(scopeB),
          message: text,
        });
      } else {
        replyB = generateSoulReply({
          soul: ctxB.soul,
          memories: ctxB.memories,
          message: text,
        }).content;
      }
    } catch (error) {
      if (error instanceof CovenantStateError) {
        replyB = error.message.includes('SEALED') ? SEALED_REPLY : GRADUATED_REPLY;
      } else {
        throw error;
      }
    }
  }

  fixture.store.addConversation({ ...scopeA, role: 'ASSISTANT', content: replyA });
  fixture.store.addConversation({ ...scopeB, role: 'ASSISTANT', content: replyB });

  // Trigger extraction pipeline asynchronously (fire-and-forget)
  if (llmAdapter) {
    const adapter = llmAdapter;
    setImmediate(async () => {
      try {
        const proposals = await extractionOrchestrator.maybeExtractAndPropose(scopeA, fixture.store, adapter);
        if (proposals.length) {
          console.log(`Extraction generated ${proposals.length} proposal(s) for user A.`);
        }
        await persistIfEnabled();
      } catch (err) {
        console.error('Extraction error (user A):', err instanceof Error ? err.message : String(err));
      }
      try {
        const proposalsB = await extractionOrchestrator.maybeExtractAndPropose(scopeB, fixture.store, adapter);
        if (proposalsB.length) {
          console.log(`Extraction generated ${proposalsB.length} proposal(s) for user B.`);
        }
        await persistIfEnabled();
      } catch (err) {
        console.error('Extraction error (user B):', err instanceof Error ? err.message : String(err));
      }
    });
  }

  await persistIfEnabled();
  return serializeFixture();
}

function serializeFixture() {
  const scopeA = { userId: fixture.userA.id, personaId: fixture.personaA.id };
  const scopeB = { userId: fixture.userB.id, personaId: fixture.personaB.id };

  return {
    userA: {
      user: fixture.userA,
      persona: fixture.personaA,
      latestSoul: getLatestSoulSafe(scopeA),
      memory: fixture.store.listMemory(scopeA),
      nodes: fixture.store.listNodes(scopeA),
      conversations: fixture.store.listConversations(scopeA),
      session: fixture.store.getRuntimeSession(scopeA),
      proposals: fixture.store.listSoulUpdateProposals(scopeA),
      proposalEvidence: fixture.store.listSoulUpdateProposals(scopeA).map((proposal) => ({
        proposalId: proposal.id,
        evidence: fixture.store.listSoulUpdateProposalEvidence(scopeA, proposal.id),
      })),
      ops: {
        maturity: fixture.store.buildSoulMaturityReport(scopeA),
      },
    },
    userB: {
      user: fixture.userB,
      persona: fixture.personaB,
      latestSoul: getLatestSoulSafe(scopeB),
      memory: fixture.store.listMemory(scopeB),
      nodes: fixture.store.listNodes(scopeB),
      conversations: fixture.store.listConversations(scopeB),
      session: fixture.store.getRuntimeSession(scopeB),
      proposals: fixture.store.listSoulUpdateProposals(scopeB),
      proposalEvidence: fixture.store.listSoulUpdateProposals(scopeB).map((proposal) => ({
        proposalId: proposal.id,
        evidence: fixture.store.listSoulUpdateProposalEvidence(scopeB, proposal.id),
      })),
      ops: {
        maturity: fixture.store.buildSoulMaturityReport(scopeB),
      },
    },
  };
}

function getLatestSoulSafe(scope: { userId: string; personaId: string }): SoulVersion | null {
  try {
    return fixture.store.getLatestSoulVersion(scope);
  } catch {
    return null;
  }
}

function buildVerification() {
  const state = serializeFixture();
  const userAHumor = readStringField(state.userA.latestSoul?.kernelJson, 'affectModel', 'humorLevel');
  const userBHumor = readStringField(state.userB.latestSoul?.kernelJson, 'affectModel', 'humorLevel');
  const userANodeMemoryCount = state.userA.memory.filter((memory) => memory.type === 'NODE_MEMORY').length;
  const userBNodeMemoryCount = state.userB.memory.filter((memory) => memory.type === 'NODE_MEMORY').length;
  const userANodeConversationCount = state.userA.conversations.filter((message) => message.nodeId).length;
  const userBNodeConversationCount = state.userB.conversations.filter((message) => message.nodeId).length;

  return {
    summary: {
      userAPersonaName: state.userA.persona.displayName,
      userBPersonaName: state.userB.persona.displayName,
      userASoulVersion: state.userA.latestSoul?.version ?? 0,
      userBSoulVersion: state.userB.latestSoul?.version ?? 0,
      userAHumor,
      userBHumor,
      userAMemoryCount: userANodeMemoryCount,
      userBMemoryCount: userBNodeMemoryCount,
      userANodeCount: state.userA.nodes.length,
      userBNodeCount: state.userB.nodes.length,
      userACovenantState: state.userA.session.state,
      userBCovenantState: state.userB.session.state,
    },
    checks: [
      {
        id: 'same-name-separate-soul',
        title: '同名人格仍然生成两套 Soul',
        passed: state.userA.persona.displayName === '爸爸'
          && state.userB.persona.displayName === '爸爸'
          && state.userA.latestSoul?.id !== state.userB.latestSoul?.id,
        evidence: `A Soul=${shortId(state.userA.latestSoul?.id ?? '')}，B Soul=${shortId(state.userB.latestSoul?.id ?? '')}`,
      },
      {
        id: 'correction-is-user-scoped',
        title: '用户 A 的纠正不影响用户 B',
        passed: userAHumor === 'high' && userBHumor === 'medium',
        evidence: `A 幽默感=${String(userAHumor)}，B 幽默感=${String(userBHumor)}`,
      },
      {
        id: 'node-memory-is-user-scoped',
        title: '用户 A 的婚礼节点记忆不会出现在用户 B',
        passed: userANodeMemoryCount === 1 && userBNodeMemoryCount === 0,
        evidence: `A 节点记忆=${userANodeMemoryCount}，B 节点记忆=${userBNodeMemoryCount}`,
      },
      {
        id: 'node-is-user-scoped',
        title: '用户 A 的节点不会出现在用户 B',
        passed: state.userA.nodes.length === 1 && state.userB.nodes.length === 0,
        evidence: `A 节点=${state.userA.nodes.length}，B 节点=${state.userB.nodes.length}`,
      },
      {
        id: 'conversation-is-user-scoped',
        title: '用户 A 的节点对话不会出现在用户 B',
        passed: userANodeConversationCount === 1 && userBNodeConversationCount === 0,
        evidence: `A 节点对话=${userANodeConversationCount}，B 节点对话=${userBNodeConversationCount}`,
      },
      {
        id: 'covenant-state-tracks-separately',
        title: 'A 的封存/毕业不影响 B 的 ACTIVE 状态',
        passed: state.userB.session.state === 'ACTIVE',
        evidence: `A 状态=${state.userA.session.state}，B 状态=${state.userB.session.state}`,
      },
    ],
  };
}

function renderOpsPage(opsEnabled: boolean): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>念念在 Soul Ops</title>
  <style>
    :root {
      color-scheme: light;
      --bg:#F7F5EF;
      --surface:#FFFFFF;
      --ink:#20231F;
      --muted:#6E756D;
      --line:#DDD8CC;
      --sage:#4F7564;
      --amber:#B77928;
      --red:#A94442;
      --blue:#3D6278;
      --soft:#EEF3EE;
    }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Noto Sans SC","PingFang SC",sans-serif; }
    main { max-width:1280px; margin:0 auto; padding:28px 24px 56px; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:22px; }
    h1 { margin:0 0 6px; font-size:30px; letter-spacing:0; }
    h2 { margin:0 0 14px; font-size:18px; }
    h3 { margin:0; font-size:15px; }
    p { line-height:1.6; }
    .eyebrow { color:var(--sage); font-weight:800; font-size:12px; letter-spacing:.08em; text-transform:uppercase; margin:0 0 4px; }
    .muted { color:var(--muted); }
    .toolbar { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; align-items:center; }
    input, select { min-height:40px; border:1px solid var(--line); border-radius:8px; padding:9px 12px; font:inherit; background:#fff; color:var(--ink); }
    input[type="password"] { min-width:260px; }
    button { min-height:40px; border:0; border-radius:8px; background:var(--sage); color:#fff; padding:9px 14px; font-weight:800; cursor:pointer; }
    button.secondary { background:var(--blue); }
    button.ghost { background:#fff; color:var(--sage); border:1px solid var(--line); }
    button.danger { background:var(--red); }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .status { border:1px solid var(--line); background:var(--surface); padding:12px 14px; border-radius:8px; margin:0 0 18px; }
    .status.error { border-color:#E3B4AA; background:#FFF4F1; color:#8E332F; }
    .status.ok { border-color:#BFD5C4; background:#F1F7F2; color:#315B3F; }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 18px; }
    .tab-button { background:#fff; color:var(--sage); border:1px solid var(--line); }
    .tab-button.active { background:var(--sage); color:#fff; border-color:var(--sage); }
    .layout { display:grid; grid-template-columns:320px minmax(0,1fr); gap:18px; align-items:start; }
    .panel { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:18px; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:18px; }
    .metric { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .metric span { display:block; color:var(--muted); font-size:12px; font-weight:800; margin-bottom:6px; }
    .metric strong { font-size:26px; line-height:1; }
    .cleanup-list { display:grid; gap:8px; margin:14px 0; }
    .cleanup-item { border:1px solid var(--line); border-radius:8px; padding:10px; background:#FCFBF7; }
    .cleanup-item code, .scope { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; background:#EEF3EE; border-radius:6px; padding:2px 6px; }
    .confirm-row { display:grid; gap:8px; margin-top:12px; }
    .filter-grid { display:grid; grid-template-columns:1.2fr 1.2fr 1.5fr .8fr auto auto; gap:10px; margin:12px 0; align-items:end; }
    .audit-head { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; margin-bottom:10px; }
    .audit-pager { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:flex-end; margin-top:12px; }
    .audit-meta { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .metadata { max-width:360px; overflow-wrap:anywhere; }
    table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    th, td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
    th { background:#F0EEE7; color:#555D55; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    tr:last-child td { border-bottom:0; }
    .tag { display:inline-flex; align-items:center; gap:4px; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:800; background:#ECE8DE; color:#5F594F; white-space:nowrap; }
    .tag.test { background:#FFF0D8; color:#8A5B14; }
    .tag.demo { background:#EAF0F8; color:#365C7A; }
    .tag.active { background:#E4F2E7; color:#315B3F; }
    .tag.sealed { background:#F3EDE1; color:#765C36; }
    .tag.node { background:#FFF0D8; color:#8A5B14; }
    .tag.graduated { background:#EEE8F5; color:#594779; }
    .personas { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:18px; }
    .persona { border:1px solid var(--line); border-radius:8px; background:var(--surface); padding:16px; }
    .persona-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
    .score-row { display:grid; grid-template-columns:86px minmax(0,1fr); gap:14px; align-items:center; }
    .score { font-size:42px; font-weight:900; color:var(--amber); line-height:1; }
    .bars { display:grid; gap:7px; margin-top:12px; }
    .bar-row { display:grid; grid-template-columns:96px minmax(0,1fr) 36px; gap:8px; align-items:center; color:#4A514B; font-size:12px; }
    .bar-track { height:8px; background:#E5E1D7; border-radius:999px; overflow:hidden; }
    .bar-fill { height:100%; background:var(--sage); }
    .mini-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin-top:12px; }
    .mini { background:#FAF9F4; border:1px solid var(--line); border-radius:8px; padding:8px; }
    .mini span { display:block; color:var(--muted); font-size:11px; }
    .mini strong { font-size:17px; }
    .recommendations { display:grid; gap:6px; margin-top:10px; }
    .recommendation { background:#FAF9F4; border:1px solid var(--line); border-radius:8px; padding:8px; font-size:12px; }
    .empty { border:1px dashed var(--line); background:#FCFBF7; padding:14px; border-radius:8px; color:var(--muted); }
    @media (max-width: 900px) {
      header, .toolbar { display:block; }
      .toolbar { margin-top:14px; }
      .toolbar input, .toolbar button { width:100%; margin-bottom:8px; }
      .layout, .personas, .filter-grid { grid-template-columns:1fr; }
      .metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .bar-row { grid-template-columns:1fr; }
      table { display:block; overflow-x:auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="eyebrow">Soul Ops Console</p>
        <h1>后台治理工作台</h1>
        <p class="muted">内部视图：用户、Persona、成熟度、提案队列、节点与测试数据清理。</p>
      </div>
      <div class="toolbar">
        <input id="opsToken" type="password" placeholder="Soul Ops token">
        <button onclick="saveToken()">连接</button>
        <button class="ghost" onclick="clearToken()">清除</button>
        <button class="secondary" onclick="loadOverview()">刷新</button>
      </div>
    </header>
    <div id="status" class="status">准备连接后台。</div>
    <section id="app"></section>
  </main>
  <script>
    const OPS_ENABLED = ${opsEnabled ? 'true' : 'false'};
    const AUDIT_ACTIONS = ['ACCESS_DENIED', 'OVERVIEW_READ', 'CLEANUP_DRY_RUN', 'CLEANUP_DELETE', 'AUDIT_QUERY'];
    let overview = null;
    let activeTab = 'dashboard';
    const auditState = {
      action: '',
      actor: '',
      targetUserId: '',
      limit: 20,
      offset: 0
    };

    const savedToken = sessionStorage.getItem('nnz_ops_token') || '';
    document.getElementById('opsToken').value = savedToken;

    if (!OPS_ENABLED) {
      setStatus('error', '后台未启用：需要在服务端设置 NNZ_OPS_TOKEN 或角色化 token。');
      document.getElementById('app').innerHTML = '<div class="empty">当前实例没有开启 Soul Ops API。配置环境变量后重新部署即可访问。</div>';
    } else if (savedToken) {
      loadOverview();
    }

    function saveToken() {
      const token = document.getElementById('opsToken').value.trim();
      if (!token) {
        setStatus('error', '请输入后台访问 token。');
        return;
      }
      sessionStorage.setItem('nnz_ops_token', token);
      loadOverview();
    }

    function clearToken() {
      sessionStorage.removeItem('nnz_ops_token');
      document.getElementById('opsToken').value = '';
      overview = null;
      activeTab = 'dashboard';
      setStatus('', '已清除本页 token。');
      document.getElementById('app').innerHTML = '';
    }

    async function loadOverview() {
      if (!OPS_ENABLED) return;
      const token = document.getElementById('opsToken').value.trim() || sessionStorage.getItem('nnz_ops_token') || '';
      if (!token) {
        setStatus('error', '请输入后台访问 token。');
        return;
      }
      setStatus('', '正在读取后台数据...');
      const res = await fetch('/api/ops/overview', { headers: { 'x-ops-token': token } });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error', data.error || '读取失败。');
        return;
      }
      sessionStorage.setItem('nnz_ops_token', token);
      overview = data;
      setStatus('ok', '已连接：' + data.principal.role + '。数据生成时间：' + formatDate(data.generatedAt));
      renderApp(data);
    }

    async function runCleanup(dryRun) {
      if (!overview) return;
      const token = document.getElementById('opsToken').value.trim() || sessionStorage.getItem('nnz_ops_token') || '';
      const confirm = document.getElementById('cleanupConfirm') ? document.getElementById('cleanupConfirm').value.trim() : '';
      setStatus('', dryRun ? '正在生成清理预案...' : '正在执行测试数据清理...');
      const res = await fetch('/api/ops/cleanup-test-users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ops-token': token },
        body: JSON.stringify({ dryRun, confirm })
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error', data.error || '清理请求失败。');
        return;
      }
      const result = data.result;
      setStatus('ok', dryRun
        ? 'Dry-run 完成：发现 ' + result.plan.totals.users + ' 个测试用户。'
        : '清理完成：删除 ' + result.deletedUserIds.length + ' 个测试用户，生成 ' + result.receipts.length + ' 条回执。');
      await loadOverview();
    }

    function renderApp(data) {
      document.getElementById('app').innerHTML =
        '<section class="metrics">' + renderMetrics(data) + '</section>' +
        renderTabs() +
        '<section id="opsView"></section>';
      renderActiveTab();
    }

    function renderTabs() {
      return '<nav class="tabs" aria-label="Soul Ops sections">' +
        '<button class="tab-button' + (activeTab === 'dashboard' ? ' active' : '') + '" onclick="switchTab(\\'dashboard\\')">Dashboard</button>' +
        '<button class="tab-button' + (activeTab === 'audit' ? ' active' : '') + '" onclick="switchTab(\\'audit\\')">Audit</button>' +
      '</nav>';
    }

    function switchTab(tab) {
      activeTab = tab;
      if (!overview) return;
      renderApp(overview);
    }

    function renderActiveTab() {
      const view = document.getElementById('opsView');
      if (!view || !overview) return;
      if (activeTab === 'audit') {
        view.innerHTML = renderAuditPanel();
        syncAuditControls();
        loadAuditEvents();
        return;
      }
      view.innerHTML =
        '<section class="layout">' +
          '<aside class="panel">' + renderPrincipal(overview.principal, overview.permissions) + renderCleanup(overview.cleanupPlan, overview.permissions) + renderRecentAudit(overview.audit) + '</aside>' +
          '<section>' +
            '<div class="panel">' +
              '<h2>用户总览</h2>' +
              renderUserTable(overview.users) +
            '</div>' +
            '<div class="personas">' + renderPersonas(overview.users) + '</div>' +
          '</section>' +
        '</section>';
    }

    function renderAuditPanel() {
      return '<section class="panel">' +
        '<div class="audit-head"><div><h2>Audit Events</h2>' +
        '<p class="muted">内部审计视图：按动作、操作者和目标用户查询后台访问、清理与拒绝记录。</p></div>' +
        '<div class="audit-meta"><span class="tag">' + escapeHtml(overview.principal.role) + '</span><span class="scope">' + escapeHtml(overview.principal.actor) + '</span></div></div>' +
        '<div class="filter-grid">' +
          '<label><span class="muted">Action</span><select id="auditAction"><option value="">全部动作</option>' +
            AUDIT_ACTIONS.map(function(action) { return '<option value="' + action + '">' + action + '</option>'; }).join('') +
          '</select></label>' +
          '<label><span class="muted">Actor</span><input id="auditActor" placeholder="ops:admin"></label>' +
          '<label><span class="muted">Target userId</span><input id="auditTargetUserId" placeholder="user_..."></label>' +
          '<label><span class="muted">Limit</span><select id="auditLimit"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>' +
          '<button onclick="applyAuditFilters()">查询</button>' +
          '<button class="ghost" onclick="resetAuditFilters()">重置</button>' +
        '</div>' +
        '<div id="auditStatus" class="muted">准备读取审计事件。</div>' +
        '<div id="auditResults" style="margin-top:12px;"></div>' +
      '</section>';
    }

    function syncAuditControls() {
      setControlValue('auditAction', auditState.action);
      setControlValue('auditActor', auditState.actor);
      setControlValue('auditTargetUserId', auditState.targetUserId);
      setControlValue('auditLimit', String(auditState.limit));
    }

    function setControlValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }

    function getOpsToken() {
      return document.getElementById('opsToken').value.trim() || sessionStorage.getItem('nnz_ops_token') || '';
    }

    async function loadAuditEvents(offset) {
      if (!OPS_ENABLED || !overview || activeTab !== 'audit') return;
      if (typeof offset === 'number') auditState.offset = Math.max(0, offset);
      const token = getOpsToken();
      if (!token) {
        setAuditStatus('请输入后台访问 token。');
        return;
      }
      const params = new URLSearchParams();
      if (auditState.action) params.set('action', auditState.action);
      if (auditState.actor) params.set('actor', auditState.actor);
      if (auditState.targetUserId) params.set('targetUserId', auditState.targetUserId);
      params.set('limit', String(auditState.limit));
      params.set('offset', String(auditState.offset));
      setAuditStatus('正在读取审计事件...');
      const res = await fetch('/api/ops/audit-events?' + params.toString(), { headers: { 'x-ops-token': token } });
      const data = await res.json();
      if (!res.ok) {
        setAuditStatus(data.error || '读取审计事件失败。');
        return;
      }
      renderAuditResults(data);
    }

    function applyAuditFilters() {
      auditState.action = getControlValue('auditAction');
      auditState.actor = getControlValue('auditActor').trim();
      auditState.targetUserId = getControlValue('auditTargetUserId').trim();
      auditState.limit = Number(getControlValue('auditLimit')) || 20;
      auditState.offset = 0;
      loadAuditEvents();
    }

    function resetAuditFilters() {
      auditState.action = '';
      auditState.actor = '';
      auditState.targetUserId = '';
      auditState.limit = 20;
      auditState.offset = 0;
      syncAuditControls();
      loadAuditEvents();
    }

    function getControlValue(id) {
      const el = document.getElementById(id);
      return el ? el.value : '';
    }

    function setAuditStatus(text) {
      const el = document.getElementById('auditStatus');
      if (el) el.textContent = text;
    }

    function renderAuditResults(data) {
      const page = data.pagination;
      auditState.limit = page.limit;
      auditState.offset = page.offset;
      setAuditStatus('共 ' + page.total + ' 条，当前显示 ' + page.returned + ' 条。生成时间：' + formatDate(data.generatedAt));
      const resultEl = document.getElementById('auditResults');
      if (!resultEl) return;
      const rows = data.events.length
        ? data.events.map(function(event) {
            const targets = event.targetUserIds && event.targetUserIds.length
              ? event.targetUserIds.map(shortId).join(', ')
              : '-';
            return '<tr><td><strong>' + escapeHtml(event.action) + '</strong><br><span class="tag">' + escapeHtml(event.outcome) + '</span></td>' +
              '<td>' + escapeHtml(event.actor) + '</td>' +
              '<td><span class="scope">' + escapeHtml(targets) + '</span></td>' +
              '<td class="metadata">' + escapeHtml(formatMetadata(event.metadata)) + '</td>' +
              '<td>' + formatDate(event.createdAt) + '</td></tr>';
          }).join('')
        : '';
      resultEl.innerHTML = rows
        ? '<table><thead><tr><th>Action</th><th>Actor</th><th>Targets</th><th>Metadata</th><th>Created</th></tr></thead><tbody>' + rows + '</tbody></table>' + renderAuditPager(page)
        : '<div class="empty">没有匹配的审计事件。</div>' + renderAuditPager(page);
    }

    function renderAuditPager(page) {
      const prevOffset = Math.max(0, page.offset - page.limit);
      const nextOffset = page.offset + page.limit;
      return '<div class="audit-pager">' +
        '<span class="muted">offset ' + page.offset + ' / limit ' + page.limit + '</span>' +
        '<button class="ghost" onclick="loadAuditEvents(' + prevOffset + ')"' + (page.offset <= 0 ? ' disabled' : '') + '>上一页</button>' +
        '<button class="ghost" onclick="loadAuditEvents(' + nextOffset + ')"' + (page.hasMore ? '' : ' disabled') + '>下一页</button>' +
      '</div>';
    }

    function renderMetrics(data) {
      const persistence = data.persistence.mode === 'memory' ? 'in-memory' : data.persistence.mode;
      return [
        metric('Users', data.totals.users),
        metric('Personas', data.totals.personas),
        metric('Memories', data.totals.memories),
        metric('Pending Proposals', data.totals.pendingProposals),
        metric('Nodes', data.totals.nodes),
        metric('Conversations', data.totals.conversations),
        metric('Test Users', data.totals.testUsers),
        metric('Audit Events', data.totals.opsAuditEvents),
        metric('Persistence', persistence)
      ].join('');
    }

    function metric(label, value) {
      return '<article class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></article>';
    }

    function renderPrincipal(principal, permissions) {
      return '<h2>访问角色</h2>' +
        '<p><span class="tag active">' + escapeHtml(principal.role) + '</span></p>' +
        '<p class="muted">actor：' + escapeHtml(principal.actor) + '</p>' +
        '<div class="mini-grid">' +
          mini('Overview', permissions.canReadOverview ? 'YES' : 'NO') +
          mini('Dry-run', permissions.canDryRunCleanup ? 'YES' : 'NO') +
          mini('Delete', permissions.canDeleteCleanup ? 'YES' : 'NO') +
          mini('Audit', 'YES') +
        '</div>' +
        '<hr style="border:0;border-top:1px solid var(--line);margin:18px 0;">';
    }

    function renderCleanup(plan, permissions) {
      const items = plan.users.length
        ? '<div class="cleanup-list">' + plan.users.map(function(user) {
            return '<div class="cleanup-item"><strong>' + escapeHtml(user.email || user.displayName) + '</strong>' +
              '<p class="muted">原因：' + escapeHtml(user.reason) + '</p>' +
              '<p><code>' + shortId(user.userId) + '</code> Persona ' + user.counts.personas +
              ' / Memory ' + user.counts.memories + ' / Conversation ' + user.counts.conversations + '</p></div>';
          }).join('') + '</div>'
        : '<div class="empty">没有发现可清理的测试用户。</div>';

      return '<h2>测试数据清理</h2>' +
        '<p class="muted">只匹配明确 smoke/test 账号，不触碰 A/B 演示用户和普通用户。</p>' +
        '<p><span class="tag test">可清理 ' + plan.totals.users + '</span></p>' +
        items +
        '<div class="confirm-row">' +
          '<button class="ghost" onclick="runCleanup(true)"' + (permissions.canDryRunCleanup ? '' : ' disabled') + '>Dry-run</button>' +
          '<input id="cleanupConfirm" placeholder="DELETE_TEST_USERS">' +
          '<button class="danger" onclick="runCleanup(false)"' + (permissions.canDeleteCleanup ? '' : ' disabled') + '>确认清理</button>' +
        '</div>';
    }

    function renderRecentAudit(audit) {
      const recent = audit && audit.recent ? audit.recent : [];
      const items = recent.length
        ? '<div class="cleanup-list">' + recent.slice(0, 8).map(function(event) {
            const targets = event.targetUserIds && event.targetUserIds.length
              ? event.targetUserIds.map(shortId).join(', ')
              : '-';
            return '<div class="cleanup-item"><strong>' + escapeHtml(event.action) + '</strong> ' +
              '<span class="tag">' + escapeHtml(event.outcome) + '</span>' +
              '<p class="muted">' + formatDate(event.createdAt) + ' · actor ' + escapeHtml(event.actor) + '</p>' +
              '<p><span class="scope">' + escapeHtml(targets) + '</span></p>' +
              '<p class="muted">' + escapeHtml(formatMetadata(event.metadata)) + '</p></div>';
          }).join('') + '</div>'
        : '<div class="empty">暂无后台操作记录。</div>';
      return '<hr style="border:0;border-top:1px solid var(--line);margin:18px 0;">' +
        '<h2>最近后台操作</h2>' +
        '<p class="muted">记录 overview、dry-run、删除尝试和授权拒绝。</p>' +
        '<p><span class="tag">累计 ' + escapeHtml(audit ? audit.total : 0) + '</span></p>' +
        items;
    }

    function renderUserTable(users) {
      if (!users.length) return '<div class="empty">暂无用户。</div>';
      return '<table><thead><tr><th>User</th><th>Tags</th><th>Counts</th><th>Created</th></tr></thead><tbody>' +
        users.map(function(user) {
          const tags = [
            user.isDemoUser ? '<span class="tag demo">DEMO</span>' : '',
            user.isTestUser ? '<span class="tag test">TEST</span>' : ''
          ].filter(Boolean).join(' ');
          return '<tr><td><strong>' + escapeHtml(user.email || user.displayName) + '</strong><br><span class="scope">' + shortId(user.id) + '</span></td>' +
            '<td>' + (tags || '<span class="muted">-</span>') + '</td>' +
            '<td>Persona ' + user.counts.personas + ' / Memory ' + user.counts.memories + ' / Proposal ' + user.counts.proposals + ' / Message ' + user.counts.conversations + '</td>' +
            '<td>' + formatDate(user.createdAt) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    function renderPersonas(users) {
      const personas = users.flatMap(function(user) {
        return user.personas.map(function(persona) {
          return { user: user, persona: persona };
        });
      });
      if (!personas.length) return '<div class="empty">暂无 Persona。</div>';
      return personas.map(function(item) {
        return renderPersona(item.user, item.persona);
      }).join('');
    }

    function renderPersona(user, persona) {
      const report = persona.maturity;
      const stateClassName = String(report.runtimeState || '').toLowerCase();
      const dimensions = [
        ['证据覆盖', report.evidenceCoverage],
        ['身份清晰', report.identityClarity],
        ['语气稳定', report.voiceConsistency],
        ['记忆可靠', report.memoryReliability],
        ['运行稳定', report.runtimeStability],
        ['安全就绪', report.safetyReadiness]
      ];
      const bars = dimensions.map(function(pair) {
        return '<div class="bar-row"><span>' + pair[0] + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Number(pair[1]) + '%"></div></div><strong>' + Number(pair[1]) + '</strong></div>';
      }).join('');
      const recommendations = report.recommendations.length
        ? report.recommendations.slice(0, 3).map(function(item) {
            return '<div class="recommendation"><strong>' + escapeHtml(item.priority) + '</strong> ' + escapeHtml(item.type) + '<br><span class="muted">' + escapeHtml(item.reason) + '</span></div>';
          }).join('')
        : '<div class="recommendation"><strong>OK</strong> <span class="muted">暂无开放建议。</span></div>';

      return '<article class="persona">' +
        '<div class="persona-head"><div><h3>' + escapeHtml(user.email || user.displayName) + ' / ' + escapeHtml(persona.displayName) + '</h3>' +
        '<p class="muted">' + escapeHtml(persona.relationship) + ' · <span class="scope">' + shortId(report.userId) + ' + ' + shortId(report.personaId) + '</span></p></div>' +
        '<span class="tag ' + stateClassName + '">' + escapeHtml(report.runtimeState) + '</span></div>' +
        '<div class="score-row"><div class="score">' + report.score + '</div><div><span class="tag">' + escapeHtml(report.level) + '</span><p class="muted">Soul v' + escapeHtml(persona.latestSoulVersion || '-') + ' · ' + escapeHtml(persona.latestSoulStatus || '-') + '</p></div></div>' +
        '<div class="bars">' + bars + '</div>' +
        '<div class="mini-grid">' +
          mini('Memory', report.memoryCount) +
          mini('Proposal', report.proposalCount) +
          mini('Snapshot', report.snapshotCount) +
          mini('Node', report.nodeCount) +
        '</div>' +
        '<div class="recommendations">' + recommendations + '</div>' +
      '</article>';
    }

    function mini(label, value) {
      return '<div class="mini"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }

    function setStatus(kind, text) {
      const el = document.getElementById('status');
      el.className = 'status' + (kind ? ' ' + kind : '');
      el.textContent = text;
    }

    function shortId(id) {
      return String(id || '').slice(0, 13);
    }

    function formatDate(value) {
      if (!value) return '-';
      try {
        return new Date(value).toLocaleString('zh-CN', { hour12:false });
      } catch {
        return String(value);
      }
    }

    function formatMetadata(metadata) {
      if (!metadata || typeof metadata !== 'object') return '';
      return Object.keys(metadata).map(function(key) {
        return key + '=' + metadata[key];
      }).join(' · ');
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function(char) {
        const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' };
        return map[char];
      });
    }
  </script>
</body>
</html>`;
}

function renderPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>念念在 Soul 作用域演示</title>
  <style>
    :root { color-scheme: light; --bg:#FDF8F0; --ink:#3D2C1E; --warm:#C8843C; --sage:#5C7D60; --card:#fffaf5; --line:#F0DBD2; --ok:#2F7D4E; --bad:#B94343; --seal:#8B6F4E; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", "PingFang SC", sans-serif; background: var(--bg); color: var(--ink); }
    main { max-width: 1120px; margin: 0 auto; padding: 40px 20px 56px; }
    h1 { font-family: Georgia, "Noto Serif SC", serif; font-size: clamp(28px, 5vw, 48px); margin: 0 0 12px; }
    p { line-height: 1.7; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin: 24px 0; }
    button { border:0; border-radius:999px; background:var(--warm); color:white; padding:12px 18px; font-weight:700; cursor:pointer; }
    button.secondary { background: var(--sage); }
    button.ghost { background: transparent; color: var(--warm); border:1px solid var(--line); }
    button.warn { background: #B94343; }
    .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:16px; }
    .checks { display:grid; gap:12px; margin: 22px 0; }
    .card { background: rgba(255,255,255,.7); border:1px solid var(--line); border-radius:18px; padding:20px; box-shadow:0 16px 36px rgba(61,44,30,.06); }
    .check { display:flex; gap:14px; align-items:flex-start; background: rgba(255,255,255,.72); border:1px solid var(--line); border-radius:16px; padding:14px 16px; }
    .badge { flex:0 0 auto; min-width:76px; text-align:center; border-radius:999px; padding:5px 10px; font-size:13px; font-weight:800; color:white; }
    .pass { background: var(--ok); }
    .fail { background: var(--bad); }
    .check h3 { margin:0 0 4px; font-size:16px; }
    .check p { margin:0; color:#7A4E2C; }
    .chat-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:16px; margin: 22px 0; }
    .phone { background:#F7F1E8; border:1px solid var(--line); border-radius:20px; overflow:hidden; box-shadow:0 18px 40px rgba(61,44,30,.08); }
    .phone-header { padding:14px 16px; background:#fff; border-bottom:1px solid var(--line); font-weight:800; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .phone-header span { color:var(--sage); font-size:13px; font-weight:700; }
    .state-tag { display:inline-block; border-radius:999px; padding:2px 10px; font-size:11px; font-weight:800; letter-spacing:.06em; }
    .state-active { background:#DCEFD8; color:#2F7D4E; }
    .state-sealed { background:#F5EDE0; color:var(--seal); }
    .state-node { background:#FFF3DB; color:#B8860B; }
    .state-graduated { background:#F0E8F4; color:#6B4E8A; }
    .messages { height:360px; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
    .loading { align-self:flex-start; color:var(--sage); font-size:13px; padding:8px 12px; animation:pulse 1.2s infinite; }
    .auth-bar { display:flex; justify-content:center; gap:12px; margin-bottom:24px; flex-wrap:wrap; align-items:center; }
    .auth-bar input { border:1px solid var(--line); border-radius:999px; padding:10px 16px; font:inherit; background:#fff; color:var(--ink); width:180px; }
    .auth-bar button { border:0; border-radius:999px; padding:10px 18px; font-weight:700; cursor:pointer; }
    .auth-bar .auth-btn { background:var(--warm); color:white; }
    .auth-bar .auth-outline { background:transparent; color:var(--warm); border:1px solid var(--line); }
    .auth-status { text-align:center; color:var(--sage); font-size:13px; margin-bottom:16px; }
    @keyframes pulse { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
    .bubble { max-width:86%; padding:10px 12px; border-radius:16px; line-height:1.55; font-size:14px; }
    .user { align-self:flex-end; background:#DCEFD8; border-bottom-right-radius:4px; }
    .assistant { align-self:flex-start; background:#fff; border-bottom-left-radius:4px; border:1px solid #F0DBD2; }
    .chat-controls { display:flex; gap:10px; margin:14px 0 22px; }
    .chat-controls input { flex:1; border:1px solid var(--line); border-radius:999px; padding:12px 16px; font:inherit; background:#fff; color:var(--ink); }
    .chat-controls input:disabled { background:#f4f4f4; color:#999; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .chat-controls button:disabled { opacity:.4; cursor:not-allowed; }
    .examples { display:flex; flex-wrap:wrap; gap:8px; margin-top:-10px; margin-bottom:18px; }
    .examples button { background:#fff; color:var(--warm); border:1px solid var(--line); padding:8px 12px; font-size:13px; }
    .summary { display:grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap:12px; margin: 18px 0; }
    .metric { background:#fff; border:1px solid var(--line); border-radius:14px; padding:12px; }
    .metric strong { display:block; font-size:18px; margin-top:4px; }
    .label { color: var(--sage); font-weight:700; font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
    pre { white-space: pre-wrap; overflow:auto; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; font-size:13px; line-height:1.5; }
    .notice { background:#F4F7F4; border:1px solid #CDDCD0; border-radius:16px; padding:14px 16px; }
    .covenant-actions { display:flex; flex-wrap:wrap; gap:10px; margin:18px 0; padding:16px; background:#FFF; border:1px solid var(--line); border-radius:16px; }
    .covenant-actions p.label { width:100%; margin:0 0 4px; }
    .proposal-panel { margin:18px 0; padding:16px; background:#fff; border:1px solid var(--line); border-radius:16px; }
    .proposal { display:grid; gap:8px; padding:12px; border:1px solid var(--line); border-radius:12px; background:#fffaf5; }
    .proposal + .proposal { margin-top:10px; }
    .proposal-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
    .proposal code { background:#F7F1E8; border-radius:8px; padding:2px 6px; }
    .proposal-hint { margin:8px 0 0; color:#7A4E2C; font-size:13px; }
    .proposal-change { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .proposal-change strong { font-size:18px; }
    .proposal-status { border-radius:999px; padding:3px 10px; font-size:12px; font-weight:800; }
    .proposal-status.PENDING { background:#FFF3DB; color:#9B7108; }
    .proposal-status.ACCEPTED { background:#DCEFD8; color:#2F7D4E; }
    .proposal-status.REJECTED { background:#F7E6E1; color:#B94343; }
    @media (max-width: 760px) { .grid, .summary, .chat-grid { grid-template-columns:1fr; } .check { flex-direction:column; } .chat-controls { flex-direction:column; } .summary { grid-template-columns: repeat(3, 1fr); } }
  </style>
</head>
<body>
  <main>
    <!-- Brand Header -->
    <header style="text-align:center; margin-bottom:36px;">
      <div style="font-family:Georgia,'Noto Serif SC',serif; font-size:56px; font-weight:400; color:#C8843C; letter-spacing:.02em; margin-bottom:8px;">念念在</div>
      <p style="font-family:Georgia,'Noto Serif SC',serif; font-size:20px; color:#5C7D60; margin:0;">让爱有处安放，让告别有期</p>
      <p style="color:#9B8A7A; font-size:14px; max-width:480px; margin:12px auto 0;">为你心里那个从未离开的人 — AI 哀伤辅助 · 有边界、有仪式、有告别</p>
    </header>

    <!-- Auth Bar -->
    <div class="auth-bar" id="authBar">
      <input id="authEmail" placeholder="邮箱" type="email" autocomplete="email">
      <input id="authPassword" placeholder="密码（6位以上）" type="password" autocomplete="current-password">
      <button class="auth-btn" onclick="doLogin()">登录</button>
      <button class="auth-outline" onclick="doRegister()">注册</button>
    </div>
    <div class="auth-status" id="authStatus"></div>
    <div id="demoContent" style="display:none">

    <!-- Chat Area -->
    <div class="notice" style="margin-bottom:16px;">当前为内部测试版本。点击「一键跑完整验证」后，6 条检查全部 PASS 即确认 A/B 用户 Soul 隔离正确。</div>
    <div class="actions">
      <button onclick="runAll()">一键跑完整验证</button>
      <button id="proposalBtn" onclick="postAction('/api/apply-correction')">生成用户 A 纠正提案</button>
      <button id="acceptProposalBtn" class="secondary" onclick="postAction('/api/accept-correction')">接受 A 提案</button>
      <button id="rejectProposalBtn" class="ghost" onclick="postAction('/api/reject-correction')">拒绝 A 提案</button>
      <button class="secondary" onclick="postAction('/api/create-node')">创建用户 A 婚礼节点</button>
      <button class="ghost" onclick="postAction('/api/reset')">重置演示</button>
    </div>
    <section class="proposal-panel">
      <p class="label">用户 A Soul 更新提案</p>
      <div id="proposalPanel">Loading...</div>
      <p id="proposalHint" class="proposal-hint"></p>
    </section>
    <div class="covenant-actions">
      <p class="label">用户 A 流转操作</p>
      <button onclick="postAction('/api/seal')">封存用户 A</button>
      <button class="secondary" onclick="postAction('/api/activate-node')">以节点重启</button>
      <button class="ghost" onclick="postAction('/api/complete-node')">完成节点</button>
      <button class="warn" onclick="postAction('/api/graduate')">用户 A 毕业</button>
    </div>
    <div class="chat-controls">
      <input id="chatInput" value="爸，我要结婚了。" aria-label="发送给两个用户的同一句话">
      <button id="sendBtn" onclick="sendChat()">发送</button>
    </div>
    <div class="examples">
      <button onclick="setExample('爸，我要结婚了。')">示例：我要结婚了</button>
      <button onclick="setExample('爸，我今天有点紧张。')">示例：我有点紧张</button>
      <button onclick="setExample('爸，你会怎么鼓励我？')">示例：你会怎么鼓励我</button>
    </div>
    <section class="chat-grid">
      <article class="phone">
        <div class="phone-header">用户 A 与「爸爸」<span id="aState">-</span><span id="aTone">-</span></div>
        <div class="messages" id="chatA"></div>
      </article>
      <article class="phone">
        <div class="phone-header">用户 B 与「爸爸」<span id="bState">-</span><span id="bTone">-</span></div>
        <div class="messages" id="chatB"></div>
      </article>
    </section>
    <section class="summary">
      <div class="metric"><span class="label">A 状态</span><strong id="aStateVal">-</strong></div>
      <div class="metric"><span class="label">B 状态</span><strong id="bStateVal">-</strong></div>
      <div class="metric"><span class="label">A Soul 版本</span><strong id="aSoul">-</strong></div>
      <div class="metric"><span class="label">B Soul 版本</span><strong id="bSoul">-</strong></div>
      <div class="metric"><span class="label">A 节点记忆</span><strong id="aMemory">-</strong></div>
    </section>
    <section class="checks" id="checks"></section>
    <details>
      <summary>查看原始状态 JSON</summary>
      <section class="grid">
      <article class="card">
        <p class="label">用户 A</p>
        <pre id="userA">Loading...</pre>
      </article>
      <article class="card">
        <p class="label">用户 B</p>
        <pre id="userB">Loading...</pre>
      </article>
      </section>
    </details>
    <footer style="text-align:center; color:#9B8A7A; font-size:12px; margin-top:48px; padding:24px 0; border-top:1px solid #F0DBD2;">
      念念在 · AI 哀伤辅助服务 · 内测版本 · 不替代真实人际关系 · 不存储真实用户数据
    </footer>
    </div>
  </main>
  <script>
    let currentState = null;
    async function loadState() {
      const data = await fetch('/api/state').then((res) => res.json());
      const verification = await fetch('/api/verification').then((res) => res.json());
      currentState = data;
      renderVerification(verification);
      renderProposals(data.userA.proposals, data.userA.proposalEvidence);
      renderChat('chatA', data.userA.conversations);
      renderChat('chatB', data.userB.conversations);
      document.getElementById('userA').textContent = JSON.stringify(data.userA, null, 2);
      document.getElementById('userB').textContent = JSON.stringify(data.userB, null, 2);
      updateChatControls();
      updateProposalControls();
    }
    function updateChatControls() {
      if (!currentState) return;
      const aState = currentState.userA.session.state;
      const bState = currentState.userB.session.state;
      const bothBlocked = (aState === 'SEALED' || aState === 'GRADUATED') && (bState === 'SEALED' || bState === 'GRADUATED');
      const input = document.getElementById('chatInput');
      const btn = document.getElementById('sendBtn');
      input.disabled = bothBlocked;
      btn.disabled = bothBlocked;
    }
    function updateProposalControls() {
      if (!currentState) return;
      const proposals = currentState.userA.proposals.filter((proposal) => proposal.fieldPath === 'affectModel.humorLevel');
      const pending = proposals.find((proposal) => proposal.status === 'PENDING');
      const latest = proposals[proposals.length - 1];
      const humor = readKernelValue(currentState.userA.latestSoul, 'affectModel', 'humorLevel');
      const proposalBtn = document.getElementById('proposalBtn');
      const acceptBtn = document.getElementById('acceptProposalBtn');
      const rejectBtn = document.getElementById('rejectProposalBtn');
      const hint = document.getElementById('proposalHint');

      proposalBtn.disabled = Boolean(pending) || humor === 'high';
      acceptBtn.disabled = !pending;
      rejectBtn.disabled = !pending;

      if (pending) {
        hint.textContent = '当前只有 PENDING 提案可以接受或拒绝；处理前不会写入 Soul。';
      } else if (humor === 'high') {
        hint.textContent = '最近的提案已接受，A 的 Soul 已写入 high；接受/拒绝不会反向改写终态。';
      } else if (latest && latest.status === 'REJECTED') {
        hint.textContent = '最近的提案已拒绝，A 的 Soul 保持原值；可以重新生成一条新的 PENDING 提案。';
      } else {
        hint.textContent = '生成提案只会创建待审记录；接受后才更新 A 的 Soul，拒绝后仍可重新生成。';
      }
    }
    async function postAction(path) {
      await fetch(path, { method: 'POST', headers: getAuthHeaders() });
      await loadState();
    }
    let sending = false;
    async function sendChat() {
      if (sending) return;
      const input = document.getElementById('chatInput');
      const btn = document.getElementById('sendBtn');
      const msg = input.value.trim();
      if (!msg) return;

      sending = true;
      input.disabled = true;
      btn.disabled = true;
      btn.textContent = '发送中...';
      document.getElementById('chatA').insertAdjacentHTML('beforeend', '<div class="loading">...思考中</div>');
      document.getElementById('chatB').insertAdjacentHTML('beforeend', '<div class="loading">...思考中</div>');
      document.getElementById('chatA').scrollTop = document.getElementById('chatA').scrollHeight;
      document.getElementById('chatB').scrollTop = document.getElementById('chatB').scrollHeight;

      try {
        await fetch('/api/chat', { headers: getAuthHeaders(),
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        await loadState();
      } finally {
        sending = false;
        input.disabled = false;
        btn.disabled = false;
        btn.textContent = '发送';
        input.focus();
      }
    }
    function setExample(text) {
      document.getElementById('chatInput').value = text;
    }
    async function runAll() {
      await fetch('/api/run-all', { method: 'POST' });
      await loadState();
    }
    function stateClass(state) {
      const map = { ACTIVE: 'state-active', SEALED: 'state-sealed', NODE: 'state-node', GRADUATED: 'state-graduated' };
      return map[state] || '';
    }
    function renderVerification(verification) {
      const s = verification.summary;
      document.getElementById('aStateVal').innerHTML = '<span class="state-tag ' + stateClass(s.userACovenantState) + '">' + s.userACovenantState + '</span>';
      document.getElementById('bStateVal').innerHTML = '<span class="state-tag ' + stateClass(s.userBCovenantState) + '">' + s.userBCovenantState + '</span>';
      document.getElementById('aSoul').textContent = 'v' + s.userASoulVersion + ' / ' + s.userAHumor;
      document.getElementById('bSoul').textContent = 'v' + s.userBSoulVersion + ' / ' + s.userBHumor;
      document.getElementById('aState').innerHTML = '<span class="state-tag ' + stateClass(s.userACovenantState) + '">' + s.userACovenantState + '</span>';
      document.getElementById('bState').innerHTML = '<span class="state-tag ' + stateClass(s.userBCovenantState) + '">' + s.userBCovenantState + '</span>';
      document.getElementById('aTone').textContent = 'Soul v' + s.userASoulVersion + ' · ' + s.userAHumor;
      document.getElementById('bTone').textContent = 'Soul v' + s.userBSoulVersion + ' · ' + s.userBHumor;
      document.getElementById('aMemory').textContent = String(s.userAMemoryCount);
      document.getElementById('checks').innerHTML = verification.checks.map((check) => {
        const badge = check.passed ? 'PASS' : 'WAIT';
        const cls = check.passed ? 'pass' : 'fail';
        return '<article class="check"><div class="badge ' + cls + '">' + badge + '</div><div><h3>' + check.title + '</h3><p>' + check.evidence + '</p></div></article>';
      }).join('');
    }
    function renderProposals(proposals, evidenceGroups) {
      const panel = document.getElementById('proposalPanel');
      if (!proposals.length) {
        panel.innerHTML = '<p>暂无提案。</p>';
        return;
      }
      panel.innerHTML = proposals.slice().reverse().map((proposal) => {
        const group = evidenceGroups.find((item) => item.proposalId === proposal.id);
        const evidence = (group && group.evidence || []).map((memory) => escapeHtml(memory.content)).join(' / ') || '无';
        return '<article class="proposal"><div class="proposal-row"><span class="proposal-status ' + proposal.status + '">' + proposal.status + '</span><code>' + escapeHtml(proposal.fieldPath) + '</code></div><div class="proposal-change"><span>变更</span><code>' + formatValue(proposal.oldValue) + '</code><strong>→</strong><code>' + formatValue(proposal.newValue) + '</code></div><div>证据：' + evidence + '</div></article>';
      }).join('');
    }
    function renderChat(id, messages) {
      const el = document.getElementById(id);
      el.innerHTML = messages.map((message) => {
        const cls = message.role === 'USER' ? 'user' : 'assistant';
        return '<div class="bubble ' + cls + '">' + escapeHtml(message.content) + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }
    function escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, function(char) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return map[char];
      });
    }
    function formatValue(value) {
      return escapeHtml(JSON.stringify(value));
    }
    function readKernelValue(soul, section, field) {
      if (!soul || !soul.kernelJson || !soul.kernelJson[section]) return undefined;
      return soul.kernelJson[section][field];
    }
    // ── Auth ──
    let authToken = localStorage.getItem('nnz_token') || '';
    let authUser = null;
    if (authToken) {
      try { authUser = JSON.parse(atob(authToken.split('.')[1])); } catch(e) {}
      if (authUser) {
        document.getElementById('authBar').style.display = 'none';
        document.getElementById('authStatus').innerHTML = '已登录：' + authUser.email + ' <a href="#" onclick="doLogout()" style="color:var(--warm)">退出</a>';
        document.getElementById('demoContent').style.display = 'block';
      }
    }

    async function doLogin() {
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const res = await fetch('/api/login', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({email, password})
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('nnz_token', data.token);
        location.reload();
      } else {
        document.getElementById('authStatus').textContent = data.error || '登录失败';
      }
    }
    async function doRegister() {
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const res = await fetch('/api/register', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({email, password})
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('nnz_token', data.token);
        location.reload();
      } else {
        document.getElementById('authStatus').textContent = data.error || '注册失败';
      }
    }
    function doLogout() {
      localStorage.removeItem('nnz_token');
      location.reload();
    }
    function getAuthHeaders() {
      return authToken ? { 'Authorization': 'Bearer ' + authToken } : {};
    }

    loadState();
  </script>
</body>
</html>`;
}

function shortId(id: string): string {
  return id.slice(0, 13);
}

function getLastItem<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

function readStringField(source: Record<string, unknown> | undefined, section: string, field: string): string | undefined {
  if (!source) return undefined;
  const value = source[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[field];
  return typeof nested === 'string' ? nested : undefined;
}



function readFirstString(source: Record<string, unknown>, section: string, field: string): string | undefined {
  const value = source[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[field];
  return Array.isArray(nested) && typeof nested[0] === 'string' ? nested[0] : undefined;
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}
