import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src', 'demo-server.ts'), 'utf-8');

describe('demo server user onboarding consent', () => {
  it('protects the Soul Ops page and API with the optional IP allowlist before token checks', () => {
    expect(source).toContain("parseOpsIpAllowlist(readNonEmptyEnv('NNZ_OPS_ALLOWED_IPS'))");

    const pageRouteStart = source.indexOf("url.pathname === '/ops'");
    expect(pageRouteStart).toBeGreaterThanOrEqual(0);
    const pageRouteEnd = source.indexOf("if (url.pathname.startsWith('/api/ops/'))", pageRouteStart);
    const pageRoute = source.slice(pageRouteStart, pageRouteEnd);
    expect(pageRoute).toContain('requireOpsIpAllowed(req, res)');

    const accessStart = source.indexOf('async function requireOpsAccess');
    expect(accessStart).toBeGreaterThanOrEqual(0);
    const accessEnd = source.indexOf('async function requireOpsIpAllowed', accessStart);
    const accessFunction = source.slice(accessStart, accessEnd);
    expect(accessFunction).toContain('requireOpsIpAllowed(req, res)');
    expect(accessFunction.indexOf('requireOpsIpAllowed(req, res)')).toBeLessThan(
      accessFunction.indexOf('OPS_TOKEN_ENTRIES.length === 0'),
    );

    const allowlistStart = source.indexOf('async function requireOpsIpAllowed');
    expect(allowlistStart).toBeGreaterThanOrEqual(0);
    const allowlistEnd = source.indexOf('async function recordOpsAudit', allowlistStart);
    const allowlistFunction = source.slice(allowlistStart, allowlistEnd);
    expect(allowlistFunction).toContain('resolveOpsClientIp(req.headers, req.socket.remoteAddress)');
    expect(allowlistFunction).toContain("reason: 'ip-not-allowed'");
    expect(allowlistFunction).toContain("error: 'Soul Ops 当前访问来源未被允许。'");
  });

  it('applies the configured Ops audit retention policy after audit writes', () => {
    expect(source).toContain('parseOpsAuditRetentionPolicy(process.env)');

    const recordStart = source.indexOf('async function recordOpsAudit');
    expect(recordStart).toBeGreaterThanOrEqual(0);
    const recordEnd = source.indexOf('function getScopedOpsStore', recordStart);
    const recordFunction = source.slice(recordStart, recordEnd);

    expect(recordFunction).toContain('await scopedOps.recordOpsAuditEvent(event)');
    expect(recordFunction).toContain('await scopedOps.pruneOpsAuditEvents(OPS_AUDIT_RETENTION_POLICY)');
    expect(recordFunction).toContain('fixture.store.recordOpsAuditEvent(event)');
    expect(recordFunction).toContain('fixture.store.pruneOpsAuditEvents(OPS_AUDIT_RETENTION_POLICY)');
    expect(recordFunction.indexOf('recordOpsAuditEvent(event)')).toBeLessThan(
      recordFunction.indexOf('pruneOpsAuditEvents(OPS_AUDIT_RETENTION_POLICY)'),
    );
  });

  it('supports optional short-lived Soul Ops sessions before privileged Ops APIs', () => {
    expect(source).toContain("parseOpsSessionTtlMinutes(readNonEmptyEnv('NNZ_OPS_SESSION_TTL_MINUTES'))");

    const sessionRoute = source.indexOf("url.pathname === '/api/ops/session'");
    const opsApiRoute = source.indexOf("url.pathname.startsWith('/api/ops/')");
    expect(sessionRoute).toBeGreaterThanOrEqual(0);
    expect(sessionRoute).toBeLessThan(opsApiRoute);

    const createSessionStart = source.indexOf('async function createOpsSession');
    expect(createSessionStart).toBeGreaterThanOrEqual(0);
    const createSessionEnd = source.indexOf('async function requireOpsIpAllowed', createSessionStart);
    const createSessionFunction = source.slice(createSessionStart, createSessionEnd);
    expect(createSessionFunction).toContain("recordOpsAudit(principal, 'SESSION_CREATE', 'SUCCESS'");
    expect(createSessionFunction).toContain('randomBytes(32).toString');
    expect(createSessionFunction).toContain('sessionToken: session.token');

    const requireAccessStart = source.indexOf('async function requireOpsAccess');
    const requireAccessEnd = source.indexOf('async function createOpsSession', requireAccessStart);
    const requireAccessFunction = source.slice(requireAccessStart, requireAccessEnd);
    expect(requireAccessFunction).toContain('isOpsSessionEnabled()');
    expect(requireAccessFunction).toContain('resolveOpsSession(token)');
    expect(requireAccessFunction.indexOf('resolveOpsSession(token)')).toBeLessThan(
      requireAccessFunction.indexOf('resolveOpsPrincipal(token, OPS_TOKEN_ENTRIES'),
    );

    expect(source).toContain("const OPS_SESSION_ENABLED = ");
    expect(source).toContain("sessionStorage.setItem('nnz_ops_session_token', data.sessionToken)");
    expect(source).toContain("sessionStorage.removeItem('nnz_ops_session_token')");
  });

  it('requires consent before creating a user persona through /api/me/persona', () => {
    const routeStart = source.indexOf("url.pathname === '/api/me/persona'");
    expect(routeStart).toBeGreaterThanOrEqual(0);
    const nextRoute = source.indexOf("url.pathname === '/api/me/chat-history'", routeStart);
    const route = source.slice(routeStart, nextRoute);

    expect(route).toContain('consentAccepted?: boolean');
    expect(route).toContain('body.consentAccepted !== true');
    expect(route).toContain('请先确认使用边界和数据权利。');
  });

  it('stores user-supplied memory through the scoped persona runtime', () => {
    const routeStart = source.indexOf("url.pathname === '/api/me/memory'");
    expect(routeStart).toBeGreaterThanOrEqual(0);
    const nextRoute = source.indexOf("url.pathname === '/api/me/chat-history'", routeStart);
    const route = source.slice(routeStart, nextRoute);

    expect(route).toContain('personaId?: string; content?: string');
    expect(route).toContain('请先选择要补充记忆的人。');
    expect(route).toContain('请输入一段想补充的记忆。');
    expect(route).toContain('requireUserPersonaRuntime(res, authUser.userId, body.personaId)');
    expect(route).toContain('addUserPersonaMemory(runtime, content)');
    expect(source).toContain("type: 'DESCRIPTION'");
    expect(source).toContain('enabledForSoul: true');
  });

  it('imports uploaded chat records through the selected scoped persona runtime', () => {
    const routeStart = source.indexOf("url.pathname === '/api/me/chat-upload'");
    expect(routeStart).toBeGreaterThanOrEqual(0);
    const nextRoute = source.indexOf("url.pathname === '/api/me/wechat-bot-link'", routeStart);
    const route = source.slice(routeStart, nextRoute);

    expect(source).toContain("from './chat-record-import'");
    expect(route).toContain('personaId?: string');
    expect(route).toContain('fileName?: string');
    expect(route).toContain('format?: string');
    expect(route).toContain('requireUserPersonaRuntime(res, authUser.userId, body.personaId)');
    expect(route).toContain('importUserChatRecord(runtime, body)');

    const importStart = source.indexOf('async function importUserChatRecord');
    expect(importStart).toBeGreaterThanOrEqual(0);
    const importEnd = source.indexOf('async function sendMessageToUserPersona', importStart);
    const importFunction = source.slice(importStart, importEnd);
    expect(importFunction).toContain('parseChatRecordUpload(input)');
    expect(importFunction).toContain("type: 'CHAT_EXCERPT'");
    expect(importFunction).toContain("source: 'UPLOAD'");
    expect(importFunction).toContain("sensitivity: 'MEDIUM'");
    expect(importFunction).toContain('CHAT_RECORD_ACCEPTED_EXTENSIONS');
    expect(importFunction).toContain('CHAT_RECORD_FORMAT_HINT');
  });

  it('bridges WeChat bot messages through a token-protected binding flow', () => {
    expect(source).toContain("readNonEmptyEnv('NNZ_WECHAT_BOT_TOKEN')");
    expect(source).toContain("url.pathname.startsWith('/api/wechat-bot/')");

    const linkRouteStart = source.indexOf("url.pathname === '/api/me/wechat-bot-link'");
    expect(linkRouteStart).toBeGreaterThanOrEqual(0);
    const linkRouteEnd = source.indexOf("url.pathname === '/api/me/chat-history'", linkRouteStart);
    const h5LinkRoute = source.slice(linkRouteStart, linkRouteEnd);
    expect(h5LinkRoute).toContain('createWechatBotLinkCode(authUser.userId, body.personaId)');
    expect(h5LinkRoute).toContain('向微信机器人发送：绑定');

    const bridgeStart = source.indexOf('async function handleWechatBotRequest');
    expect(bridgeStart).toBeGreaterThanOrEqual(0);
    const bridgeEnd = source.indexOf('function requireWechatBotAccess', bridgeStart);
    const bridgeFunction = source.slice(bridgeStart, bridgeEnd);
    expect(bridgeFunction).toContain("url.pathname === '/api/wechat-bot/link'");
    expect(bridgeFunction).toContain("url.pathname === '/api/wechat-bot/message'");
    expect(bridgeFunction).toContain('WECHAT_BOT_BINDINGS.set(externalUserId');
    expect(bridgeFunction).toContain('sendMessageToUserPersona(runtime, message)');

    const accessStart = source.indexOf('function requireWechatBotAccess');
    expect(accessStart).toBeGreaterThanOrEqual(0);
    const accessEnd = source.indexOf('async function requireOpsAccess', accessStart);
    const accessFunction = source.slice(accessStart, accessEnd);
    expect(accessFunction).toContain('WECHAT_BOT_TOKEN');
    expect(accessFunction).toContain('getWechatBotRequestToken(req)');
    expect(accessFunction).toContain('safeSecretEquals(token, WECHAT_BOT_TOKEN)');
  });

  it('persists scoped runtime daily usage after a chat passes the usage guard', () => {
    const functionStart = source.indexOf('async function applyUserRuntimeSafetyGuard');
    expect(functionStart).toBeGreaterThanOrEqual(0);
    const functionEnd = source.indexOf('async function getLastUserRuntimeAssistantReply', functionStart);
    const guardFunction = source.slice(functionStart, functionEnd);

    expect(guardFunction).toContain('const limitCheck = checkDailyLimit(session)');
    expect(guardFunction.indexOf('checkDailyLimit(session)')).toBeLessThan(
      guardFunction.indexOf('incrementDailyCount(session)'),
    );
    expect(guardFunction).toContain('await runtime.updateRuntimeUsage({');
    expect(guardFunction).toContain('dailyMessageCount: session.dailyMessageCount');
    expect(guardFunction).toContain('lastMessageDate: session.lastMessageDate');
  });
});
