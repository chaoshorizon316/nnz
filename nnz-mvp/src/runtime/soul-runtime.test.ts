import { describe, expect, it } from 'vitest';
import type { MemoryItem, SoulVersion } from '../domain/types';
import { containsMechanismLeak, generateSoulReply, GRADUATED_REPLY, MECHANISM_LEAK_TERMS, SEALED_REPLY } from './soul-runtime';

describe('Soul runtime reply generation', () => {
  it('expresses different user-scoped Souls without exposing implementation details', () => {
    const soulA = soul({
      identityCore: { relationship: '女儿心中的父亲' },
      affectModel: { humorLevel: 'high' },
      languageModel: { petPhrases: ['你自己拿主意'] },
    });
    const soulB = soul({
      identityCore: { relationship: '儿子心中的父亲' },
      affectModel: { humorLevel: 'medium' },
      languageModel: { petPhrases: ['慢慢来'] },
    });

    const replyA = generateSoulReply({
      soul: soulA,
      memories: [memory({ type: 'NODE_MEMORY', content: '节点「婚礼」已激活。' })],
      message: '爸，我要结婚了。',
    });
    const replyB = generateSoulReply({
      soul: soulB,
      memories: [],
      message: '爸，我要结婚了。',
    });

    expect(replyA.content).toContain('丫头');
    expect(replyA.content).toContain('你自己拿主意');
    expect(replyA.signals.usedNodeMemory).toBe(true);
    expect(replyB.content).toContain('儿子');
    expect(replyB.content).toContain('慢慢来');
    expect(replyB.signals.usedNodeMemory).toBe(false);
    expect(replyA.content).not.toEqual(replyB.content);
    expect(containsMechanismLeak(replyA.content)).toBe(false);
    expect(containsMechanismLeak(replyB.content)).toBe(false);
  });

  it('does not treat ordinary memories as node context', () => {
    const reply = generateSoulReply({
      soul: soul({
        identityCore: { relationship: '女儿心中的父亲' },
        affectModel: { humorLevel: 'high' },
      }),
      memories: [memory({ type: 'DESCRIPTION', content: '爸爸参加过很多婚礼。' })],
      message: '爸，我要结婚了。',
    });

    expect(reply.signals.intent).toBe('wedding');
    expect(reply.signals.usedNodeMemory).toBe(false);
    expect(reply.content).not.toContain('惦记这件事这么久');
  });

  it('keeps the public reply vocabulary free from mechanism terms', () => {
    const reply = generateSoulReply({
      soul: soul({ identityCore: { relationship: '儿子心中的父亲' } }),
      memories: [],
      message: '爸，你会怎么鼓励我？',
    });

    for (const term of MECHANISM_LEAK_TERMS) {
      expect(reply.content).not.toContain(term);
    }
  });
  it('SEALED_REPLY and GRADUATED_REPLY do not contain mechanism leak terms', () => {

    expect(containsMechanismLeak(SEALED_REPLY)).toBe(false);
    expect(containsMechanismLeak(GRADUATED_REPLY)).toBe(false);
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
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
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
    createdAt: new Date('2026-06-02T00:00:00.000Z'),
  };
}
