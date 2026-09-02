import { type CallContext, createClient } from './client';
import { alignTrace } from './features/alignTrace';
import { copilot } from './features/copilot';
import { critique } from './features/critique';
import { decompileFallback } from './features/decompileFallback';
import { describe, triggerQueries } from './features/describe';
import { docsToReferences } from './features/docsToReferences';
import { fromTranscript } from './features/fromTranscript';
import { grade } from './features/grade';
import { improveDescription } from './features/improveDescription';
import { interview } from './features/interview';
import type { Ai, AiOptions } from './types';

export { DEFAULT_MAX_TOKENS } from './client';
export { AiError, type AiErrorCode, isAiError } from './errors';
export { AUTHORING_GUIDE, describeGraphForPrompt, NODE_VOCABULARY } from './prompt';
export * from './types';
export { normalizeAiPatch, validateProposal } from './validate';

/**
 * Build an `Ai` over the Anthropic API. Every method returns a typed result; patch-bearing
 * results are validated proposals (see `validateProposal`), never applied for you.
 */
export function createAi(opts: AiOptions = {}): Ai {
  const ctx: CallContext = createClient(opts);
  return {
    critique: (input) => critique(ctx, input),
    describe: (input) => describe(ctx, input),
    triggerQueries: (input) => triggerQueries(ctx, input),
    copilot: (input) => copilot(ctx, input),
    interview: (input) => interview(ctx, input),
    fromTranscript: (input) => fromTranscript(ctx, input),
    docsToReferences: (input) => docsToReferences(ctx, input),
    decompileFallback: (input) => decompileFallback(ctx, input),
    improveDescription: (input) => improveDescription(ctx, input),
    grade: (input) => grade(ctx, input),
    alignTrace: (input) => alignTrace(ctx, input),
  };
}
