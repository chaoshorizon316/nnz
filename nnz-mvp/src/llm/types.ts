export interface LlmCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LlmCompletionResponse {
  content: string;
  parsed?: unknown;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LlmAdapter {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}
