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
});
