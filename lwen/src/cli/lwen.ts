#!/usr/bin/env node
import { Command } from 'commander';
import express from 'express';
import cors from 'cors';
import { proxyChat, proxyStream, PROVIDERS, MODEL_ALIASES } from '../core/engine.js';
import { saveAuth, refreshAuth, listAuthedProviders, loadAuth } from '../auth/manager.js';
import type { LWENRequest } from '../types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const program = new Command();
program.name('lwen').description('LWEN — Local Web Engine Nexus').version('1.0.0');

program.command('login <provider>').description('Save API key/token').option('-t, --token <token>', 'Token').action((provider: string, options: { token?: string }) => {
  if (!PROVIDERS[provider]) { console.error(`Unknown: ${provider}`); console.log(`Available: ${Object.keys(PROVIDERS).join(', ')}`); process.exit(1); }
  if (!options.token) { console.log(`\n🔑 LWEN Login: ${provider}\nSave token to ~/.${provider}/auth.json\nFormat: { "access_token": "your-key" }`); process.exit(0); }
  saveAuth(provider, { access_token: options.token, token_type: 'Bearer' }); console.log(`✅ Saved ${provider}`);
});

program.command('refresh <provider>').description('Refresh OAuth token').action(async (provider: string) => {
  if (provider === 'openai') { const r = await refreshAuth(provider); if (r) { console.log(`✅ Refreshed`); console.log(`   Expires: ${new Date(r.expires_at || 0).toLocaleString()}`); } else { console.error(`❌ Failed`); process.exit(1); } }
  else { console.log(`Auto-refresh only for OpenAI Codex. Run: lwen login ${provider} --token <new>`); }
});

program.command('status').description('Check auth status').action(() => {
  const authed = listAuthedProviders();
  console.log('\n📊 LWEN Status'); console.log('═══════════════════════════════════════');
  for (const [name, info] of Object.entries(PROVIDERS)) {
    const ok = authed.includes(name); const auth = loadAuth(name); const exp = auth?.expires_at ? ` (exp ${new Date(auth.expires_at).toLocaleDateString()})` : '';
    console.log(`${ok ? '✅' : '❌'} ${name.padEnd(12)} ${info.models.slice(0,2).join(', ')}${exp}`);
  }
  console.log('\n💡 Free OpenAI: npx @openai/codex login'); console.log('💡 API keys: npx lwen login <provider> --token <key>');
});

program.command('models').description('List models').action(() => {
  console.log('\n📋 Models'); console.log('═══════════════════════════════════════');
  console.log('\n🆓 Free Codex (ChatGPT OAuth):'); console.log('   gpt-5.4, gpt-5.3-codex, gpt-5.3-codex-mini, gpt-5.2, gpt-5.1, gpt-5.1-codex');
  console.log('\n🔑 API Key Providers:');
  for (const [alias, full] of Object.entries(MODEL_ALIASES)) console.log(`   ${alias.padEnd(18)} → ${full}`);
});

program.command('discover').description('Discover Codex models').action(async () => {
  const auth = loadAuth('openai'); if (!auth) { console.error('❌ No auth. Run: npx @openai/codex login'); process.exit(1); }
  try { const res = await fetch('https://chatgpt.com/backend-api/codex/models', { headers: { 'Authorization': `${auth.token_type || 'Bearer'} ${auth.access_token}`, 'Codex-Version': '0.111.0' } }); if (!res.ok) throw new Error(`${res.status}`); const data = await res.json(); console.log('\n🔍 Codex Models:'); for (const m of data.models || []) console.log(`   ${m.id}`); } catch (err) { console.error('❌ Failed:', (err as Error).message); }
});

program.command('start', { isDefault: true }).description('Start server').option('-p, --port <number>', 'Port', '10532').option('-h, --host <string>', 'Host', '127.0.0.1').option('--codex-only', 'Only Codex').action(async (options: { port: string; host: string; codexOnly?: boolean }) => {
  const app = express(); app.use(cors()); app.use(express.json({ limit: '50mb' }));
  const port = parseInt(options.port, 10); const host = options.host;

  app.get('/health', (_req, res) => { const authed = listAuthedProviders(); res.json({ status: authed.length > 0 ? 'ready' : 'no-auth', providers: authed, version: '1.0.0' }); });

  app.get('/v1/models', (_req, res) => {
    const models: any[] = [];
    if (!options.codexOnly) { for (const [name, info] of Object.entries(PROVIDERS)) { for (const m of info.models) models.push({ id: `${name}:${m}`, object: 'model', created: 1700000000, owned_by: name }); } for (const alias of Object.keys(MODEL_ALIASES)) models.push({ id: alias, object: 'model', created: 1700000000, owned_by: 'lwen' }); }
    for (const m of ['gpt-5.4','gpt-5.3-codex','gpt-5.3-codex-mini','gpt-5.2','gpt-5.1','gpt-5.1-codex']) { if (!models.find((x) => x.id === m)) models.push({ id: m, object: 'model', created: 1700000000, owned_by: 'openai' }); }
    res.json({ object: 'list', data: models });
  });

  app.post('/v1/chat/completions', async (req, res) => {
    try { const body = req.body as LWENRequest; if (!body.model || !body.messages) { res.status(400).json({ error: { message: 'Missing model or messages' } }); return; }
      if (body.stream) { res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); try { for await (const chunk of proxyStream(body)) { res.write(chunk); if (chunk.includes('[DONE]')) break; } res.end(); } catch (err) { res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } }
      else { const response = await proxyChat(body); res.json(response); }
    } catch (error) { res.status(500).json({ error: { message: (error as Error).message } }); }
  });

  app.post('/v1/responses', async (req, res) => {
    try { const body = req.body; const auth = loadAuth('openai'); if (!auth) { res.status(401).json({ error: { message: 'No Codex auth' } }); return; }
      const r = await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers: { 'Authorization': `${auth.token_type || 'Bearer'} ${auth.access_token}`, 'Content-Type': 'application/json', 'Codex-Version': '0.111.0' }, body: JSON.stringify(body) });
      if (!r.ok) { res.status(r.status).json({ error: { message: await r.text() } }); return; }
      res.json(await r.json());
    } catch (error) { res.status(500).json({ error: { message: (error as Error).message } }); }
  });

  const server = app.listen(port, host, () => {
    const authed = listAuthedProviders(); const hasCodex = fs.existsSync(path.join(os.homedir(), '.codex', 'auth.json'));
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║   🔥 LWEN — Local Web Engine Nexus v1.0.0                    ║
║                                                              ║
║   🚀 http://${host}:${port}                                    ║
║   💬 POST /v1/chat/completions                               ║
║   📝 POST /v1/responses                                      ║
╚══════════════════════════════════════════════════════════════╝
🆓 Codex: ${hasCodex ? '✅ ~/.codex/auth.json' : '❌ npx @openai/codex login'}
🔑 API:    ${authed.length > 0 ? authed.join(', ') : 'NONE'}
${!hasCodex && authed.length === 0 ? '\n⚠️ No auth. Run commands above.' : '\n✅ Ready!'}
`);
  });

  const shutdown = () => { console.log('\n👋 Shutting down...'); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
});

program.parse();
