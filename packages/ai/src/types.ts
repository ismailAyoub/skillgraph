import type Anthropic from '@anthropic-ai/sdk';
import type { CompileResult, Diagnostic, GraphPatchT, SkillDoc } from '@skillgraph/core';
import type { z } from 'zod';

export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Where structured calls go. The default backend is the Anthropic Messages API; `createClaudeCliBackend`
 * (from `@skillgraph/ai/claude-cli`, Node only) drives the local `claude -p` instead, so a Claude
 * subscription login works without an API key.
 */
export interface StructuredBackend {
  /** Human-readable name, e.g. `api` or `claude-cli`; surfaced in errors and logs. */
  readonly name: string;
  call<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T>;
}

export interface AiOptions {
  /** Custom backend; when set, `apiKey`, `baseURL` and `client` are ignored. */
  backend?: StructuredBackend;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  /** Injectable client (tests pass a fake whose `messages.parse` returns fixtures). */
  client?: Anthropic;
  maxTokens?: number;
}

export type CopilotIntent =
  | 'rewrite-imperative'
  | 'add-why'
  | 'split-steps'
  | 'draft-reference'
  | 'draft-script'
  | 'tighten'
  | 'custom';

/**
 * A validated GraphPatch proposal: `GraphPatch.parse` succeeded, `applyPatch(doc)` dry-ran
 * without error and every added node carries `provenance: 'ai'`.
 */
export interface Proposal {
  patch: GraphPatchT;
  rationale: string;
}

export interface CritiqueFinding {
  severity: 'error' | 'warning' | 'info';
  /** `ai/<slug>` */
  rule: string;
  message: string;
  nodeId?: string;
  patch?: GraphPatchT;
}

export interface CritiqueResult {
  findings: CritiqueFinding[];
  summary: string;
}

/** skill-creator shape, snake_case on purpose. */
export interface TriggerQuery {
  query: string;
  should_trigger: boolean;
}

export interface DescribeResult {
  candidates: { description: string; rationale: string }[];
  triggerQueries: TriggerQuery[];
}

export interface TriggerEvalResult {
  query: string;
  should_trigger: boolean;
  triggered: boolean;
  pass: boolean;
  runs?: boolean[];
}

export interface InterviewTurn {
  role: 'assistant' | 'user';
  content: string;
}

export interface InterviewStep {
  question?: string;
  patch?: GraphPatchT;
  rationale?: string;
  confidence: number;
  done: boolean;
}

export interface Grading {
  expectations: { text: string; passed: boolean; evidence: string }[];
  summary: { passed: number; failed: number; total: number; pass_rate: number };
}

export interface TraceEvent {
  turn: number;
  type: 'tool_use' | 'text';
  tool?: string;
  input?: unknown;
  text?: string;
}

export interface TraceVisit {
  nodeId: string;
  turn: number;
  evidence: string;
  confidence: number;
}

export interface Ai {
  critique(input: {
    doc: SkillDoc;
    compiled?: CompileResult;
    lints?: Diagnostic[];
  }): Promise<CritiqueResult>;
  describe(input: { doc: SkillDoc }): Promise<DescribeResult>;
  triggerQueries(input: { doc: SkillDoc; count?: number }): Promise<TriggerQuery[]>;
  copilot(input: {
    doc: SkillDoc;
    nodeId: string;
    intent: CopilotIntent;
    instruction?: string;
  }): Promise<Proposal>;
  interview(input: { doc: SkillDoc; transcript: InterviewTurn[] }): Promise<InterviewStep>;
  fromTranscript(input: { doc: SkillDoc; transcript: string }): Promise<Proposal>;
  docsToReferences(input: {
    doc: SkillDoc;
    docs: { title: string; url?: string; content: string }[];
    hostNodeId?: string;
  }): Promise<Proposal>;
  decompileFallback(input: { doc: SkillDoc; rawNodeIds?: string[] }): Promise<Proposal>;
  improveDescription(input: {
    doc: SkillDoc;
    results: TriggerEvalResult[];
    history?: { description: string; passRate: number }[];
  }): Promise<{ description: string; reasoning: string }>;
  grade(input: {
    prompt: string;
    expectations: string[];
    transcript: string;
    outputs: Record<string, string>;
  }): Promise<Grading>;
  alignTrace(input: { doc: SkillDoc; events: TraceEvent[] }): Promise<{ visits: TraceVisit[] }>;
}
