export interface LWENRequest {
  model: string;
  messages: Array<{ role: string; content: string | any[]; name?: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
  response_format?: any;
  [key: string]: any;
}

export interface LWENResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: { role: string; content: string | null; tool_calls?: any[] };
    delta?: { role?: string; content?: string | null; tool_calls?: any[] };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ProviderInfo {
  name: string;
  baseURL: string;
  codexBaseURL?: string;
  authType: 'bearer' | 'api-key' | 'x-api-key';
  models: string[];
  supportsStreaming: boolean;
  supportsTools: boolean;
  type: 'text' | 'image';
}
