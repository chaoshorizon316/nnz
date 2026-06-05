import type { MemoryItem, SoulVersion, ConversationMessage } from '../domain/types';
import type { LlmAdapter, LlmCompletionRequest } from '../llm/types';
import { containsMechanismLeak, generateSoulReply } from './soul-runtime';

export interface LlmReplyPromptInput {
  soul: Pick<SoulVersion, 'kernelJson' | 'knowledgeCutoff'>;
  memories: Pick<MemoryItem, 'type' | 'content'>[];
  recentConversations: Pick<ConversationMessage, 'role' | 'content'>[];
  message: string;
}

export interface LlmReplyPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export async function generateLlmReply(
  adapter: LlmAdapter,
  input: LlmReplyPromptInput,
): Promise<string> {
  const prompt = buildLlmReplyPrompt(input);
  const request: LlmCompletionRequest = {
    ...prompt,
    temperature: 0.7,
    maxTokens: 250,
  };
  const result = await adapter.complete(request);
  const reply = sanitizeLlmReply(result.content);

  if (!reply || containsMechanismLeak(reply)) {
    return generateFallbackReply(input);
  }

  return reply;
}

export function buildLlmReplyPrompt(input: LlmReplyPromptInput): LlmReplyPrompt {
  const displayName = readStringField(input.soul.kernelJson, 'identityCore', 'displayName') ?? '';
  const relationship = readStringField(input.soul.kernelJson, 'identityCore', 'relationship') ?? '';
  const humorLevel = readStringField(input.soul.kernelJson, 'affectModel', 'humorLevel') ?? 'medium';
  const petPhrases = readStringArray(input.soul.kernelJson, 'languageModel', 'petPhrases');

  const descriptionMemories = input.memories.filter(
    (memory) => memory.type === 'DESCRIPTION' || memory.type === 'CORRECTION',
  );
  const personalityLines = descriptionMemories.map((memory) => memory.content);
  const historyLines = buildHistoryLines(input.recentConversations, displayName);
  const humorDesc = buildHumorDescription(humorLevel);
  const relationshipStyle = buildRelationshipStyle(relationship);
  const openerName = buildOpenerName(relationship);
  const cutoffNote = buildCutoffNote(input.soul.knowledgeCutoff);
  const phraseNote = petPhrases.length > 0
    ? `\nYou naturally use these phrases: ${petPhrases.join('、')}. Weave them in naturally.`
    : '';
  const nodeContext = input.memories
    .filter((memory) => memory.type === 'NODE_MEMORY')
    .map((memory) => memory.content)
    .join(' ');

  const systemPrompt = `You are ${displayName}. You are speaking with someone who lost you.

${relationshipStyle}
${humorDesc}${phraseNote}

[WHO YOU ARE — from their memories]
${personalityLines.length > 0 ? personalityLines.join('\n') : 'You are a warm, caring parent.'}
${cutoffNote}

[RULES]
- Reply EXACTLY as ${displayName} would in a real chat. Do NOT add descriptions of your actions, expressions, or thoughts in parentheses.
- Speak naturally in Chinese. Your unique voice comes from your personality, not from explaining what you are doing.
- Address them as "${openerName}".
- Keep replies concise (1-3 sentences), like a real text message.
- Never mention AI, Soul, Memory, system, scope, evidence, or retrieval.
- Never make decisions for them — say "如果是${displayName === '爸爸' ? '爸爸' : '我'}，会..." instead.
- If they seem deeply distressed, show care but do not pretend to be a therapist.${nodeContext ? '\n- CURRENT CONTEXT: ' + nodeContext : ''}`;

  const userPrompt = historyLines
    ? `[Recent conversation]\n${historyLines}\n\n[Latest message]\n${input.message}`
    : input.message;

  return { systemPrompt, userPrompt };
}

export function sanitizeLlmReply(content: string): string {
  return content
    .trim()
    .replace(/[（(][^）)]*(?:放下|摘下|拿起|转身|站起|坐下|叹气|笑|点头|摇头|摆手|挥手|看着|望着|指着)[^）)]*[）)]/g, '')
    .replace(/^[（(].*?[）)]\s*/g, '')
    .trim();
}

function generateFallbackReply(input: LlmReplyPromptInput): string {
  return generateSoulReply({
    soul: {
      id: '',
      userId: '',
      personaId: '',
      version: 0,
      kernelJson: input.soul.kernelJson,
      status: 'ACTIVE',
      createdAt: new Date(0),
    },
    memories: input.memories.map((memory) => ({
      id: '',
      userId: '',
      personaId: '',
      type: memory.type,
      source: memory.type === 'NODE_MEMORY' ? 'NODE' : 'USER_INPUT',
      content: memory.content,
      confidence: 1,
      sensitivity: memory.type === 'RISK' ? 'RESTRICTED' : 'LOW',
      enabledForSoul: memory.type !== 'NODE_MEMORY',
      enabledForRuntime: memory.type !== 'RISK',
      enabledForSoulUpdate: memory.type !== 'NODE_MEMORY' && memory.type !== 'RISK',
      evidenceIds: [],
      createdBy: memory.type === 'RISK' ? 'SYSTEM' : 'USER',
      state: 'ACTIVE',
      createdAt: new Date(0),
    })),
    message: input.message,
  }).content;
}

function buildHistoryLines(
  recentConversations: Pick<ConversationMessage, 'role' | 'content'>[],
  displayName: string,
): string {
  if (recentConversations.length === 0) return '';

  return recentConversations.slice(-12).map((message) => {
    const prefix = message.role === 'USER' ? 'User' : displayName;
    return `${prefix}: ${message.content}`;
  }).join('\n');
}

function buildHumorDescription(humorLevel: string): string {
  if (humorLevel === 'high') {
    return 'Very humorous, often cracks jokes, but respects boundaries.';
  }
  if (humorLevel === 'low') {
    return 'Speaks plainly, warm but not very humorous. Shows care through actions, not jokes.';
  }
  return 'Moderately humorous, balances warmth with occasional wit.';
}

function buildRelationshipStyle(relationship: string): string {
  if (relationship.includes('女儿')) {
    return 'You speak to your daughter with tender concern. You call her "丫头". You are protective but respect her independence.';
  }
  if (relationship.includes('儿子')) {
    return 'You speak to your son with steady encouragement. You call him "儿子". You believe in letting him find his own path.';
  }
  return `You speak to your ${relationship} with warmth and respect.`;
}

function buildOpenerName(relationship: string): string {
  if (relationship.includes('女儿')) return '丫头';
  if (relationship.includes('儿子')) return '儿子';
  return '孩子';
}

function buildCutoffNote(cutoff?: Date): string {
  return cutoff
    ? `\nCRITICAL: Your knowledge ends at ${cutoff.toISOString().slice(0, 10)}. If the user mentions anything after this date, say "如果我还活着，我会..." — never pretend to know recent events.`
    : '';
}

function readStringField(source: Record<string, unknown>, section: string, field: string): string | undefined {
  const value = source[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[field];
  return typeof nested === 'string' ? nested : undefined;
}

function readStringArray(source: Record<string, unknown>, section: string, field: string): string[] {
  const value = source[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const nested = (value as Record<string, unknown>)[field];
  return Array.isArray(nested) ? nested.filter((item): item is string => typeof item === 'string') : [];
}
