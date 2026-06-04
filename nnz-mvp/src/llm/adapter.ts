import type { LlmAdapter, LlmCompletionRequest, LlmCompletionResponse } from './types';

// ── OpenAI-compatible adapter ──

interface OpenAiConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export function createOpenAiAdapter(config: OpenAiConfig): LlmAdapter {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  const model = config.model ?? 'gpt-4o-mini';

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        temperature: request.temperature ?? 0.3,
      };

      if (request.maxTokens) {
        body.max_tokens = request.maxTokens;
      }

      if (request.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '(unable to read body)');
        throw new Error(
          `LLM API error ${response.status} (${response.statusText}): ${text.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
        };
      };

      const choice = data.choices[0];
      if (!choice) {
        throw new Error('LLM API returned no choices.');
      }

      const content = choice.message.content ?? '';

      let parsed: unknown;
      if (request.jsonMode) {
        try {
          parsed = JSON.parse(content);
        } catch {
          // If JSON parse fails, return raw content and let caller decide
        }
      }

      const result: LlmCompletionResponse = {
        content,
        parsed,
        finishReason: choice.finish_reason,
      };
      if (data.usage) {
        result.usage = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
        };
      }
      return result;
    },
  };
}

// ── Mock adapter (for testing without real API) ──

export function createMockAdapter(
  handler: (request: LlmCompletionRequest) => LlmCompletionResponse,
): LlmAdapter {
  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
      return handler(request);
    },
  };
}

// ── Convenience: structured extraction helper ──

export async function completeStructured<T>(
  adapter: LlmAdapter,
  request: LlmCompletionRequest,
): Promise<T> {
  const response = await adapter.complete({
    ...request,
    jsonMode: true,
  });

  if (response.parsed) {
    return response.parsed as T;
  }

  throw new Error(`LLM did not return valid JSON. Raw: ${response.content.slice(0, 200)}`);
}

// ── Factory: create adapter from environment ──

export function createAdapterFromEnv(): LlmAdapter {
  const apiKey = process.env['NNZ_LLM_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'NNZ_LLM_API_KEY is not set. Set it in .env or Render environment variables.',
    );
  }

  const config: OpenAiConfig = { apiKey };
  const baseUrl = process.env['NNZ_LLM_BASE_URL'];
  if (baseUrl) config.baseUrl = baseUrl;
  const model = process.env['NNZ_LLM_MODEL'];
  if (model) config.model = model;
  return createOpenAiAdapter(config);
}
