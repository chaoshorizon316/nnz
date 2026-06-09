import { describe, expect, it } from 'vitest';
import { CovenantStateError, OwnershipError, ScopeValidationError } from './errors';
import { InMemorySoulStore } from './soul-store';

function createTwoUsersWithSamePersonaName() {
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

describe('user-scoped Soul model', () => {
  it('creates independent Soul versions for two users with the same persona display name', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();

    const soulA = store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: {
        identityCore: { displayName: '爸爸' },
        affectModel: { humorLevel: 'low' },
      },
    });
    const soulB = store.createSoulVersion({
      userId: userB.id,
      personaId: personaB.id,
      kernelJson: {
        identityCore: { displayName: '爸爸' },
        affectModel: { humorLevel: 'high' },
      },
    });

    expect(soulA.id).not.toBe(soulB.id);
    expect(store.getLatestSoulVersion({ userId: userA.id, personaId: personaA.id }).kernelJson).toEqual(
      soulA.kernelJson,
    );
    expect(store.getLatestSoulVersion({ userId: userB.id, personaId: personaB.id }).kernelJson).toEqual(
      soulB.kernelJson,
    );
  });

  it('keeps one user correction from changing another user Soul', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { affectModel: { humorLevel: 'low' } },
    });
    const originalSoulB = store.createSoulVersion({
      userId: userB.id,
      personaId: personaB.id,
      kernelJson: { affectModel: { humorLevel: 'medium' } },
    });
    const evidence = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });
    const proposal = store.createSoulUpdateProposal({
      userId: userA.id,
      personaId: personaA.id,
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [evidence.id],
    });

    const updatedSoulA = store.acceptSoulUpdateProposal(
      { userId: userA.id, personaId: personaA.id },
      proposal.id,
    );

    expect(updatedSoulA.kernelJson).toMatchObject({ affectModel: { humorLevel: 'high' } });
    expect(store.getLatestSoulVersion({ userId: userB.id, personaId: personaB.id })).toEqual(originalSoulB);
  });

  it('lists, rejects, and exposes evidence for Soul update proposals in scope', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: {} });
    store.createSoulVersion({ userId: userB.id, personaId: personaB.id, kernelJson: {} });
    const evidence = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });
    const proposal = store.createSoulUpdateProposal({
      userId: userA.id,
      personaId: personaA.id,
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [evidence.id],
    });

    expect(store.listSoulUpdateProposals({ userId: userA.id, personaId: personaA.id }, 'PENDING')).toEqual([
      proposal,
    ]);
    expect(store.listSoulUpdateProposals({ userId: userB.id, personaId: personaB.id })).toEqual([]);
    expect(store.listSoulUpdateProposalEvidence({ userId: userA.id, personaId: personaA.id }, proposal.id)).toEqual([
      evidence,
    ]);

    const rejected = store.rejectSoulUpdateProposal({ userId: userA.id, personaId: personaA.id }, proposal.id);

    expect(rejected.status).toBe('REJECTED');
    expect(() => store.acceptSoulUpdateProposal({ userId: userA.id, personaId: personaA.id }, proposal.id)).toThrow();
  });

  it('keeps proposal decisions terminal while allowing a later independent proposal', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    const scope = { userId: userA.id, personaId: personaA.id };
    store.createSoulVersion({ ...scope, kernelJson: { affectModel: { humorLevel: 'low' } } });

    const firstEvidence = store.addMemory({
      ...scope,
      type: 'CORRECTION',
      content: '爸爸偶尔会讲冷笑话。',
      confidence: 0.8,
      enabledForSoul: true,
    });
    const rejectedProposal = store.createSoulUpdateProposal({
      ...scope,
      fieldPath: 'affectModel.humorLevel',
      newValue: 'medium',
      evidenceIds: [firstEvidence.id],
    });
    store.rejectSoulUpdateProposal(scope, rejectedProposal.id);

    expect(() => store.acceptSoulUpdateProposal(scope, rejectedProposal.id)).toThrow();
    expect(store.getLatestSoulVersion(scope).kernelJson).toEqual({ affectModel: { humorLevel: 'low' } });

    const secondEvidence = store.addMemory({
      ...scope,
      type: 'CORRECTION',
      content: '爸爸其实很幽默，只是不主动开玩笑。',
      confidence: 1,
      enabledForSoul: true,
    });
    const acceptedProposal = store.createSoulUpdateProposal({
      ...scope,
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [secondEvidence.id],
    });
    const updatedSoul = store.acceptSoulUpdateProposal(scope, acceptedProposal.id);

    expect(acceptedProposal.id).not.toBe(rejectedProposal.id);
    expect(updatedSoul.kernelJson).toEqual({ affectModel: { humorLevel: 'high' } });
    expect(() => store.rejectSoulUpdateProposal(scope, acceptedProposal.id)).toThrow();
    expect(store.listSoulUpdateProposals(scope).map((proposal) => proposal.status)).toEqual([
      'REJECTED',
      'ACCEPTED',
    ]);
  });

  it('builds user-scoped Soul maturity reports without cross-user leakage', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();
    const scopeA = { userId: userA.id, personaId: personaA.id };
    const scopeB = { userId: userB.id, personaId: personaB.id };
    store.createSoulVersion({
      ...scopeA,
      kernelJson: {
        identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' },
        affectModel: { humorLevel: 'low' },
        languageModel: { petPhrases: ['你自己拿主意'] },
      },
    });
    store.createSoulVersion({
      ...scopeB,
      kernelJson: {
        identityCore: { displayName: '爸爸', relationship: '儿子心中的父亲' },
        affectModel: { humorLevel: 'medium' },
        languageModel: { petPhrases: ['慢慢来'] },
      },
    });

    const initialA = store.buildSoulMaturityReport(scopeA);
    const initialB = store.buildSoulMaturityReport(scopeB);

    expect(initialA.userId).toBe(userA.id);
    expect(initialA.personaId).toBe(personaA.id);
    expect(initialB.userId).toBe(userB.id);
    expect(initialB.personaId).toBe(personaB.id);
    expect(initialA.memoryCount).toBe(0);
    expect(initialB.memoryCount).toBe(0);

    const evidence = store.addMemory({
      ...scopeA,
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });
    store.createSoulUpdateProposal({
      ...scopeA,
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [evidence.id],
    });

    const updatedA = store.buildSoulMaturityReport(scopeA);
    const unchangedB = store.buildSoulMaturityReport(scopeB);

    expect(updatedA.memoryCount).toBe(1);
    expect(updatedA.proposalCount).toBe(1);
    expect(updatedA.pendingProposalCount).toBe(1);
    expect(updatedA.recommendations.map((item) => item.type)).toContain('REVIEW_PROPOSAL');
    expect(unchangedB.memoryCount).toBe(0);
    expect(unchangedB.proposalCount).toBe(0);
    expect(unchangedB.pendingProposalCount).toBe(0);
  });

  it('rejects Soul update proposals for non-whitelisted field paths', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: {} });
    const evidence = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });

    expect(() =>
      store.createSoulUpdateProposal({
        userId: userA.id,
        personaId: personaA.id,
        fieldPath: 'systemPrompt.raw',
        newValue: 'unsafe',
        evidenceIds: [evidence.id],
      }),
    ).toThrow();
  });

  it('keeps only one ACTIVE SoulVersion per user/persona scope', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    const firstSoul = store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { affectModel: { humorLevel: 'low' } },
    });
    const secondSoul = store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { affectModel: { humorLevel: 'high' } },
    });

    const versions = store.listSoulVersions({ userId: userA.id, personaId: personaA.id });

    expect(versions.find((version) => version.id === firstSoul.id)?.status).toBe('ARCHIVED');
    expect(versions.find((version) => version.id === secondSoul.id)?.status).toBe('ACTIVE');
    expect(versions.filter((version) => version.status === 'ACTIVE')).toHaveLength(1);
    expect(store.getLatestSoulVersion({ userId: userA.id, personaId: personaA.id }).id).toBe(secondSoul.id);
  });

  it('deletes only one user credential when deleting user-scoped data', () => {
    const { store, userA, userB } = createTwoUsersWithSamePersonaName();
    store.storeCredential(userA.id, 'a@example.com', 'hash-a');
    store.storeCredential(userB.id, 'b@example.com', 'hash-b');

    store.deleteUserScopedData(userA.id);

    expect(store.getCredentialByEmail('a@example.com')).toBeUndefined();
    expect(store.getCredentialByEmail('b@example.com')).toMatchObject({
      userId: userB.id,
      email: 'b@example.com',
      passwordHash: 'hash-b',
    });
  });

  it('does not expose one user node memory through another user scope', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: {} });
    store.createSoulVersion({ userId: userB.id, personaId: personaB.id, kernelJson: {} });

    const node = store.createNode({ userId: userA.id, personaId: personaA.id, name: '婚礼' });
    store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'NODE_MEMORY',
      content: '我想在婚礼前和爸爸说说话。',
      confidence: 1,
      enabledForSoul: false,
    });
    store.addConversation({
      userId: userA.id,
      personaId: personaA.id,
      nodeId: node.id,
      role: 'USER',
      content: '我要结婚了。',
    });

    expect(store.listMemory({ userId: userB.id, personaId: personaB.id })).toEqual([]);
    expect(store.listNodes({ userId: userB.id, personaId: personaB.id })).toEqual([]);
    expect(store.listConversations({ userId: userB.id, personaId: personaB.id })).toEqual([]);
  });

  it('separates runtime memory from Soul update memory', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: {} });
    const description = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'DESCRIPTION',
      content: '爸爸说话慢，但很认真。',
      confidence: 0.9,
      enabledForSoul: true,
    });
    const nodeMemory = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'NODE_MEMORY',
      content: '节点「婚礼」已激活。',
      confidence: 1,
      enabledForSoul: false,
    });
    const risk = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'RISK',
      content: '不要模拟医疗建议。',
      confidence: 1,
      enabledForSoul: false,
    });

    const runtimeMemory = store.listRuntimeMemory({ userId: userA.id, personaId: personaA.id });
    const soulUpdateMemory = store.listSoulUpdateMemory({ userId: userA.id, personaId: personaA.id });

    expect(runtimeMemory.map((memory) => memory.id)).toContain(description.id);
    expect(runtimeMemory.map((memory) => memory.id)).toContain(nodeMemory.id);
    expect(runtimeMemory.map((memory) => memory.id)).not.toContain(risk.id);
    expect(soulUpdateMemory.map((memory) => memory.id)).toEqual([description.id]);
  });

  it('rejects NODE_MEMORY and RISK as Soul update proposal evidence', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: {} });
    const nodeMemory = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'NODE_MEMORY',
      content: '节点「婚礼」已激活。',
      confidence: 1,
      enabledForSoul: false,
    });
    const risk = store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'RISK',
      content: '不要模拟医疗建议。',
      confidence: 1,
      enabledForSoul: false,
    });

    expect(() =>
      store.createSoulUpdateProposal({
        userId: userA.id,
        personaId: personaA.id,
        fieldPath: 'affectModel.humorLevel',
        newValue: 'high',
        evidenceIds: [nodeMemory.id],
      }),
    ).toThrow(OwnershipError);
    expect(() =>
      store.createSoulUpdateProposal({
        userId: userA.id,
        personaId: personaA.id,
        fieldPath: 'affectModel.humorLevel',
        newValue: 'high',
        evidenceIds: [risk.id],
      }),
    ).toThrow(OwnershipError);
  });

  it('deletes only the requested user data', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: { owner: 'A' } });
    store.createSoulVersion({ userId: userB.id, personaId: personaB.id, kernelJson: { owner: 'B' } });
    store.addMemory({
      userId: userB.id,
      personaId: personaB.id,
      type: 'DESCRIPTION',
      content: '这是用户 B 心中的爸爸。',
      confidence: 0.9,
      enabledForSoul: true,
    });

    store.deleteUserScopedData(userA.id);

    expect(store.getLatestSoulVersion({ userId: userB.id, personaId: personaB.id }).kernelJson).toEqual({
      owner: 'B',
    });
    expect(store.listMemory({ userId: userB.id, personaId: personaB.id })).toHaveLength(1);
  });

  it('rejects Soul, memory, and snapshot APIs when userId is missing', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({ userId: userA.id, personaId: personaA.id, kernelJson: {} });
    const snapshot = store.createSoulSnapshot({ userId: userA.id, personaId: personaA.id });

    expect(() => store.getLatestSoulVersion({ personaId: personaA.id } as never)).toThrow(ScopeValidationError);
    expect(() => store.listMemory({ personaId: personaA.id } as never)).toThrow(ScopeValidationError);
    expect(() => store.getSoulSnapshot({ personaId: personaA.id } as never, snapshot.id)).toThrow(
      ScopeValidationError,
    );
    expect(() => store.buildSoulMaturityReport({ personaId: personaA.id } as never)).toThrow(ScopeValidationError);
  });

  it('sealSoul archives the soul version and transitions to SEALED state', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { identityCore: { displayName: '爸爸' } },
    });

    const { snapshot, session } = store.sealSoul({ userId: userA.id, personaId: personaA.id });

    expect(snapshot.kernelJson).toEqual({ identityCore: { displayName: '爸爸' } });
    expect(snapshot.memoryIds).toEqual([]);
    expect(session.state).toBe('SEALED');
    expect(session.soulSnapshotId).toBe(snapshot.id);

    const current = store.getRuntimeSession({ userId: userA.id, personaId: personaA.id });
    expect(current.state).toBe('SEALED');
  });

  it('activateNode transitions from SEALED to NODE and uses snapshot context', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'low' } },
    });
    store.sealSoul({ userId: userA.id, personaId: personaA.id });

    const { node, session } = store.activateNode({ userId: userA.id, personaId: personaA.id }, '婚礼');

    expect(node.name).toBe('婚礼');
    expect(node.status).toBe('ACTIVE');
    expect(session.state).toBe('NODE');
    expect(session.nodeContext?.nodeName).toBe('婚礼');

    // RuntimeContext should use snapshot kernel, not live soul
    const ctx = store.getRuntimeContext({ userId: userA.id, personaId: personaA.id });
    expect(ctx.state).toBe('NODE');
    expect(ctx.soul.kernelJson).toEqual({ identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'low' } });
    expect(ctx.memories.some((m) => m.type === 'NODE_MEMORY')).toBe(true);
  });

  it('activateNode reuses an existing active node with the same name', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { identityCore: { displayName: '爸爸' } },
    });
    const existingNode = store.createNode({ userId: userA.id, personaId: personaA.id, name: '婚礼' });
    store.addMemory({
      userId: userA.id,
      personaId: personaA.id,
      type: 'NODE_MEMORY',
      content: '节点「婚礼」已激活。',
      confidence: 1,
      enabledForSoul: false,
    });
    store.sealSoul({ userId: userA.id, personaId: personaA.id });

    const { node } = store.activateNode({ userId: userA.id, personaId: personaA.id }, '婚礼');
    const memories = store.listMemory({ userId: userA.id, personaId: personaA.id }).filter(
      (memory) => memory.type === 'NODE_MEMORY' && memory.content === '节点「婚礼」已激活。',
    );

    expect(node.id).toBe(existingNode.id);
    expect(store.listNodes({ userId: userA.id, personaId: personaA.id })).toHaveLength(1);
    expect(memories).toHaveLength(1);
  });

  it('completeNode transitions from NODE back to SEALED', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { identityCore: { displayName: '爸爸' } },
    });
    store.sealSoul({ userId: userA.id, personaId: personaA.id });
    const { node } = store.activateNode({ userId: userA.id, personaId: personaA.id }, '婚礼');

    const session = store.completeNode({ userId: userA.id, personaId: personaA.id });

    expect(session.state).toBe('SEALED');
    const updatedNode = store.listNodes({ userId: userA.id, personaId: personaA.id }).find((n) => n.id === node.id);
    expect(updatedNode?.status).toBe('COMPLETED');

    // After completing, getRuntimeContext should throw CovenantStateError (SEALED)
    expect(() => store.getRuntimeContext({ userId: userA.id, personaId: personaA.id })).toThrow(CovenantStateError);
  });

  it('graduateSoul transitions to GRADUATED and prevents further context retrieval', () => {
    const { store, userA, personaA } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { identityCore: { displayName: '爸爸' } },
    });

    const session = store.graduateSoul({ userId: userA.id, personaId: personaA.id });

    expect(session.state).toBe('GRADUATED');
    expect(() => store.getRuntimeContext({ userId: userA.id, personaId: personaA.id })).toThrow(CovenantStateError);
  });

  it('A seal, node, and graduate never affect B ACTIVE state', () => {
    const { store, userA, userB, personaA, personaB } = createTwoUsersWithSamePersonaName();
    store.createSoulVersion({
      userId: userA.id,
      personaId: personaA.id,
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'low' } },
    });
    store.createSoulVersion({
      userId: userB.id,
      personaId: personaB.id,
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'medium' } },
    });

    // A seals
    store.sealSoul({ userId: userA.id, personaId: personaA.id });
    expect(store.getRuntimeSession({ userId: userB.id, personaId: personaB.id }).state).toBe('ACTIVE');

    // A activates node
    store.activateNode({ userId: userA.id, personaId: personaA.id }, '婚礼');
    expect(store.getRuntimeSession({ userId: userB.id, personaId: personaB.id }).state).toBe('ACTIVE');

    // A completes node
    store.completeNode({ userId: userA.id, personaId: personaA.id });
    expect(store.getRuntimeSession({ userId: userB.id, personaId: personaB.id }).state).toBe('ACTIVE');

    // A graduates
    store.graduateSoul({ userId: userA.id, personaId: personaA.id });
    expect(store.getRuntimeSession({ userId: userB.id, personaId: personaB.id }).state).toBe('ACTIVE');

    // B can still generate replies
    const ctxB = store.getRuntimeContext({ userId: userB.id, personaId: personaB.id });
    expect(ctxB.state).toBe('ACTIVE');
  });

  it('rejects access when userId and personaId belong to different owners', () => {
    const { store, userA, userB, personaB } = createTwoUsersWithSamePersonaName();

    expect(() =>
      store.createSoulVersion({
        userId: userA.id,
        personaId: personaB.id,
        kernelJson: { should: 'not write cross-user soul' },
      }),
    ).toThrow(OwnershipError);

    expect(() => store.listMemory({ userId: userB.id, personaId: 'persona_that_does_not_exist' })).toThrow();
  });
});
