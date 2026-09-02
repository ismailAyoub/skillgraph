'use client';

import type {
  CopilotIntent,
  CritiqueResult,
  DescribeResult,
  InterviewStep,
  InterviewTurn,
  Proposal,
  TriggerQuery,
} from '@skillgraph/ai';
import type { CompileResult, Diagnostic, SkillDoc } from '@skillgraph/core';
import { getAiModel, getAnthropicKey } from './settings';

/** Route features; each maps 1:1 to an `Ai` method (see BUILD_CONTRACT "Web route contract"). */
export interface AiFeatures {
  critique: {
    input: { doc: SkillDoc; compiled?: CompileResult; lints?: Diagnostic[] };
    output: CritiqueResult;
  };
  describe: { input: { doc: SkillDoc }; output: DescribeResult };
  'trigger-queries': { input: { doc: SkillDoc; count?: number }; output: TriggerQuery[] };
  copilot: {
    input: { doc: SkillDoc; nodeId: string; intent: CopilotIntent; instruction?: string };
    output: Proposal;
  };
  interview: { input: { doc: SkillDoc; transcript: InterviewTurn[] }; output: InterviewStep };
  'from-transcript': { input: { doc: SkillDoc; transcript: string }; output: Proposal };
  'docs-to-references': {
    input: {
      doc: SkillDoc;
      docs: { title: string; url?: string; content: string }[];
      hostNodeId?: string;
    };
    output: Proposal;
  };
  'decompile-fallback': { input: { doc: SkillDoc; rawNodeIds?: string[] }; output: Proposal };
}

export type AiFeature = keyof AiFeatures;

export type AiClientCode =
  | 'no_key'
  | 'auth'
  | 'rate_limit'
  | 'refusal'
  | 'invalid_patch'
  | 'parse'
  | 'api'
  | 'bad_request'
  | 'network';

export class AiClientError extends Error {
  code: AiClientCode;
  status?: number;
  constructor(message: string, code: AiClientCode, status?: number) {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
    this.status = status;
  }
}

export const NO_KEY_HINT = 'Set your API key in Settings (gear icon in the header) to use AI.';

/**
 * Call an AI route. The key and model come from this browser's settings and travel as request
 * headers only; the server never stores them.
 */
export async function callAi<F extends AiFeature>(
  feature: F,
  input: AiFeatures[F]['input'],
  signal?: AbortSignal,
): Promise<AiFeatures[F]['output']> {
  const key = getAnthropicKey();
  if (!key) throw new AiClientError(NO_KEY_HINT, 'no_key');
  let res: Response;
  try {
    res = await fetch(`/api/ai/${feature}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-anthropic-key': key,
        'x-anthropic-model': getAiModel(),
      },
      body: JSON.stringify(input),
      signal,
    });
  } catch (e) {
    throw new AiClientError((e as Error).message || 'Network error', 'network');
  }
  let body: { ok: boolean; result?: unknown; error?: string; code?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new AiClientError(`Bad response from server (HTTP ${res.status})`, 'api', res.status);
  }
  if (!res.ok || !body.ok) {
    const code = (body.code ?? 'api') as AiClientCode;
    throw new AiClientError(body.error ?? `HTTP ${res.status}`, code, res.status);
  }
  return body.result as AiFeatures[F]['output'];
}
