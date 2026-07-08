import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src', 'demo-server.ts'), 'utf-8');

describe('demo server user onboarding consent', () => {
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
