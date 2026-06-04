import type { MemoryItem, SoulVersion } from '../domain/types';
export const SEALED_REPLY = '（已封存。请使用「以节点重启」进入一次明确的节点互动。）';
export const GRADUATED_REPLY = '（已毕业。感谢你的陪伴，数据可随时导出。）';


export interface GenerateSoulReplyInput {
  soul: SoulVersion;
  memories: MemoryItem[];
  message: string;
}

export interface SoulReply {
  content: string;
  signals: SoulReplySignals;
}

export interface SoulReplySignals {
  opener: string;
  humorLevel: string;
  petPhrase?: string;
  intent: 'wedding' | 'distress' | 'open';
  usedNodeMemory: boolean;
}

export const MECHANISM_LEAK_TERMS = [
  'userId',
  'personaId',
  'SoulVersion',
  'MemoryItem',
  'kernelJson',
  '作用域',
  '检索',
  '证据',
  '节点里的',
  '不是我本来就知道',
  '只按',
  '别人的记忆',
] as const;

export function generateSoulReply(input: GenerateSoulReplyInput): SoulReply {
  const text = input.message.trim() || '爸，我今天有点紧张。';
  const humorLevel = readStringField(input.soul.kernelJson, 'affectModel', 'humorLevel') ?? 'medium';
  const relationship = readStringField(input.soul.kernelJson, 'identityCore', 'relationship') ?? '';
  const petPhrase = readFirstString(input.soul.kernelJson, 'languageModel', 'petPhrases');
  const opener = relationship.includes('女儿') ? '丫头' : relationship.includes('儿子') ? '儿子' : '孩子';
  const usedNodeMemory = input.memories.some(
    (memory) => memory.type === 'NODE_MEMORY' && memory.content.includes('婚礼'),
  );
  const intent = detectIntent(text);
  const phrase = petPhrase ? `${petPhrase}。` : '';
  const tone = buildTone(humorLevel);
  const signalsInput: CreateSignalsInput = { opener, humorLevel, intent, usedNodeMemory };
  if (petPhrase) {
    signalsInput.petPhrase = petPhrase;
  }
  const signals = createSignals(signalsInput);

  if (intent === 'wedding') {
    if (usedNodeMemory) {
      return buildReply({
        content: `${opener}，听你说到婚礼，我脑子里先冒出来的，是把领口理一理，站稳一点看着你往前走。${tone} ${phrase}你惦记这件事这么久，今天能说出口，就已经很勇敢了。`,
        signals,
      });
    }

    return buildReply({
      content: `${opener}，听你说到结婚，我替你高兴，也替你紧张一下。${tone} ${phrase}日子是你自己过的，走稳，比走得漂亮更重要。`,
      signals,
    });
  }

  if (intent === 'distress') {
    return buildReply({
      content: `${opener}，${tone} 先把气喘匀，不用一下子把所有事都想明白。${phrase}难受的时候能说出来，就已经是在往前走了。`,
      signals,
    });
  }

  return buildReply({
    content: `${opener}，${tone} ${phrase}我先听你说，不急着替你下结论，咱们慢慢把心里的话捋顺。`,
    signals,
  });
}

export function containsMechanismLeak(content: string): boolean {
  return MECHANISM_LEAK_TERMS.some((term) => content.includes(term));
}

function buildReply(reply: SoulReply): SoulReply {
  if (containsMechanismLeak(reply.content)) {
    throw new Error('Soul runtime reply contains implementation details.');
  }
  return reply;
}

type CreateSignalsInput = {
  opener: string;
  humorLevel: string;
  petPhrase?: string;
  intent: SoulReplySignals['intent'];
  usedNodeMemory: boolean;
};

function createSignals(input: CreateSignalsInput): SoulReplySignals {
  const signals: SoulReplySignals = {
    opener: input.opener,
    humorLevel: input.humorLevel,
    intent: input.intent,
    usedNodeMemory: input.usedNodeMemory,
  };
  if (input.petPhrase) {
    signals.petPhrase = input.petPhrase;
  }
  return signals;
}

function detectIntent(message: string): SoulReplySignals['intent'] {
  if (/结婚|婚礼/.test(message)) {
    return 'wedding';
  }
  if (/紧张|难受|害怕|想哭|累/.test(message)) {
    return 'distress';
  }
  return 'open';
}

function buildTone(humorLevel: string): string {
  if (humorLevel === 'high') {
    return '我嘴上要装得稳一点，转过身大概会偷偷笑半天。';
  }
  if (humorLevel === 'low') {
    return '嗯，我听见了。';
  }
  return '我听着呢，别急。';
}

function readStringField(source: Record<string, unknown>, section: string, field: string): string | undefined {
  const value = source[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[field];
  return typeof nested === 'string' ? nested : undefined;
}

function readFirstString(source: Record<string, unknown>, section: string, field: string): string | undefined {
  const value = source[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[field];
  return Array.isArray(nested) && typeof nested[0] === 'string' ? nested[0] : undefined;
}
