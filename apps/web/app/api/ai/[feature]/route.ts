import {
  AI_ERROR_STATUS,
  type AiFeatureBody,
  createAi,
  dispatchAiFeature,
  isAiError,
  isAiFeature,
} from '@skillgraph/ai';

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

  // The key travels per request and is never logged or persisted.
  const key = req.headers.get('x-anthropic-key')?.trim();
  if (!key) return fail('auth', 'Missing x-anthropic-key header');
  const model = req.headers.get('x-anthropic-model')?.trim() || undefined;

  let body: AiFeatureBody;
  try {
    body = (await req.json()) as AiFeatureBody;
  } catch {
    return fail('bad_request', 'Request body must be JSON');
  }

  try {
    const ai = createAi(model ? { apiKey: key, model } : { apiKey: key });
    const result = await dispatchAiFeature(ai, feature, body);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (isAiError(e)) return fail(e.code, e.message);
    return fail('api', (e as Error).message || 'AI request failed');
  }
}
