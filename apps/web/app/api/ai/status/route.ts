import { localAiEnabled, localClaudeAuth } from '@/lib/localAi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Can this server run AI with the local Claude Code login? `ai: "claude-cli"` when `next dev` (or
 * SKILLGRAPH_LOCAL_AI=1) runs on the user's machine and `claude` is installed and logged in;
 * `claude` carries the detail (installed? logged in? which account?) so the editor can show the
 * exact next step. Same shape as the bridge's `/api/health`.
 */
export async function GET(): Promise<Response> {
  const claude = await localClaudeAuth();
  return Response.json({
    ok: true,
    local: localAiEnabled(),
    ai: claude?.bin && claude.loggedIn ? 'claude-cli' : null,
    claude,
  });
}
