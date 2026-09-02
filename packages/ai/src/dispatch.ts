import { parseDoc, type SkillDoc } from '@skillgraph/core';
import { AiError } from './errors';
import type { Ai, CopilotIntent, InterviewTurn } from './types';

/** Route/feature names shared by the hosted `/api/ai/*` routes and the local bridge. */
export const AI_FEATURES = [
  'critique',
  'describe',
  'trigger-queries',
  'copilot',
  'interview',
  'from-transcript',
  'docs-to-references',
  'decompile-fallback',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export function isAiFeature(v: string): v is AiFeature {
  return (AI_FEATURES as readonly string[]).includes(v);
}

/** Loose request body; `doc` is always re-validated with the core schema. */
export interface AiFeatureBody {
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

function bad(message: string): AiError {
  return new AiError('bad_request', message);
}

/** Validate `body.doc` and call the `Ai` method that `feature` names. Throws AiError('bad_request'). */
export async function dispatchAiFeature(
  ai: Ai,
  feature: AiFeature,
  body: AiFeatureBody,
): Promise<unknown> {
  let doc: SkillDoc;
  try {
    doc = parseDoc(body.doc);
  } catch (e) {
    throw bad(`Invalid graph document: ${(e as Error).message}`);
  }
  switch (feature) {
    case 'critique':
      return ai.critique({ doc, compiled: body.compiled as never, lints: body.lints as never });
    case 'describe':
      return ai.describe({ doc });
    case 'trigger-queries':
      return ai.triggerQueries({
        doc,
        count: typeof body.count === 'number' ? body.count : undefined,
      });
    case 'copilot': {
      const nodeId = str(body.nodeId);
      if (!nodeId) throw bad('`nodeId` is required');
      return ai.copilot({
        doc,
        nodeId,
        intent: (str(body.intent) ?? 'custom') as CopilotIntent,
        instruction: str(body.instruction),
      });
    }
    case 'interview':
      if (!Array.isArray(body.transcript)) throw bad('`transcript` must be an array');
      return ai.interview({ doc, transcript: body.transcript as InterviewTurn[] });
    case 'from-transcript': {
      const transcript = str(body.transcript);
      if (!transcript) throw bad('`transcript` must be a string');
      return ai.fromTranscript({ doc, transcript });
    }
    case 'docs-to-references':
      if (!Array.isArray(body.docs)) throw bad('`docs` must be an array');
      return ai.docsToReferences({
        doc,
        docs: body.docs as { title: string; url?: string; content: string }[],
        hostNodeId: str(body.hostNodeId),
      });
    case 'decompile-fallback':
      return ai.decompileFallback({
        doc,
        rawNodeIds: Array.isArray(body.rawNodeIds) ? (body.rawNodeIds as string[]) : undefined,
      });
  }
}

/** HTTP status for an AiError code (shared by the hosted routes and the bridge). */
export const AI_ERROR_STATUS: Record<string, number> = {
  auth: 401,
  rate_limit: 429,
  refusal: 422,
  parse: 502,
  invalid_patch: 502,
  api: 502,
  bad_request: 400,
};
