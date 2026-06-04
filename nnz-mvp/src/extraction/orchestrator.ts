import type { LlmAdapter } from '../llm/types';
import type { InMemorySoulStore } from '../domain/soul-store';
import type { SoulUpdateProposal, UserPersonaScope } from '../domain/types';
import type { ExtractionResult } from './types';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompts';
import { mergeWithExisting } from './confidence';

const EXTRACTION_WINDOW = 10;       // extract every N new conversations
const EXTRACTION_TRIGGER_COUNT = 5; // trigger after N new since last extraction

export interface ExtractionOrchestrator {
  maybeExtractAndPropose(
    scope: UserPersonaScope,
    store: InMemorySoulStore,
    adapter: LlmAdapter,
  ): Promise<SoulUpdateProposal[]>;
}

export function createExtractionOrchestrator(): ExtractionOrchestrator {
  const lastIndex = new Map<string, number>(); // scope key → last extracted message index

  function scopeKey(scope: UserPersonaScope): string {
    return `${scope.userId}:${scope.personaId}`;
  }

  return {
    async maybeExtractAndPropose(scope, store, adapter) {
      const key = scopeKey(scope);
      const conversations = store.listConversations(scope);
      const last = lastIndex.get(key) ?? 0;

      // Only trigger when enough new messages since last extraction
      if (conversations.length - last < EXTRACTION_TRIGGER_COUNT) {
        return [];
      }

      // Get recent window of conversations
      const start = Math.max(0, conversations.length - EXTRACTION_WINDOW);
      const window = conversations.slice(start);

      // Build prompt and call LLM
      const prompt = buildExtractionPrompt(window);
      const response = await adapter.complete({
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.1,
        jsonMode: true,
      });

      let extraction: ExtractionResult;
      try {
        extraction = JSON.parse(response.content) as ExtractionResult;
      } catch {
        return []; // parse failed, skip this round
      }

      // Update last index
      lastIndex.set(key, conversations.length);

      // Merge with existing memories and proposals
      const existingMemories = store.listMemory(scope);
      const existingProposals = store.listSoulUpdateProposals(scope);
      const proposals: SoulUpdateProposal[] = [];

      for (const [fieldKey, field] of Object.entries(extraction)) {
        if (!field || field.value === null) continue;

        const merged = mergeWithExisting(fieldKey, field, existingMemories, existingProposals);

        // Store as memory
        const memory = store.addMemory({
          ...scope,
          type: 'CHAT_EXCERPT',
          source: 'CONVERSATION',
          content: `[extracted] ${fieldKey}=${JSON.stringify(field.value)} (confidence=${merged.confidence})`,
          confidence: merged.confidence,
          enabledForSoul: merged.shouldPropose,
          enabledForRuntime: false,
          enabledForSoulUpdate: merged.shouldPropose,
          evidenceIds: [],
          createdBy: 'SYSTEM',
        });

        // Generate proposal if confidence is high enough
        if (merged.shouldPropose && merged.fieldPath) {
          try {
            const proposal = store.createSoulUpdateProposal({
              ...scope,
              fieldPath: merged.fieldPath,
              newValue: merged.value,
              evidenceIds: [memory.id],
            });
            proposals.push(proposal);
          } catch {
            // fieldPath not in whitelist or evidence rejected — expected, skip
          }
        }
      }

      return proposals;
    },
  };
}
