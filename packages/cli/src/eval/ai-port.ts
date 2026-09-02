import {
  type AiOptions,
  createAi,
  type Grading,
  type TraceEvent,
  type TraceVisit,
  type TriggerEvalResult,
  type TriggerQuery,
} from '@skillgraph/ai';
import type { SkillDoc } from '@skillgraph/core';

/**
 * The only surface through which the eval modules talk to a model. Everything else in
 * `packages/cli/src/eval` is deterministic and testable with a fake implementation.
 */
export interface AiPort {
  grade(input: {
    prompt: string;
    expectations: string[];
    transcript: string;
    outputs: Record<string, string>;
  }): Promise<Grading>;
  improveDescription(input: {
    doc: SkillDoc;
    results: TriggerEvalResult[];
    history?: { description: string; passRate: number }[];
  }): Promise<{ description: string; reasoning: string }>;
  triggerQueries(input: { doc: SkillDoc; count?: number }): Promise<TriggerQuery[]>;
  alignTrace(input: { doc: SkillDoc; events: TraceEvent[] }): Promise<{ visits: TraceVisit[] }>;
}

/** Real port backed by `@skillgraph/ai` (needs ANTHROPIC_API_KEY or `opts.apiKey`). */
export function createAiPort(opts: AiOptions = {}): AiPort {
  const ai = createAi(opts);
  return {
    grade: (input) => ai.grade(input),
    improveDescription: (input) => ai.improveDescription(input),
    triggerQueries: (input) => ai.triggerQueries(input),
    alignTrace: (input) => ai.alignTrace(input),
  };
}
