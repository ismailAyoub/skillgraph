import { type CopilotIntent, createAi, type InterviewTurn, isAiError } from '@skillgraph/ai';
import { parseDoc, type SkillDoc } from '@skillgraph/core';

/** The Anthropic SDK needs Node APIs; never run these on the edge runtime. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEATURES = [
  'critique',
  'describe',
  'trigger-queries',
  'copilot',
  'interview',
  'from-transcript',
  'docs-to-references',
  'decompile-fallback',
] as const;

type Feature = (typeof FEATURES)[number];

function isFeature(v: string): v is Feature {
  return (FEATURES as readonly string[]).includes(v);
}

const STATUS: Record<string, number> = {
  auth: 401,
  rate_limit: 429,
  refusal: 422,
  parse: 502,
  invalid_patch: 502,
  api: 502,
  bad_request: 400,
  not_found: 404,
};

function fail(code: string, error: string, status?: number): Response {
  return Response.json({ ok: false, error, code }, { status: status ?? STATUS[code] ?? 500 });
}

/** Body shape per feature; `doc` is always re-parsed with the core schema before use. */
interface Body {
  doc?: unknown;
  compiled?: unknown;
  lints?: unknown;
  count?: unknown;
  nodeId?: unknown;
  intent?: unknown;
  instruction?: unknown;
  transcript?: unknown;
  docs?: unknown;
  hostNodeId?: unknown;
  rawNodeIds?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function run(feature: Feature, doc: SkillDoc, body: Body, key: string, model?: string) {
  const ai = createAi(model ? { apiKey: key, model } : { apiKey: key });
  switch (feature) {
    case 'critique':
      return ai.critique({
        doc,
        compiled: body.compiled as never,
        lints: body.lints as never,
      });
    case 'describe':
      return ai.describe({ doc });
    case 'trigger-queries':
      return ai.triggerQueries({
        doc,
        count: typeof body.count === 'number' ? body.count : undefined,
      });
    case 'copilot': {
      const nodeId = str(body.nodeId);
      if (!nodeId) throw new BadRequest('`nodeId` is required');
      return ai.copilot({
        doc,
        nodeId,
        intent: (str(body.intent) ?? 'custom') as CopilotIntent,
        instruction: str(body.instruction),
      });
    }
    case 'interview': {
      if (!Array.isArray(body.transcript)) throw new BadRequest('`transcript` must be an array');
      return ai.interview({ doc, transcript: body.transcript as InterviewTurn[] });
    }
    case 'from-transcript': {
      const transcript = str(body.transcript);
      if (!transcript) throw new BadRequest('`transcript` must be a string');
      return ai.fromTranscript({ doc, transcript });
    }
    case 'docs-to-references': {
      if (!Array.isArray(body.docs)) throw new BadRequest('`docs` must be an array');
      return ai.docsToReferences({
        doc,
        docs: body.docs as { title: string; url?: string; content: string }[],
        hostNodeId: str(body.hostNodeId),
      });
    }
    case 'decompile-fallback':
      return ai.decompileFallback({
        doc,
        rawNodeIds: Array.isArray(body.rawNodeIds) ? (body.rawNodeIds as string[]) : undefined,
      });
  }
}

class BadRequest extends Error {}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ feature: string }> },
): Promise<Response> {
  const { feature } = await params;
  if (!isFeature(feature)) return fail('not_found', `Unknown AI feature "${feature}"`);

  // The key travels per request and is never logged or persisted.
  const key = req.headers.get('x-anthropic-key')?.trim();
  if (!key) return fail('auth', 'Missing x-anthropic-key header');
  const model = req.headers.get('x-anthropic-model')?.trim() || undefined;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail('bad_request', 'Request body must be JSON');
  }

  let doc: SkillDoc;
  try {
    doc = parseDoc(body.doc);
  } catch (e) {
    return fail('bad_request', `Invalid graph document: ${(e as Error).message}`);
  }

  try {
    const result = await run(feature, doc, body, key, model);
    return Response.json({ ok: true, result });
  } catch (e) {
    if (e instanceof BadRequest) return fail('bad_request', e.message);
    if (isAiError(e)) return fail(e.code, e.message);
    return fail('api', (e as Error).message || 'AI request failed');
  }
}
