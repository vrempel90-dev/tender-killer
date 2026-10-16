export interface TokenUsage { inputTokens: number; outputTokens: number }

export interface StructuredCallParams {
  system: string;
  userContent: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface StructuredCallResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  provider: 'ollama' | 'anthropic';
  modelDigest?: string;
}

export interface AIProvider {
  readonly name: 'ollama' | 'anthropic';
  readonly model: string;
  generate<T>(params: StructuredCallParams, signal: AbortSignal): Promise<StructuredCallResult<T>>;
}
