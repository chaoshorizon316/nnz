import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from '../domain/persistence';
import { InMemorySoulStore } from '../domain/soul-store';
import { parseSnapshotJson, runMigrationPlanCommand } from './postgres-scoped-migration-plan-cli';

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

  it('rejects missing file arguments before reading', () => {
    const result = runMigrationPlanCommand([], () => {
      throw new Error('should not read');
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing snapshot JSON path.');
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
  return store.serialize();
}
