import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AuthFile {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
}

const AUTH_PATHS: Record<string, string[]> = {
  openai: [
    path.join(os.homedir(), '.codex', 'auth.json'),
    path.join(os.homedir(), '.chatgpt-local', 'auth.json'),
    path.join(os.homedir(), '.openai', 'auth.json'),
  ],
  anthropic: [
    path.join(os.homedir(), '.anthropic', 'auth.json'),
    path.join(os.homedir(), '.claude', 'auth.json'),
  ],
  gemini: [
    path.join(os.homedir(), '.gemini', 'auth.json'),
    path.join(os.homedir(), '.google', 'auth.json'),
  ],
  leonardo: [path.join(os.homedir(), '.leonardo', 'auth.json')],
  ideogram: [path.join(os.homedir(), '.ideogram', 'auth.json')],
  copilot: [
    path.join(os.homedir(), '.github', 'copilot.token'),
    path.join(os.homedir(), '.copilot', 'auth.json'),
  ],
};

const ENV_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  leonardo: ['LEONARDO_API_KEY'],
  ideogram: ['IDEOGRAM_API_KEY'],
  copilot: ['COPILOT_API_KEY'],
};

export function loadAuth(provider: string): AuthFile | null {
  for (const p of (AUTH_PATHS[provider] || [])) {
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return {
          access_token: data.access_token || data.token || data.key || '',
          refresh_token: data.refresh_token,
          expires_at: data.expires_at ? new Date(data.expires_at).getTime() : undefined,
          token_type: data.token_type || 'Bearer',
        };
      } catch { continue; }
    }
  }
  for (const env of (ENV_KEYS[provider] || [])) {
    const val = process.env[env];
    if (val) return { access_token: val, token_type: provider === 'gemini' || provider === 'ideogram' ? 'Api-Key' : 'Bearer' };
  }
  return null;
}

export async function refreshAuth(provider: string): Promise<AuthFile | null> {
  const auth = loadAuth(provider);
  if (!auth?.refresh_token) return null;
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      }),
    });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    const data = await res.json();
    const newAuth: AuthFile = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || auth.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
      token_type: data.token_type || 'Bearer',
    };
    saveAuth(provider, newAuth);
    return newAuth;
  } catch { return null; }
}

export function saveAuth(provider: string, auth: AuthFile): void {
  const dir = path.join(os.homedir(), `.${provider}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function hasAuth(provider: string): boolean { return loadAuth(provider) !== null; }
export function listAuthedProviders(): string[] { return Object.keys(AUTH_PATHS).filter(hasAuth); }
