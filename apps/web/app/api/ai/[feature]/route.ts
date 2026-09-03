import {
  AI_ERROR_STATUS,
  type AiFeatureBody,
  createAi,
  dispatchAiFeature,
  isAiError,
  isAiFeature,
} from '@skillgraph/ai';
import { claudeAuthProblem, createClaudeCliBackend } from '@skillgraph/ai/claude-cli';
import { localClaudeAuth } from '@/lib/localAi';

/** The Anthropic SDK needs Node APIs; never run these on the edge runtime. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(code: string, error: string, status?: number): Response {
  return Response.json(
    { ok: false, error, code },
    { status: status ?? AI_ERROR_STATUS[code] ?? (code === 'not_found' ? 404 : 500) },
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ feature: string }> },
): Promise<Response> {
  const { feature } = await params;
  if (!isAiFeature(feature)) return fail('not_found', `Unknown AI feature "${feature}"`);

  // The key travels per request and is never logged or persisted. Without a key, a server running
  // on the user's own machine may run `claude -p` with their Claude Code login (see lib/localAi).
  const key = req.headers.get('x-anthropic-key')?.trim();
  let localBin: string | null = null;
  if (!key) {
    let auth = await localClaudeAuth();
    if (!auth)
      return fail(
        'auth',
        'No API key was sent, and this server does not run a local Claude Code CLI. Open "Connect AI".',
      );
    // The cached answer may predate a login the user just did; check again before refusing.
    if (claudeAuthProblem(auth)) auth = (await localClaudeAuth(true)) ?? auth;
    const problem = claudeAuthProblem(auth);
    if (problem) return fail('auth', problem);
    localBin = auth.bin;
  }
  const model = req.headers.get('x-anthropic-model')?.trim() || undefined;

  let body: AiFeatureBody;
  try {
    body = (await req.json()) as AiFeatureBody;
  } catch {
    return fail('bad_request', 'Request body must be JSON');
  }

  try {
    const ai = key
      ? createAi(model ? { apiKey: key, model } : { apiKey: key })
      : createAi({
          backend: createClaudeCliBackend({ bin: localBin as string, ...(model ? { model } : {}) }),
        });
    const result = await dispatchAiFeature(ai, feature, body);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (isAiError(e)) return fail(e.code, e.message);
    return fail('api', (e as Error).message || 'AI request failed');
  }
}
