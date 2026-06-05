import { describe, expect, it } from 'vitest';
import { createMockAdapter } from '../llm/adapter';
import type { ConversationMessage, MemoryItem, SoulVersion } from '../domain/types';
import type { LlmCompletionRequest, LlmCompletionResponse } from '../llm/types';
import { buildLlmReplyPrompt, generateLlmReply, sanitizeLlmReply } from './llm-reply';
import { containsMechanismLeak } from './soul-runtime';

describe('LLM reply prompt contract', () => {
  it('builds distinct prompts for daughter and son scoped Souls', () => {
    const promptA = buildLlmReplyPrompt({
      soul: soul({
        identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' },
        affectModel: { humorLevel: 'high' },
        languageModel: { petPhrases: ['你自己拿主意'] },
      }),
      memories: [memory({ type: 'CORRECTION', content: '爸爸其实很幽默，只是不太主动开玩笑。' })],
      recentConversations: [
        conversation({ role: 'USER', content: '爸，我最近工作压力有点大。' }),
        conversation({ role: 'ASSISTANT', content: '丫头，先慢慢说。' }),
      ],
      message: '爸，我要结婚了。',
    });
    const promptB = buildLlmReplyPrompt({
      soul: soul({
        identityCore: { displayName: '爸爸', relationship: '儿子心中的父亲' },
        affectModel: { humorLevel: 'medium' },
        languageModel: { petPhrases: ['慢慢来'] },
      }),
      memories: [],
      recentConversations: [
        conversation({ role: 'USER', content: '爸，我最近工作压力有点大。' }),
        conversation({ role: 'ASSISTANT', content: '儿子，别急。' }),
      ],
      message: '爸，我要结婚了。',
    });

    expect(promptA.systemPrompt).toContain('You speak to your daughter');
    expect(promptA.systemPrompt).toContain('Address them as "丫头"');
    expect(promptA.systemPrompt).toContain('你自己拿主意');
    expect(promptA.systemPrompt).toContain('Very humorous');
    expect(promptA.systemPrompt).toContain('爸爸其实很幽默');

    expect(promptB.systemPrompt).toContain('You speak to your son');
    expect(promptB.systemPrompt).toContain('Address them as "儿子"');
    expect(promptB.systemPrompt).toContain('慢慢来');
    expect(promptB.systemPrompt).toContain('Moderately humorous');
    expect(promptB.systemPrompt).not.toContain('爸爸其实很幽默');

    expect(promptA.systemPrompt).not.toEqual(promptB.systemPrompt);
  });

  it('keeps node context and recent conversation scoped to the caller input', () => {
    const promptA = buildLlmReplyPrompt({
      soul: soul({ identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' } }),
      memories: [memory({ type: 'NODE_MEMORY', content: '节点「婚礼」已激活。' })],
      recentConversations: [
        conversation({ role: 'USER', content: 'A 自己的上一句话。' }),
        conversation({ role: 'ASSISTANT', content: 'A 自己收到的回复。' }),
      ],
      message: '爸，我要结婚了。',
    });
    const promptB = buildLlmReplyPrompt({
      soul: soul({ identityCore: { displayName: '爸爸', relationship: '儿子心中的父亲' } }),
      memories: [],
      recentConversations: [
        conversation({ role: 'USER', content: 'B 自己的上一句话。' }),
        conversation({ role: 'ASSISTANT', content: 'B 自己收到的回复。' }),
      ],
      message: '爸，我要结婚了。',
    });

    expect(promptA.systemPrompt).toContain('CURRENT CONTEXT: 节点「婚礼」已激活。');
    expect(promptB.systemPrompt).not.toContain('节点「婚礼」已激活。');
    expect(promptA.userPrompt).toContain('A 自己的上一句话。');
    expect(promptA.userPrompt).not.toContain('B 自己的上一句话。');
    expect(promptB.userPrompt).toContain('B 自己的上一句话。');
    expect(promptB.userPrompt).not.toContain('A 自己的上一句话。');
  });

  it('includes knowledge cutoff instruction when a Soul has a cutoff date', () => {
    const prompt = buildLlmReplyPrompt({
      soul: {
        ...soul({ identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' } }),
        knowledgeCutoff: new Date('2024-05-01T00:00:00.000Z'),
      },
      memories: [],
      recentConversations: [],
      message: '爸，今天发生了一件新事。',
    });

    expect(prompt.systemPrompt).toContain('Your knowledge ends at 2024-05-01');
    expect(prompt.systemPrompt).toContain('如果我还活着');
  });
});

describe('LLM reply generation guards', () => {
  it('returns sanitized model content when it is valid', async () => {
    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => ({
      content: '（笑了笑）丫头，先把气喘匀，爸在这儿听你说。',
      finishReason: 'stop',
    }));

    const reply = await generateLlmReply(adapter, {
      soul: soul({ identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' } }),
      memories: [],
      recentConversations: [],
      message: '爸，我心里有点乱。',
    });

    expect(reply).toBe('丫头，先把气喘匀，爸在这儿听你说。');
    expect(containsMechanismLeak(reply)).toBe(false);
  });

  it('falls back when model content is empty after trimming', async () => {
    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => ({
      content: '   ',
      finishReason: 'stop',
    }));

    const reply = await generateLlmReply(adapter, {
      soul: soul({
        identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' },
        affectModel: { humorLevel: 'low' },
        languageModel: { petPhrases: ['你自己拿主意'] },
      }),
      memories: [],
      recentConversations: [],
      message: '爸，我今天有点累。',
    });

    expect(reply).toContain('丫头');
    expect(reply).toContain('你自己拿主意');
    expect(reply.trim()).not.toBe('');
  });

  it('falls back when model content leaks backend mechanism terms', async () => {
    const adapter = createMockAdapter((_req: LlmCompletionRequest): LlmCompletionResponse => ({
      content: '我会根据 SoulVersion 和 MemoryItem 来回答你。',
      finishReason: 'stop',
    }));

    const reply = await generateLlmReply(adapter, {
      soul: soul({
        identityCore: { displayName: '爸爸', relationship: '儿子心中的父亲' },
        affectModel: { humorLevel: 'medium' },
        languageModel: { petPhrases: ['慢慢来'] },
      }),
      memories: [],
      recentConversations: [],
      message: '爸，你会怎么鼓励我？',
    });

    expect(reply).toContain('儿子');
    expect(reply).toContain('慢慢来');
    expect(containsMechanismLeak(reply)).toBe(false);
  });

  it('strips stage-direction style annotations', () => {
    expect(sanitizeLlmReply('（放下手中的报纸）儿子，慢慢来。')).toBe('儿子，慢慢来。');
    expect(sanitizeLlmReply('(笑了笑)丫头，爸听着呢。')).toBe('丫头，爸听着呢。');
  });
});

function soul(kernelJson: Record<string, unknown>): SoulVersion {
  return {
    id: 'soul_test',
    userId: 'user_test',
    personaId: 'persona_test',
    version: 1,
    kernelJson,
    status: 'ACTIVE',
    createdAt: new Date('2026-06-05T00:00:00.000Z'),
  };
}

function memory(input: Pick<MemoryItem, 'type' | 'content'>): MemoryItem {
  return {
    id: 'memory_test',
    userId: 'user_test',
    personaId: 'persona_test',
    type: input.type,
    source: input.type === 'NODE_MEMORY' ? 'NODE' : 'USER_INPUT',
    content: input.content,
    confidence: 1,
    sensitivity: input.type === 'RISK' ? 'RESTRICTED' : 'LOW',
    enabledForSoul: input.type !== 'NODE_MEMORY',
    enabledForRuntime: input.type !== 'RISK',
    enabledForSoulUpdate: input.type !== 'NODE_MEMORY' && input.type !== 'RISK',
    evidenceIds: [],
    createdBy: input.type === 'RISK' ? 'SYSTEM' : 'USER',
    state: 'ACTIVE',
    createdAt: new Date('2026-06-05T00:00:00.000Z'),
  };
}

function conversation(input: Pick<ConversationMessage, 'role' | 'content'>): ConversationMessage {
  return {
    id: 'conversation_test',
    userId: 'user_test',
    personaId: 'persona_test',
    role: input.role,
    content: input.content,
    createdAt: new Date('2026-06-05T00:00:00.000Z'),
  };
}
