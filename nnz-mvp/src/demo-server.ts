import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadEnv } from './env';
loadEnv(process.cwd());

import type { LlmAdapter } from './llm/types';
import { createExtractionOrchestrator } from './extraction/orchestrator';
import { loadStore, saveStore } from './domain/persistence';
import { CovenantStateError, NotFoundError, OwnershipError } from './domain/errors';
import { InMemorySoulStore } from './domain/soul-store';
import type {
  MemoryItem,
  NodeEvent,
  Persona,
  RuntimeSession,
  SoulUpdateProposal,
  SoulVersion,
  User,
  UserPersonaScope,
} from './domain/types';
import { generateLlmReply } from './runtime/llm-reply';
import { GRADUATED_REPLY, SEALED_REPLY, generateSoulReply } from './runtime/soul-runtime';
import { extractToken, hashPassword, signToken, verifyPassword, verifyToken } from './auth/auth';
import { checkDailyLimit, checkMessageSafety, incrementDailyCount } from './runtime/soul-guard';

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

const DB_PATH = process.env['NNZ_DB_PATH'];
if (DB_PATH) {
  const loaded = loadStore(fixture.store, DB_PATH);
  if (loaded) {
    console.log(`Store loaded from ${DB_PATH}`);
    // Refresh fixture references after loading
    const scopeA = { userId: fixture.userA.id, personaId: fixture.personaA.id };
    const scopeB = { userId: fixture.userB.id, personaId: fixture.personaB.id };
    fixture.soulA = fixture.store.getLatestSoulVersion(scopeA);
    fixture.soulB = fixture.store.getLatestSoulVersion(scopeB);
  } else {
    console.log(`No existing data at ${DB_PATH}, starting fresh.`);
    saveStore(fixture.store, DB_PATH);
  }
}

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

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'GET' && url.pathname === '/api/verification') {
      return sendJson(res, buildVerification());
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      return sendJson(res, buildMeResponse(authUser));
    }

    if (req.method === 'GET' && url.pathname === '/api/me/personas') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      return sendJson(res, { personas: listUserPersonaSummaries(authUser.userId) });
    }

    if (req.method === 'POST' && url.pathname === '/api/me/persona') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await readJsonBody<{
        displayName?: string;
        relationship?: string;
        description?: string;
        petPhrase?: string;
      }>(req);
      if (!normalizeVisibleText(body.displayName, 24) || !normalizeVisibleText(body.relationship, 24)) {
        return sendJson(res, { error: '请填写称呼和关系。' }, 400);
      }
      return sendJson(res, createUserPersona(authUser.userId, body));
    }

    if (req.method === 'GET' && url.pathname === '/api/me/chat-history') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const personaId = url.searchParams.get('personaId') ?? '';
      if (!personaId) {
        return sendJson(res, { error: '请先选择要对话的人。' }, 400);
      }
      const scope = { userId: authUser.userId, personaId };
      if (!ensureUserPersonaAccess(res, scope.userId, scope.personaId)) return;
      return sendJson(res, {
        persona: summarizeUserPersona(scope),
        messages: serializeUserMessages(scope),
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
      if (!ensureUserPersonaAccess(res, authUser.userId, body.personaId)) return;
      const reply = await sendMessageToUserPersona(authUser.userId, body.personaId, message);
      return sendJson(res, reply);
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, {
        ok: true,
        service: 'nnz-mvp-demo',
        fixture: 'in-memory',
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
      return sendJson(res, buildVerification());
    }

    if (req.method === 'POST' && url.pathname === '/api/apply-correction') {
      applyUserACorrection();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/accept-correction') {
      acceptUserACorrectionProposal();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/reject-correction') {
      rejectUserACorrectionProposal();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/create-node') {
      createUserANodeMemory();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/seal') {
      sealUserA();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/activate-node') {
      activateNodeForUserA();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/complete-node') {
      completeNodeForUserA();
      persistIfEnabled();
      return sendJson(res, serializeFixture());
    }

    if (req.method === 'POST' && url.pathname === '/api/graduate') {
      graduateUserA();
      persistIfEnabled();
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

const port = Number(process.env.PORT ?? 3007);
const host = process.env.HOST ?? '0.0.0.0';
server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`念念在 Soul 作用域演示已启动: http://${displayHost}:${port}`);
});


async function handleRegister(res: ServerResponse, email: string, password: string): Promise<void> {
  if (!email || !password || password.length < 6) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '邮箱和密码不能为空，密码至少 6 位。' }));
    return;
  }

  const existing = fixture.store.getCredentialByEmail(email);
  if (existing) {
    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '该邮箱已注册。' }));
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = fixture.store.createUser(email); // displayName = email for now
  fixture.store.storeCredential(user.id, email, passwordHash);
  persistIfEnabled();

  const token = signToken({ userId: user.id, email });
  res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ token, userId: user.id, email }));
}

async function handleLogin(res: ServerResponse, email: string, password: string): Promise<void> {
  const cred = fixture.store.getCredentialByEmail(email);
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

function ensureUserPersonaAccess(res: ServerResponse, userId: string, personaId: string): boolean {
  try {
    fixture.store.getPersonaForUser(userId, personaId);
    return true;
  } catch (error) {
    if (error instanceof OwnershipError) {
      sendJson(res, { error: '没有权限访问这段对话。' }, 403);
      return false;
    }
    if (error instanceof NotFoundError) {
      sendJson(res, { error: '没有找到这段对话。' }, 404);
      return false;
    }
    throw error;
  }
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

interface UserPersonaSummary {
  id: string;
  displayName: string;
  relationship: string;
  createdAt: Date;
  memoryCount: number;
  messageCount: number;
}

function buildMeResponse(authUser: { userId: string; email: string }) {
  return {
    email: authUser.email,
    personas: listUserPersonaSummaries(authUser.userId),
  };
}

function listUserPersonaSummaries(userId: string): UserPersonaSummary[] {
  return fixture.store.listPersonasForUser(userId).map((persona) => {
    const scope = { userId, personaId: persona.id };
    return {
      id: persona.id,
      displayName: persona.displayName,
      relationship: persona.relationship,
      createdAt: persona.createdAt,
      memoryCount: fixture.store.listMemory(scope).length,
      messageCount: fixture.store.listConversations(scope).length,
    };
  });
}

function createUserPersona(
  userId: string,
  input: { displayName?: string; relationship?: string; description?: string; petPhrase?: string },
) {
  const displayName = normalizeVisibleText(input.displayName, 24);
  const relationship = normalizeVisibleText(input.relationship, 24);
  const description = normalizeVisibleText(input.description, 600);
  const petPhrase = normalizeVisibleText(input.petPhrase, 40);

  if (!displayName || !relationship) {
    throw new Error('请填写称呼和关系。');
  }

  const persona = fixture.store.createPersona({
    userId,
    displayName,
    relationship,
    type: 'DECEASED',
  });
  const scope = { userId, personaId: persona.id };
  fixture.store.createSoulVersion({
    ...scope,
    kernelJson: {
      identityCore: {
        displayName,
        relationship,
      },
      affectModel: {
        humorLevel: 'medium',
      },
      languageModel: {
        petPhrases: petPhrase ? [petPhrase] : [],
      },
    },
  });

  if (description) {
    fixture.store.addMemory({
      ...scope,
      type: 'DESCRIPTION',
      content: description,
      confidence: 0.85,
      enabledForSoul: true,
    });
  }

  persistIfEnabled();

  return {
    persona: summarizeUserPersona(scope),
    messages: serializeUserMessages(scope),
  };
}

async function sendMessageToUserPersona(userId: string, personaId: string, message: string) {
  const persona = fixture.store.getPersonaForUser(userId, personaId);
  const scope = { userId, personaId: persona.id };
  const text = message.trim();
  if (!text) {
    throw new Error('请输入想说的话。');
  }

  const guard = applySafetyGuard(scope, text);
  const duplicate = isDuplicateMessage(scope, text);
  fixture.store.addConversation({ ...scope, role: 'USER', content: text });

  let reply: string;
  if (duplicate) {
    reply = getLastAssistantReply(scope) ?? '嗯，我听见了。';
  } else if (guard.blocked && guard.reply) {
    reply = guard.reply;
  } else {
    try {
      const ctx = fixture.store.getRuntimeContext(scope);
      if (llmAdapter) {
        reply = await generateLlmReply(llmAdapter, {
          soul: ctx.soul,
          memories: ctx.memories,
          recentConversations: fixture.store.listConversations(scope),
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

  fixture.store.addConversation({ ...scope, role: 'ASSISTANT', content: reply });

  if (llmAdapter) {
    const adapter = llmAdapter;
    setImmediate(async () => {
      try {
        await extractionOrchestrator.maybeExtractAndPropose(scope, fixture.store, adapter);
      } catch (err) {
        console.error('Extraction error (user persona):', err instanceof Error ? err.message : String(err));
      }
    });
  }

  persistIfEnabled();

  return {
    persona: summarizeUserPersona(scope),
    messages: serializeUserMessages(scope),
    reply,
  };
}

function summarizeUserPersona(scope: UserPersonaScope): UserPersonaSummary {
  const persona = fixture.store.getPersonaForUser(scope.userId, scope.personaId);
  return {
    id: persona.id,
    displayName: persona.displayName,
    relationship: persona.relationship,
    createdAt: persona.createdAt,
    memoryCount: fixture.store.listMemory(scope).length,
    messageCount: fixture.store.listConversations(scope).length,
  };
}

function serializeUserMessages(scope: UserPersonaScope) {
  return fixture.store.listConversations(scope).map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));
}

function normalizeVisibleText(value: string | undefined, maxLength: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}


function persistIfEnabled(): void {
  if (DB_PATH) {
    try {
      saveStore(fixture.store, DB_PATH);
    } catch (err) {
      console.error('Failed to persist store:', err instanceof Error ? err.message : String(err));
    }
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
      } catch (err) {
        console.error('Extraction error (user A):', err instanceof Error ? err.message : String(err));
      }
      try {
        const proposalsB = await extractionOrchestrator.maybeExtractAndPropose(scopeB, fixture.store, adapter);
        if (proposalsB.length) {
          console.log(`Extraction generated ${proposalsB.length} proposal(s) for user B.`);
        }
      } catch (err) {
        console.error('Extraction error (user B):', err instanceof Error ? err.message : String(err));
      }
    });
  }

  persistIfEnabled();
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
    .ops-shell { margin:28px 0; padding:18px; background:#283126; color:#F8F2E8; border-radius:18px; }
    .ops-shell .label { color:#BFD5B9; }
    .ops-shell h2 { margin:4px 0 8px; font-size:24px; }
    .ops-note { color:#D8C8B5; margin:0 0 16px; }
    .ops-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:14px; }
    .ops-card { background:#FDF8F0; color:var(--ink); border-radius:14px; padding:16px; border:1px solid rgba(255,255,255,.18); }
    .ops-card h3 { margin:0 0 10px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
    .score-row { display:flex; align-items:flex-end; gap:10px; margin-bottom:12px; }
    .score { font-size:42px; line-height:1; font-weight:900; color:var(--warm); }
    .level { border-radius:999px; padding:4px 10px; background:#DCEFD8; color:#2F7D4E; font-weight:800; font-size:12px; }
    .bars { display:grid; gap:7px; }
    .bar-row { display:grid; grid-template-columns: 130px 1fr 38px; gap:8px; align-items:center; font-size:12px; }
    .bar-track { height:8px; border-radius:999px; background:#E9DDCE; overflow:hidden; }
    .bar-fill { height:100%; background:var(--sage); border-radius:999px; }
    .ops-metrics { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:8px; margin:12px 0; }
    .ops-mini { background:#fff; border:1px solid var(--line); border-radius:10px; padding:8px; }
    .ops-mini span { display:block; color:#7A4E2C; font-size:11px; }
    .ops-mini strong { font-size:18px; }
    .recommendations { display:grid; gap:6px; margin-top:10px; }
    .recommendation { border:1px solid var(--line); border-radius:10px; padding:8px; background:#fff; font-size:13px; }
    .recommendation strong { margin-right:6px; color:var(--warm); }
    @media (max-width: 760px) { .grid, .summary, .chat-grid, .ops-grid { grid-template-columns:1fr; } .check { flex-direction:column; } .chat-controls { flex-direction:column; } .summary { grid-template-columns: repeat(3, 1fr); } .ops-metrics { grid-template-columns: repeat(2, 1fr); } .bar-row { grid-template-columns: 1fr; } }
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
    <section class="ops-shell">
      <p class="label">Soul Ops Console</p>
      <h2>后台治理视图</h2>
      <p class="ops-note">这是运营和产品侧看到的视图：用户端不展示这些机制，但后台需要观察每个用户自己的 Soul 成熟度、证据质量、提案队列和状态边界。</p>
      <div class="ops-grid" id="opsGrid"></div>
    </section>
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
      renderOps(data);
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
    function renderOps(data) {
      const grid = document.getElementById('opsGrid');
      grid.innerHTML = [
        renderOpsCard('用户 A', data.userA),
        renderOpsCard('用户 B', data.userB),
      ].join('');
    }
    function renderOpsCard(label, userState) {
      const report = userState.ops.maturity;
      const dimensions = [
        ['证据覆盖', report.evidenceCoverage],
        ['身份清晰', report.identityClarity],
        ['语气稳定', report.voiceConsistency],
        ['记忆可靠', report.memoryReliability],
        ['运行稳定', report.runtimeStability],
        ['安全就绪', report.safetyReadiness],
      ];
      const bars = dimensions.map(([name, value]) => {
        return '<div class="bar-row"><span>' + name + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Number(value) + '%"></div></div><strong>' + Number(value) + '</strong></div>';
      }).join('');
      const recommendations = report.recommendations.length
        ? report.recommendations.map((item) => '<div class="recommendation"><strong>' + item.priority + '</strong>' + escapeHtml(item.reason) + '</div>').join('')
        : '<div class="recommendation"><strong>OK</strong>暂无开放建议。</div>';
      return '<article class="ops-card"><h3>' + label + ' · ' + escapeHtml(userState.persona.displayName) + '<span class="state-tag ' + stateClass(report.runtimeState) + '">' + report.runtimeState + '</span></h3><div class="score-row"><div class="score">' + report.score + '</div><div><span class="level">' + report.level + '</span><p class="proposal-hint">Scope: ' + escapeHtml(shortClientId(report.userId)) + ' + ' + escapeHtml(shortClientId(report.personaId)) + '</p></div></div><div class="bars">' + bars + '</div><div class="ops-metrics"><div class="ops-mini"><span>Memory</span><strong>' + report.memoryCount + '</strong></div><div class="ops-mini"><span>Proposal</span><strong>' + report.proposalCount + '</strong></div><div class="ops-mini"><span>Snapshot</span><strong>' + report.snapshotCount + '</strong></div><div class="ops-mini"><span>Node</span><strong>' + report.nodeCount + '</strong></div></div><div class="recommendations">' + recommendations + '</div></article>';
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
    function shortClientId(id) {
      return String(id).slice(0, 13);
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
