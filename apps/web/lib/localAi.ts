/**
 * Local AI: when this Next.js server runs on the user's own machine (`next dev`, or
 * `SKILLGRAPH_LOCAL_AI=1` for a local `next start`), `/api/ai/*` can run the Claude Code CLI with
 * the user's login. No key and no separate bridge. Never on Vercel or any hosted deployment: the
 * server there cannot see the user's login, and must not run a CLI on the user's behalf.
 */
import { type ClaudeAuth, claudeAuthStatus } from '@skillgraph/ai/claude-cli';

export function localAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SKILLGRAPH_LOCAL_AI ?? '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'on') return true;
  return env.NODE_ENV !== 'production' && !env.VERCEL;
}

let cached: { at: number; auth: ClaudeAuth } | undefined;

/**
 * Is the `claude` CLI installed and logged in? Null when local AI is off. Cached for 30 s;
 * `fresh` re-checks, for the moment right after the user logs in.
 */
export async function localClaudeAuth(fresh = false): Promise<ClaudeAuth | null> {
  if (!localAiEnabled()) return null;
  const now = Date.now();
  if (fresh || !cached || now - cached.at > 30_000)
    cached = { at: now, auth: await claudeAuthStatus() };
  return cached.auth;
}
