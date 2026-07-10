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
