import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from '../domain/persistence';
import { InMemorySoulStore } from '../domain/soul-store';
import { runMigrationReadinessCommand, type MigrationReadinessCliDeps } from './postgres-scoped-migration-readiness-cli';

describe('Postgres scoped migration readiness CLI', () => {
  it('creates raw snapshot plus sanitized report and summary from JSON input', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify({ snapshot_json: snapshot })],
    ]);

    const result = runMigrationReadinessCommand(
      [
        '--from-json',
        '/tmp/input.json',
        '--snapshot-out',
        '/tmp/raw-snapshot.json',
        '--report-out',
        '/tmp/report.json',
        '--summary-out',
        '/tmp/summary.json',
      ],
      deps(files),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Postgres scoped migration readiness');
    expect(result.stdout).toContain('ready: yes');
    expect(result.stdout).not.toContain('private memory text');
    expect(result.stdout).not.toContain('private chat text');

    expect(files.get('/tmp/raw-snapshot.json')).toContain('private memory text');
    expect(files.get('/tmp/raw-snapshot.json')).toContain('private chat text');

    const report = files.get('/tmp/report.json') ?? '';
    expect(report).toContain('"kind": "postgres-scoped-migration-dry-run"');
    expect(report).toContain('"rowBuild"');
    expect(report).not.toContain('"rows"');
    expect(report).not.toContain('private memory text');
    expect(report).not.toContain('private chat text');

    const summary = files.get('/tmp/summary.json') ?? '';
    expect(summary).toContain('"kind": "postgres-scoped-migration-readiness-summary"');
    expect(summary).toContain('migration:execute');
    expect(summary).not.toContain('private memory text');
    expect(summary).not.toContain('private chat text');
  });

  it('creates readiness outputs from an explicit SQLite input', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/store.db', 'sqlite-placeholder'],
    ]);

    const result = runMigrationReadinessCommand(
      [
        '--from-sqlite',
        '/tmp/store.db',
        '--snapshot-out',
        '/tmp/raw-snapshot.json',
        '--report-out',
        '/tmp/report.json',
        '--summary-out',
        '/tmp/summary.json',
      ],
      deps(files, { sqliteSnapshot: snapshot }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('source: sqlite');
    expect(files.get('/tmp/raw-snapshot.json')).toContain(snapshot.users[0]!.id);
    expect(files.get('/tmp/report.json')).not.toContain('private memory text');
  });

  it('returns exit code 2 while still writing sanitized outputs for blocking errors', () => {
    const snapshot = createSnapshot();
    snapshot.personas[0]!.userId = 'missing-user';
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify(snapshot)],
    ]);

    const result = runMigrationReadinessCommand(
      [
        '--from-json',
        '/tmp/input.json',
        '--snapshot-out',
        '/tmp/raw-snapshot.json',
        '--report-out',
        '/tmp/report.json',
        '--summary-out',
        '/tmp/summary.json',
      ],
      deps(files),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('ready: no');
    expect(result.stdout).toMatch(/errorCount: [1-9]/);
    expect(files.get('/tmp/report.json')).toContain('USER_MISSING');
    expect(files.get('/tmp/report.json')).not.toContain('missing-user');
    expect(files.get('/tmp/summary.json')).toContain('fix-blocking-errors');
    expect(files.get('/tmp/summary.json')).not.toContain('missing-user');
  });

  it('refuses to overwrite existing outputs unless forced', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify(snapshot)],
      ['/tmp/report.json', '{}'],
    ]);
    const args = [
      '--from-json',
      '/tmp/input.json',
      '--snapshot-out',
      '/tmp/raw-snapshot.json',
      '--report-out',
      '/tmp/report.json',
      '--summary-out',
      '/tmp/summary.json',
    ];

    const result = runMigrationReadinessCommand(args, deps(files));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('already exists');

    const forced = runMigrationReadinessCommand([...args, '--force'], deps(files));
    expect(forced.exitCode).toBe(0);
  });

  it('rejects duplicate output paths and input overwrite attempts', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify(snapshot)],
    ]);

    const duplicate = runMigrationReadinessCommand(
      [
        '--from-json',
        '/tmp/input.json',
        '--snapshot-out',
        '/tmp/output.json',
        '--report-out',
        '/tmp/output.json',
        '--summary-out',
        '/tmp/summary.json',
      ],
      deps(files),
    );
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.stderr).toContain('distinct');

    const overwriteInput = runMigrationReadinessCommand(
      [
        '--from-json',
        '/tmp/input.json',
        '--snapshot-out',
        '/tmp/input.json',
        '--report-out',
        '/tmp/report.json',
        '--summary-out',
        '/tmp/summary.json',
      ],
      deps(files),
    );
    expect(overwriteInput.exitCode).toBe(1);
    expect(overwriteInput.stderr).toContain('must not overwrite');
  });

  it('does not read files when required args are missing', () => {
    const result = runMigrationReadinessCommand([], deps(new Map()));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing input source');
  });
});

function deps(
  files: Map<string, string>,
  options: { sqliteSnapshot?: StoreSnapshot } = {},
): MigrationReadinessCliDeps {
  return {
    exists: (path) => files.has(path),
    readTextFile: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing file: ${path}`);
      return text;
    },
    writeTextFile: (path, text) => {
      files.set(path, text);
    },
    loadSnapshotFromSqlite: () => options.sqliteSnapshot,
  };
}

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
