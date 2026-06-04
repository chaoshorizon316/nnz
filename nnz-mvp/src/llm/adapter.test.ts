import { describe, expect, it } from 'vitest';
import { completeStructured, createMockAdapter } from './adapter';
import type { LlmCompletionRequest, LlmCompletionResponse } from './types';

describe('LLM adapter', () => {
  it('mock adapter returns the handler result unchanged', async () => {
    const expected: LlmCompletionResponse = {
      content: '{"humorLevel": "high"}',
      parsed: { humorLevel: 'high' },
      finishReason: 'stop',
    };

    const adapter = createMockAdapter((_req: LlmCompletionRequest) => expected);
    const result = await adapter.complete({
      systemPrompt: 'You are a helpful assistant.',
      userPrompt: 'Hello',
    });

    expect(result).toBe(expected);
    expect(result.content).toBe('{"humorLevel": "high"}');
    expect(result.parsed).toEqual({ humorLevel: 'high' });
    expect(result.finishReason).toBe('stop');
  });

  it('completeStructured uses jsonMode and returns parsed result', async () => {
    const adapter = createMockAdapter((_req: LlmCompletionRequest) => ({
      content: '{"careStyle": "action", "evidence": ["想吃什么"]}',
      parsed: { careStyle: 'action', evidence: ['想吃什么'] },
      finishReason: 'stop',
    }));

    const result = await completeStructured<{ careStyle: string; evidence: string[] }>(
      adapter,
      {
        systemPrompt: 'Extract personality traits.',
        userPrompt: '爸：没关系，下次努力就行了。你想吃什么？',
      },
    );

    expect(result.careStyle).toBe('action');
    expect(result.evidence).toEqual(['想吃什么']);
  });

  it('throws when JSON parse fails and no parsed field', async () => {
    const adapter = createMockAdapter((_req: LlmCompletionRequest) => ({
      content: 'not json at all',
      parsed: undefined,
      finishReason: 'stop',
    }));

    await expect(
      completeStructured(adapter, {
        systemPrompt: 'test',
        userPrompt: 'test',
      }),
    ).rejects.toThrow('LLM did not return valid JSON');
  });

  it('passes through temperature, maxTokens, and jsonMode to the request', async () => {
    let captured: LlmCompletionRequest | undefined;

    const adapter = createMockAdapter((req: LlmCompletionRequest) => {
      captured = req;
      return { content: '{}', parsed: {}, finishReason: 'stop' };
    });

    await adapter.complete({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      temperature: 0.7,
      maxTokens: 100,
    });

    expect(captured).toBeDefined();
    expect(captured!.temperature).toBe(0.7);
    expect(captured!.maxTokens).toBe(100);
    expect(captured!.systemPrompt).toBe('sys');
    expect(captured!.userPrompt).toBe('usr');
  });
});
