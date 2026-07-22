# LWEN — Local Web Engine Nexus

> Better than `openai-oauth`: same free Codex access + 5 more providers.

## Quick Start

```bash
# 1. Free OpenAI (same as EvanZhouDev)
npx @openai/codex login
npx lwen-ai-proxy

# 2. Add other providers
npx lwen login anthropic --token sk-ant-your-key
npx lwen login gemini --token your-gemini-key
npx lwen login leonardo --token your-leonardo-key
npx lwen login ideogram --token your-ideogram-key
npx lwen login copilot --token your-copilot-token

# 3. Check status
npx lwen status
```

## Usage

```bash
# Free Codex
curl http://localhost:10532/v1/chat/completions -d '{"model":"gpt-5.4","messages":[{"role":"user","content":"Hello"}]}'

# Claude
curl http://localhost:10532/v1/chat/completions -d '{"model":"claude","messages":[{"role":"user","content":"Hello"}]}'

# Image
curl http://localhost:10532/v1/chat/completions -d '{"model":"leonardo","messages":[{"role":"user","content":"A city"}]}'
```

## Commands

| Command | Description |
|---------|-------------|
| `npx lwen` | Start server |
| `npx lwen login <provider> --token <key>` | Save auth |
| `npx lwen refresh openai` | Refresh OAuth |
| `npx lwen status` | Check providers |
| `npx lwen models` | List models |
| `npx lwen discover` | Discover Codex models |

## Providers

- **OpenAI** — Free via Codex OAuth, or API key
- **Anthropic** — Claude 3.5 Sonnet, Opus, Haiku
- **Gemini** — 1.5 Pro, 1.5 Flash
- **Leonardo** — Phoenix, Kino (images)
- **Ideogram** — V3, V2 (text-aware images)
- **Copilot** — GPT-4, GPT-4o

## License

Personal use only. See LICENSE.
