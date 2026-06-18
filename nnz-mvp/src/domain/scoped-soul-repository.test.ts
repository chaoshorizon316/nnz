import { describe, expect, it } from 'vitest';

import { OwnershipError, ScopeValidationError } from './errors';
import { bindSoulRepository } from './scoped-soul-repository';
import { InMemorySoulStore } from './soul-store';

function createFixture() {
  const store = new InMemorySoulStore();
  const userA = store.createUser('用户 A');
  const userB = store.createUser('用户 B');
  const personaA = store.createPersona({
    userId: userA.id,
    displayName: '爸爸',
    relationship: '女儿',
    type: 'DECEASED',
  });
  const personaB = store.createPersona({
    userId: userB.id,
    displayName: '爸爸',
    relationship: '儿子',
    type: 'DECEASED',
  });

  return { store, userA, userB, personaA, personaB };
}

describe('ScopedSoulRepository', () => {
  it('binds only to a complete owned user/persona scope', () => {
    const { store, userA, personaA, personaB } = createFixture();

    expect(() => bindSoulRepository(store, { personaId: personaA.id } as never)).toThrow(ScopeValidationError);
    expect(() => bindSoulRepository(store, { userId: userA.id, personaId: personaB.id })).toThrow(OwnershipError);

    const repo = bindSoulRepository(store, { userId: userA.id, personaId: personaA.id });

    expect(repo.scope).toEqual({ userId: userA.id, personaId: personaA.id });
    expect(repo.getPersona()).toEqual(personaA);
  });

  it('keeps all reads and writes inside the bound scope', () => {
    const { store, userA, userB, personaA, personaB } = createFixture();
    const repoA = bindSoulRepository(store, { userId: userA.id, personaId: personaA.id });
    const repoB = bindSoulRepository(store, { userId: userB.id, personaId: personaB.id });

    const soulA = repoA.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'low' } },
    });
    const soulB = repoB.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'medium' } },
    });
    const memoryA = repoA.addMemory({
      type: 'DESCRIPTION',
      content: '爸爸说话慢，但很认真。',
      confidence: 0.9,
      enabledForSoul: true,
    });

    expect(repoA.getLatestSoulVersion()).toEqual(soulA);
    expect(repoB.getLatestSoulVersion()).toEqual(soulB);
    expect(repoA.listMemory()).toEqual([memoryA]);
    expect(repoB.listMemory()).toEqual([]);
  });

  it('does not let caller-supplied ids override the bound scope', () => {
    const { store, userA, userB, personaA, personaB } = createFixture();
    const repoA = bindSoulRepository(store, { userId: userA.id, personaId: personaA.id });
    bindSoulRepository(store, { userId: userB.id, personaId: personaB.id });

    const soul = repoA.createSoulVersion({
      userId: userB.id,
      personaId: personaB.id,
      kernelJson: { owner: 'A' },
    } as never);
    const memory = repoA.addMemory({
      userId: userB.id,
      personaId: personaB.id,
      type: 'DESCRIPTION',
      content: '这是用户 A 心中的爸爸。',
      confidence: 1,
      enabledForSoul: true,
    } as never);

    expect(soul).toMatchObject({ userId: userA.id, personaId: personaA.id });
    expect(memory).toMatchObject({ userId: userA.id, personaId: personaA.id });
    expect(store.listMemory({ userId: userB.id, personaId: personaB.id })).toEqual([]);
  });

  it('keeps proposal evidence and node conversations scoped', () => {
    const { store, userA, userB, personaA, personaB } = createFixture();
    const repoA = bindSoulRepository(store, { userId: userA.id, personaId: personaA.id });
    const repoB = bindSoulRepository(store, { userId: userB.id, personaId: personaB.id });
    repoA.createSoulVersion({ kernelJson: { affectModel: { humorLevel: 'low' } } });
    repoB.createSoulVersion({ kernelJson: { affectModel: { humorLevel: 'medium' } } });

    const evidenceA = repoA.addMemory({
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });
    const evidenceB = repoB.addMemory({
      type: 'CORRECTION',
      content: '爸爸总是慢慢说。',
      confidence: 1,
      enabledForSoul: true,
    });
    const proposalA = repoA.createSoulUpdateProposal({
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [evidenceA.id],
    });
    const nodeB = repoB.createNode({ name: '生日' });

    expect(repoA.listSoulUpdateProposalEvidence(proposalA.id)).toEqual([evidenceA]);
    expect(() =>
      repoA.createSoulUpdateProposal({
        fieldPath: 'affectModel.humorLevel',
        newValue: 'high',
        evidenceIds: [evidenceB.id],
      }),
    ).toThrow(OwnershipError);
    expect(() =>
      repoA.addConversation({
        nodeId: nodeB.id,
        role: 'USER',
        content: '我要结婚了。',
      }),
    ).toThrow(OwnershipError);
  });

  it('runs covenant lifecycle without affecting another bound repository', () => {
    const { store, userA, userB, personaA, personaB } = createFixture();
    const repoA = bindSoulRepository(store, { userId: userA.id, personaId: personaA.id });
    const repoB = bindSoulRepository(store, { userId: userB.id, personaId: personaB.id });
    repoA.createSoulVersion({ kernelJson: { identityCore: { displayName: '爸爸' } } });
    repoB.createSoulVersion({ kernelJson: { identityCore: { displayName: '爸爸' } } });

    const sealed = repoA.sealSoul();
    const node = repoA.activateNode('婚礼');
    const completed = repoA.completeNode();
    const graduated = repoA.graduateSoul();

    expect(sealed.session.state).toBe('SEALED');
    expect(node.session.state).toBe('NODE');
    expect(completed.state).toBe('SEALED');
    expect(graduated.state).toBe('GRADUATED');
    expect(repoB.getRuntimeSession().state).toBe('ACTIVE');
    expect(repoB.getRuntimeContext().state).toBe('ACTIVE');
  });

  it('returns scope-private maturity reports', () => {
    const { store, userA, userB, personaA, personaB } = createFixture();
    const repoA = bindSoulRepository(store, { userId: userA.id, personaId: personaA.id });
    const repoB = bindSoulRepository(store, { userId: userB.id, personaId: personaB.id });
    repoA.createSoulVersion({ kernelJson: { identityCore: { displayName: '爸爸' } } });
    repoB.createSoulVersion({ kernelJson: { identityCore: { displayName: '爸爸' } } });
    repoA.addMemory({
      type: 'DESCRIPTION',
      content: '爸爸会叫我丫头。',
      confidence: 1,
      enabledForSoul: true,
    });

    const reportA = repoA.buildSoulMaturityReport();
    const reportB = repoB.buildSoulMaturityReport();

    expect(reportA).toMatchObject({ userId: userA.id, personaId: personaA.id, memoryCount: 1 });
    expect(reportB).toMatchObject({ userId: userB.id, personaId: personaB.id, memoryCount: 0 });
  });
});
