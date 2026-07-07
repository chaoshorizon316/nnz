import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf-8');

function functionBody(name: string, asyncFunction = true): string {
  const prefix = asyncFunction ? 'async function' : 'function';
  const start = html.indexOf(`${prefix} ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextAsyncFunction = html.indexOf('\nasync function ', start + 1);
  const nextFunction = html.indexOf('\nfunction ', start + 1);
  const boundaries = [nextAsyncFunction, nextFunction].filter((index) => index !== -1);
  const end = boundaries.length ? Math.min(...boundaries) : undefined;
  return html.slice(start, end);
}

describe('H5 experience lifecycle controls', () => {
  it('downloads the user data archive before submitting graduation', () => {
    const graduate = functionBody('h5Graduate');
    const exportCall = graduate.indexOf("await h5Request('/api/me/export')");
    const graduateCall = graduate.indexOf("await h5Request('/api/me/graduate'");

    expect(exportCall).toBeGreaterThanOrEqual(0);
    expect(graduateCall).toBeGreaterThanOrEqual(0);
    expect(exportCall).toBeLessThan(graduateCall);
    expect(graduate).toContain('h5DownloadDataArchive(data.export');
    expect(graduate).toContain('数据档案已交还给你');
  });

  it('does not fall back to displaying raw lifecycle state names', () => {
    expect(html).toContain("badge.textContent = labels[state] || '状态更新中';");
    expect(html).not.toContain('badge.textContent = labels[state] || state;');
  });

  it('shows a persistent support panel when a safety reply appears', () => {
    const renderConversation = functionBody('h5RenderConversation', false);
    const updateSafetySupport = functionBody('h5UpdateSafetySupport', false);

    expect(html).toContain('id="h5SafetySupport"');
    expect(html).toContain('tel:4001619995');
    expect(renderConversation).toContain('h5UpdateSafetySupport(messages);');
    expect(updateSafetySupport).toContain("message.role === 'ASSISTANT'");
    expect(updateSafetySupport).toContain('h5IsSafetySupportReply');
    expect(html).toContain('请现在就联系能真正帮助你的人');
  });
});
