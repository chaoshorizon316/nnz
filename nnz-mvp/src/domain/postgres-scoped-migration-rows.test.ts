import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from './persistence';
import { POSTGRES_SCOPED_MIGRATION_TABLE_ORDER } from './postgres-scoped-migration-plan';
import {
  buildPostgresScopedMigrationRows,
  PostgresScopedMigrationRowsError,
} from './postgres-scoped-migration-rows';
import { InMemorySoulStore } from './soul-store';

describe('Postgres scoped migration rows', () => {
  it('builds scoped table rows in insert order from a valid StoreSnapshot', () => {
    const snapshot = createSnapshot();

    const rowPlan = buildPostgresScopedMigrationRows(snapshot, { migratedAt: '2026-06-26T00:00:00.000Z' });

    expect(rowPlan.plan.ready).toBe(true);
    expect(rowPlan.tables.map((table) => table.table)).toEqual([...POSTGRES_SCOPED_MIGRATION_TABLE_ORDER]);
    expect(rowPlan.totalRows).toBe(rowPlan.plan.totalRows);
    expect(tableRows(rowPlan, 'nnz_users')[0]).toMatchObject({
      id: snapshot.users[0]!.id,
      display_name: 'user-a@example.test',
    });
    expect(tableRows(rowPlan, 'nnz_personas')[0]).toMatchObject({
      id: snapshot.personas[0]!.id,
      user_id: snapshot.users[0]!.id,
      display_name: 'Father',
    });
    expect(tableRows(rowPlan, 'nnz_memory_items')[0]).toMatchObject({
      content: 'private memory text',
      evidence_ids: [],
      enabled_for_soul: true,
    });
    expect(tableRows(rowPlan, 'nnz_conversation_messages')[0]).toMatchObject({
      content: 'private chat text',
      role: 'USER',
    });
  });

  it('flattens NODE session nodeContext into runtime session rows', () => {
    const snapshot = createSnapshot();
    const session = snapshot.sessions[0]!;

    const rowPlan = buildPostgresScopedMigrationRows(snapshot, { migratedAt: '2026-06-26T00:00:00.000Z' });

    expect(tableRows(rowPlan, 'nnz_runtime_sessions')[0]).toMatchObject({
      user_id: session.userId,
      persona_id: session.personaId,
      state: 'NODE',
      soul_snapshot_id: session.soulSnapshotId,
      node_id: session.nodeContext?.nodeId,
      node_name: session.nodeContext?.nodeName,
      updated_at: '2026-06-26T00:00:00.000Z',
    });
  });

  it('refuses to build rows when the migration plan has blocking errors', () => {
    const snapshot = createSnapshot();
    snapshot.soulSnapshots[0]!.memoryIds.push('missing-memory');

    expect(() => buildPostgresScopedMigrationRows(snapshot)).toThrow(PostgresScopedMigrationRowsError);
  });
});

function tableRows(
  rowPlan: ReturnType<typeof buildPostgresScopedMigrationRows>,
  table: string,
): Array<Record<string, unknown>> {
  return rowPlan.tables.find((item) => item.table === table)!.rows;
}

function createSnapshot(): StoreSnapshot {
  const store = new InMemorySoulStore();
  const user = store.createUser('user-a@example.test');
  const persona = store.createPersona({
    userId: user.id,
    displayName: 'Father',
    relationship: 'daughter',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: user.id,
    personaId: persona.id,
    kernelJson: { affectModel: { humorLevel: 'low' } },
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
  store.sealSoul({ userId: user.id, personaId: persona.id });
  store.activateNode({ userId: user.id, personaId: persona.id }, 'wedding');
  return store.serialize();
}
