import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from '../domain/persistence';
import { InMemorySoulStore } from '../domain/soul-store';
import { runStoreSnapshotExportCommand } from './store-snapshot-export-cli';

describe('StoreSnapshot export CLI', () => {
  it('exports a raw StoreSnapshot JSON file without printing sensitive content', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify(snapshot)],
    ]);

    const result = runStoreSnapshotExportCommand(
      ['--from-json', '/tmp/input.json', '--out', '/tmp/exported.json'],
      deps(files),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('StoreSnapshot export');
    expect(result.stdout).toContain('- users: 1');
    expect(result.stdout).not.toContain('private memory text');
    expect(result.stdout).not.toContain('private chat text');
    expect(files.get('/tmp/exported.json')).toContain('private memory text');
    expect(files.get('/tmp/exported.json')).toContain('private chat text');
  });

  it('accepts snapshot_json wrappers from prior exports', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify({ rows: [{ snapshot_json: snapshot }] })],
    ]);

    const result = runStoreSnapshotExportCommand(
      ['--from-json', '/tmp/input.json', '--out', '/tmp/exported.json'],
      deps(files),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(files.get('/tmp/exported.json') ?? '{}')).toMatchObject({
      users: [{ id: snapshot.users[0]!.id }],
      opsAuditEvents: [],
    });
  });

  it('exports a snapshot loaded from an explicit SQLite path', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([['/tmp/store.db', 'sqlite-placeholder']]);

    const result = runStoreSnapshotExportCommand(
      ['--from-sqlite', '/tmp/store.db', '--out', '/tmp/exported.json'],
      deps(files, { sqliteSnapshot: snapshot }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('source: sqlite');
    expect(files.get('/tmp/exported.json')).toContain(snapshot.users[0]!.id);
  });

  it('refuses to overwrite an existing output path unless forced', () => {
    const snapshot = createSnapshot();
    const files = new Map<string, string>([
      ['/tmp/input.json', JSON.stringify(snapshot)],
      ['/tmp/exported.json', '{}'],
    ]);

    const result = runStoreSnapshotExportCommand(
      ['--from-json', '/tmp/input.json', '--out', '/tmp/exported.json'],
      deps(files),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('already exists');

    const forced = runStoreSnapshotExportCommand(
      ['--from-json', '/tmp/input.json', '--out', '/tmp/exported.json', '--force'],
      deps(files),
    );
    expect(forced.exitCode).toBe(0);
  });

  it('does not read files when required arguments are missing', () => {
    const result = runStoreSnapshotExportCommand([], deps(new Map()));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing input source');
  });
});

function deps(
  files: Map<string, string>,
  options: { sqliteSnapshot?: StoreSnapshot } = {},
): Parameters<typeof runStoreSnapshotExportCommand>[1] {
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
