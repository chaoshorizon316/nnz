import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from '../domain/persistence';
import { InMemorySoulStore } from '../domain/soul-store';
import { createSanitizedReport, parseSnapshotJson, runMigrationPlanCommand } from './postgres-scoped-migration-plan-cli';

describe('Postgres scoped migration plan CLI', () => {
  it('prints a ready dry-run summary for a StoreSnapshot JSON file', () => {
    const snapshot = createSnapshot();

    const result = runMigrationPlanCommand(
      ['/tmp/snapshot.json'],
      () => JSON.stringify(snapshot),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('ready: yes');
    expect(result.stdout).toContain('nnz_users: 1');
    expect(result.stdout).toContain('Errors:\n- none');
  });

  it('accepts a snapshot_json wrapper from exported Postgres rows', () => {
    const snapshot = createSnapshot();

    const parsed = parseSnapshotJson(JSON.stringify({ snapshot_json: snapshot }));

    expect(parsed.users).toHaveLength(1);
    expect(parsed.opsAuditEvents).toEqual([]);
  });

  it('returns exit code 2 when the plan has blocking errors', () => {
    const snapshot = createSnapshot();
    snapshot.personas[0]!.userId = 'missing-user';

    const result = runMigrationPlanCommand(
      ['--json', '/tmp/bad-snapshot.json'],
      () => JSON.stringify(snapshot),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ready: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'USER_MISSING' }),
      ]),
    });
  });

  it('writes a sanitized report without memory or chat content', () => {
    const snapshot = createSnapshot();
    const written: Record<string, string> = {};

    const result = runMigrationPlanCommand(
      ['--report', '/tmp/report.json', '/tmp/snapshot.json'],
      () => JSON.stringify(snapshot),
      (path, text) => {
        written[path] = text;
      },
    );

    expect(result.exitCode).toBe(0);
    expect(written['/tmp/report.json']).toBeDefined();
    expect(written['/tmp/report.json']).toContain('"ready": true');
    expect(written['/tmp/report.json']).toContain('"rowBuild"');
    expect(written['/tmp/report.json']).toContain('"executor"');
    expect(written['/tmp/report.json']).toContain('"executed": false');
    expect(written['/tmp/report.json']).toContain('"count"');
    expect(written['/tmp/report.json']).not.toContain('"rows"');
    expect(written['/tmp/report.json']).not.toContain('private memory text');
    expect(written['/tmp/report.json']).not.toContain('private chat text');
  });

  it('keeps sanitized reports limited to counts and issue identifiers', () => {
    const snapshot = createSnapshot();
    snapshot.personas[0]!.userId = 'missing-user';
    const result = runMigrationPlanCommand(
      ['--json', '/tmp/bad-snapshot.json'],
      () => JSON.stringify(snapshot),
    );

    const report = createSanitizedReport(JSON.parse(result.stdout), '/tmp/bad-snapshot.json');

    expect(JSON.stringify(report)).toContain('USER_MISSING');
    expect(JSON.stringify(report)).not.toContain('private memory text');
    expect(JSON.stringify(report)).not.toContain('private chat text');
  });

  it('rejects missing file arguments before reading', () => {
    const result = runMigrationPlanCommand([], () => {
      throw new Error('should not read');
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing snapshot JSON path.');
  });

  it('rejects a missing report path before reading', () => {
    const result = runMigrationPlanCommand(['--report'], () => {
      throw new Error('should not read');
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing report JSON path after --report.');
  });
});

function createSnapshot(): StoreSnapshot {
  const store = new InMemorySoulStore();
  const user = store.createUser('user@example.test');
  const persona = store.createPersona({
    userId: user.id,
    displayName: 'Father',
    relationship: 'daughter',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: user.id,
    personaId: persona.id,
    kernelJson: { identityCore: { relationship: 'father' } },
  });
  store.addMemory({
    userId: user.id,
    personaId: persona.id,
    type: 'DESCRIPTION',
    content: 'private memory text',
    confidence: 1,
    enabledForSoul: true,
  });
  store.addConversation({
    userId: user.id,
    personaId: persona.id,
    role: 'USER',
    content: 'private chat text',
  });
  return store.serialize();
}
