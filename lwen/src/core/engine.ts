import { loadAuth, refreshAuth } from '../auth/manager.js';
import type { LWENRequest, LWENResponse, ProviderInfo } from '../types.js';

export const PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    name: 'openai', baseURL: 'https://api.openai.com/v1', codexBaseURL: 'https://chatgpt.com/backend-api/codex',
    authType: 'bearer', models: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo','o1-preview','o1-mini'],
    supportsStreaming: true, supportsTools: true, type: 'text',
  },
  anthropic: {
    name: 'anthropic', baseURL: 'https://api.anthropic.com/v1', authType: 'x-api-key',
    models: ['claude-3-5-sonnet-20241022','claude-3-opus-20240229','claude-3-haiku-20240307'],
    supportsStreaming: true, supportsTools: true, type: 'text',
  },
  gemini: {
    name: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', authType: 'api-key',
    models: ['gemini-1.5-pro','gemini-1.5-flash'],
    supportsStreaming: true, supportsTools: true, type: 'text',
  },
  leonardo: {
    name: 'leonardo', baseURL: 'https://cloud.leonardo.ai/api/rest/v1', authType: 'bearer',
    models: ['leonardo-phoenix','leonardo-kino'],
    supportsStreaming: false, supportsTools: false, type: 'image',
  },
  ideogram: {
    name: 'ideogram', baseURL: 'https://api.ideogram.ai', authType: 'api-key',
    models: ['ideogram-v3','ideogram-v2'],
    supportsStreaming: false, supportsTools: false, type: 'image',
  },
  copilot: {
    name: 'copilot', baseURL: 'https://api.githubcopilot.com', authType: 'bearer',
    models: ['copilot-gpt-4','copilot-gpt-4o'],
    supportsStreaming: true, supportsTools: true, type: 'text',
  },
};

export const MODEL_ALIASES: Record<string, string> = {
  'gpt-4o': 'openai:gpt-4o', 'gpt-4o-mini': 'openai:gpt-4o-mini', 'gpt-4': 'openai:gpt-4-turbo', 'gpt-3.5': 'openai:gpt-3.5-turbo',
  'claude': 'anthropic:claude-3-5-sonnet-20241022', 'claude-opus': 'anthropic:claude-3-opus-20240229', 'claude-haiku': 'anthropic:claude-3-haiku-20240307',
  'gemini': 'gemini:gemini-1.5-pro', 'gemini-flash': 'gemini:gemini-1.5-flash',
  'leonardo': 'leonardo:leonardo-phoenix', 'ideogram': 'ideogram:ideogram-v3', 'copilot': 'copilot:copilot-gpt-4o',
};

const CODEX_MODELS = ['gpt-5.4','gpt-5.3-codex','gpt-5.3-codex-mini','gpt-5.2','gpt-5.1','gpt-5.1-codex'];

export function resolveModel(modelId: string): { provider: string; model: string; useCodex?: boolean } | null {
  if (CODEX_MODELS.includes(modelId)) return { provider: 'openai', model: modelId, useCodex: true };
  if (MODEL_ALIASES[modelId]) { const [p,m] = MODEL_ALIASES[modelId].split(':'); return { provider: p, model: m }; }
  if (modelId.includes(':')) { const [p,m] = modelId.split(':'); if (PROVIDERS[p]) return { provider: p, model: m }; }
  for (const [name, info] of Object.entries(PROVIDERS)) { if (info.models.includes(modelId)) return { provider: name, model: modelId }; }
  return null;
}

export function getAuthHeader(provider: string): Record<string, string> {
  const auth = loadAuth(provider); if (!auth) return {};
  const info = PROVIDERS[provider];
  if (info.authType === 'x-api-key') return { 'x-api-key': auth.access_token };
  if (info.authType === 'api-key') return { 'Api-Key': auth.access_token };
  return { 'Authorization': `${auth.token_type || 'Bearer'} ${auth.access_token}` };
}

export async function proxyChat(request: LWENRequest): Promise<LWENResponse> {
  const r = resolveModel(request.model);
  if (!r) throw new Error(`Unknown model: ${request.model}`);
  const { provider, model, useCodex } = r;
  const info = PROVIDERS[provider];
  const auth = loadAuth(provider);
  if (!auth && info.requiresAuth !== false) throw new Error(`No auth for ${provider}. Run: npx lwen login ${provider} --token <key> or npx @openai/codex login`);

  if (provider === 'openai' && useCodex) return codexChat(request, model, auth);
  if (provider === 'anthropic') return anthropicChat(request, model);
  if (provider === 'gemini') return geminiChat(request, model);
  if (provider === 'leonardo') return leonardoChat(request, model);
  if (provider === 'ideogram') return ideogramChat(request, model);

  const res = await fetch(`${info.baseURL}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader(provider) },
    body: JSON.stringify({ model, messages: request.messages, temperature: request.temperature, max_tokens: request.max_tokens, top_p: request.top_p, stream: false, tools: request.tools, tool_choice: request.tool_choice, response_format: request.response_format }),
  });
  if (!res.ok) throw new Error(`${provider} error ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function* proxyStream(request: LWENRequest): AsyncGenerator<string> {
  const r = resolveModel(request.model); if (!r) throw new Error(`Unknown model: ${request.model}`);
  const { provider, model, useCodex } = r;
  const info = PROVIDERS[provider];

  if (info.type === 'image') { const res = await proxyChat(request); yield `data: ${JSON.stringify({ choices: [{ delta: { content: res.choices[0]?.message?.content } }] })}\n\n`; yield 'data: [DONE]\n\n'; return; }
  if (provider === 'openai' && useCodex) { yield* codexStream(request, model); return; }

  const body = { model, messages: request.messages, temperature: request.temperature, max_tokens: request.max_tokens, top_p: request.top_p, stream: true, tools: request.tools };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (provider === 'anthropic') { headers['x-api-key'] = loadAuth('anthropic')?.access_token || ''; headers['anthropic-version'] = '2023-06-01'; }
  else Object.assign(headers, getAuthHeader(provider));

  const url = provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : `${info.baseURL}/chat/completions`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) { yield `data: ${JSON.stringify({ error: `Stream error: ${res.status}` })}\n\n`; return; }

  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try { while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines) { if (line.startsWith('data: ')) { yield line + '\n\n'; if (line.slice(6) === '[DONE]') return; } } } }
  finally { reader.releaseLock(); }
}

// ─── Codex Free Access ───
async function codexChat(req: LWENRequest, model: string, auth: any): Promise<LWENResponse> {
  if (!auth) throw new Error('No Codex auth. Run: npx @openai/codex login');
  const body = { model, instructions: req.messages.find((m) => m.role === 'system')?.content || 'You are a helpful assistant.', input: req.messages.filter((m) => m.role !== 'system').map((m) => ({ type: 'message', role: m.role, content: typeof m.content === 'string' ? [{ type: 'input_text', text: m.content }] : m.content })), tools: req.tools || [], tool_choice: req.tool_choice || 'auto', stream: false, store: false };
  const res = await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers: { 'Authorization': `${auth.token_type || 'Bearer'} ${auth.access_token}`, 'Content-Type': 'application/json', 'OpenAI-Organization': 'user', 'Codex-Version': '0.111.0' }, body: JSON.stringify(body) });
  if (!res.ok) { if (res.status === 401) { const refreshed = await refreshAuth('openai'); if (refreshed) return codexChat(req, model, refreshed); } throw new Error(`Codex error ${res.status}: ${await res.text()}`); }
  const data = await res.json();
  const text = data.output?.filter((o: any) => o.type === 'message').map((o: any) => o.content?.filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('')).join('') ?? '';
  return { id: data.id || `codex-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text || null }, finish_reason: 'stop' }], usage: { prompt_tokens: data.usage?.input_tokens ?? 0, completion_tokens: data.usage?.output_tokens ?? 0, total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) } };
}

async function* codexStream(req: LWENRequest, model: string): AsyncGenerator<string> {
  const auth = loadAuth('openai'); if (!auth) { yield `data: ${JSON.stringify({ error: 'No Codex auth. Run: npx @openai/codex login' })}\n\n`; return; }
  const body = { model, instructions: req.messages.find((m) => m.role === 'system')?.content || 'You are a helpful assistant.', input: req.messages.filter((m) => m.role !== 'system').map((m) => ({ type: 'message', role: m.role, content: typeof m.content === 'string' ? [{ type: 'input_text', text: m.content }] : m.content })), stream: true, store: false };
  const res = await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers: { 'Authorization': `${auth.token_type || 'Bearer'} ${auth.access_token}`, 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'OpenAI-Organization': 'user', 'Codex-Version': '0.111.0' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) { yield `data: ${JSON.stringify({ error: `Codex stream error: ${res.status}` })}\n\n`; return; }
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try { while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines) { if (line.startsWith('data: ')) { const data = line.slice(6); if (data === '[DONE]') { yield 'data: [DONE]\n\n'; return; } try { const parsed = JSON.parse(data); const text = parsed.output?.[0]?.content?.[0]?.text ?? ''; if (text) yield `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`; } catch { yield line + '\n\n'; } } } } }
  finally { reader.releaseLock(); }
  yield 'data: [DONE]\n\n';
}

// ─── Provider handlers ───
async function anthropicChat(req: LWENRequest, model: string): Promise<LWENResponse> {
  const auth = loadAuth('anthropic'); const systemMsg = req.messages.find((m) => m.role === 'system');
  const body = { model, max_tokens: req.max_tokens ?? 4096, messages: req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })), system: typeof systemMsg?.content === 'string' ? systemMsg.content : undefined, temperature: req.temperature, top_p: req.top_p };
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': auth?.access_token || '', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json(); const text = data.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') ?? '';
  return { id: data.id || `anthropic-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text || null }, finish_reason: 'stop' }], usage: { prompt_tokens: data.usage?.input_tokens ?? 0, completion_tokens: data.usage?.output_tokens ?? 0, total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) } };
}

async function geminiChat(req: LWENRequest, model: string): Promise<LWENResponse> {
  const auth = loadAuth('gemini'); const key = auth?.access_token || '';
  const body = { contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] })), generationConfig: { temperature: req.temperature, maxOutputTokens: req.max_tokens, topP: req.top_p } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json(); const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  return { id: `gemini-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0, completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0, total_tokens: data.usageMetadata?.totalTokenCount ?? 0 } };
}

async function leonardoChat(req: LWENRequest, model: string): Promise<LWENResponse> {
  const auth = loadAuth('leonardo'); const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const body = { prompt: typeof lastUser?.content === 'string' ? lastUser.content : 'A beautiful image', modelId: model === 'leonardo-phoenix' ? '6b645e3a-d64f-4341-a6d8-7a3690fbf042' : model, width: 1024, height: 1024, num_images: 1 };
  const res = await fetch('https://cloud.leonardo.ai/api/rest/v1/generations', { method: 'POST', headers: { 'Authorization': `Bearer ${auth?.access_token || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Leonardo error ${res.status}: ${await res.text()}`);
  const data = await res.json(); const genId = data.sdGenerationJob?.generationId; const url = genId ? `https://cdn.leonardo.ai/users/default/generations/${genId}/Default_${genId}.jpg` : '';
  return { id: `leonardo-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: url ? `![Generated](${url})` : 'Failed' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

async function ideogramChat(req: LWENRequest, model: string): Promise<LWENResponse> {
  const auth = loadAuth('ideogram'); const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const body = { image_request: { prompt: typeof lastUser?.content === 'string' ? lastUser.content : 'A stunning image', model: model === 'ideogram-v3' ? 'V_3' : 'V_2', aspect_ratio: 'ASPECT_1_1', magic_prompt_option: 'AUTO' } };
  const res = await fetch('https://api.ideogram.ai/generate', { method: 'POST', headers: { 'Api-Key': auth?.access_token || '', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ideogram error ${res.status}: ${await res.text()}`);
  const data = await res.json(); const url = data.data?.[0]?.url ?? '';
  return { id: `ideogram-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: url ? `![Generated](${url})` : 'Failed' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}
