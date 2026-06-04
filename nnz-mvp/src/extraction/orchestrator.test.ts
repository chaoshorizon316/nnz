import { describe, expect, it } from 'vitest';
import { InMemorySoulStore } from '../domain/soul-store';
import { createMockAdapter } from '../llm/adapter';
import type { LlmCompletionRequest, LlmCompletionResponse } from '../llm/types';
import { createExtractionOrchestrator } from './orchestrator';

function setup() {
  const store = new InMemorySoulStore();
  const user = store.createUser('test');
  const persona = store.createPersona({ userId: user.id, displayName: '爸爸', relationship: '女儿', type: 'DECEASED' });
  store.createSoulVersion({
    userId: user.id, personaId: persona.id,
    kernelJson: { identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' }, affectModel: { humorLevel: 'low' } },
  });
  return { store, scope: { userId: user.id, personaId: persona.id } };
}

describe('Extraction orchestrator', () => {
  it('does not trigger when insufficient conversations', async () => {
    const { store, scope } = setup();
    store.addConversation({ ...scope, role: 'USER', content: '爸，你好。' });
    store.addConversation({ ...scope, role: 'ASSISTANT', content: '丫头，你好。' });

    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => ({
      content: '{}', parsed: {}, finishReason: 'stop',
    }));
    const orchestrator = createExtractionOrchestrator();

    const proposals = await orchestrator.maybeExtractAndPropose(scope, store, adapter);
    expect(proposals).toEqual([]);
  });

  it('triggers after enough conversations and generates proposals for high-confidence traits', async () => {
    const { store, scope } = setup();
    // Add 6 conversation rounds
    for (let i = 0; i < 6; i++) {
      store.addConversation({ ...scope, role: 'USER', content: '爸，我今天有点累。' });
      store.addConversation({ ...scope, role: 'ASSISTANT', content: '丫头，慢慢来，不急。你先歇会儿，想吃什么？' });
    }

    const mockJson = JSON.stringify({
      careStyle: { value: 'action', confidence: 0.8, evidence: ['想吃什么'] },
      humorLevel: { value: 0, confidence: 0.5, evidence: [] },
      emotionalAwareness: { value: 'sensitive', confidence: 0.85, evidence: ['慢慢来，不急', '想吃什么'] },
      petPhrases: { value: ['丫头', '慢慢来'], confidence: 0.9, evidence: ['丫头', '慢慢来'] },
    });

    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => ({
      content: mockJson, parsed: JSON.parse(mockJson), finishReason: 'stop',
    }));
    const orchestrator = createExtractionOrchestrator();

    const proposals = await orchestrator.maybeExtractAndPropose(scope, store, adapter);

    // careStyle → fieldPath not in whitelist, skipped
    // humorLevel → confidence 0.5, below threshold
    // emotionalAwareness → not in SOUL_FIELD_MAP, skipped
    // petPhrases → confidence 0.9, should generate proposal
    const petPhraseProposals = proposals.filter((p) => p.fieldPath === 'languageModel.petPhrases');
    expect(petPhraseProposals.length).toBeGreaterThanOrEqual(1);
  });

  it('skips when PENDING proposal already exists for the same field', async () => {
    const { store, scope } = setup();
    for (let i = 0; i < 6; i++) {
      store.addConversation({ ...scope, role: 'USER', content: '爸。' });
      store.addConversation({ ...scope, role: 'ASSISTANT', content: '丫头，你自己拿主意。' });
    }

    // Create an existing PENDING proposal for petPhrases
    const evidence = store.addMemory({
      ...scope, type: 'CORRECTION', content: '爸爸常说你自己拿主意', confidence: 1, enabledForSoul: true,
    });
    store.createSoulUpdateProposal({
      ...scope, fieldPath: 'languageModel.petPhrases', newValue: ['你自己拿主意'], evidenceIds: [evidence.id],
    });

    const mockJson = JSON.stringify({
      petPhrases: { value: ['丫头'], confidence: 0.9, evidence: ['丫头'] },
    });

    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => ({
      content: mockJson, parsed: JSON.parse(mockJson), finishReason: 'stop',
    }));
    const orchestrator = createExtractionOrchestrator();

    const proposals = await orchestrator.maybeExtractAndPropose(scope, store, adapter);
    // Should not generate a new petPhrases proposal because one is PENDING
    const petPhraseProposals = proposals.filter((p) => p.fieldPath === 'languageModel.petPhrases');
    expect(petPhraseProposals).toEqual([]);
  });

  it('second call does not re-trigger without new conversations', async () => {
    const { store, scope } = setup();
    for (let i = 0; i < 6; i++) {
      store.addConversation({ ...scope, role: 'USER', content: '爸。' });
      store.addConversation({ ...scope, role: 'ASSISTANT', content: '丫头。' });
    }

    let callCount = 0;
    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => {
      callCount++;
      return { content: '{}', parsed: {}, finishReason: 'stop' };
    });
    const orchestrator = createExtractionOrchestrator();

    await orchestrator.maybeExtractAndPropose(scope, store, adapter);
    expect(callCount).toBe(1);

    // Second call — no new conversations since last extraction
    await orchestrator.maybeExtractAndPropose(scope, store, adapter);
    expect(callCount).toBe(1); // should not call LLM again
  });
});
