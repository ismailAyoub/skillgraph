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
import { getBridgeUrl } from './bridge';
import { getAiBackend, getAiModel, getAnthropicKey } from './settings';
import { resolveBackend } from './useSettings';

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

export const NO_KEY_HINT =
  'To use AI, set an Anthropic API key in Settings (gear icon), or run `skillgraph dev` locally to use your Claude Code login through the bridge.';

/** Cached result of the last bridge health probe (kept fresh by useAiSettings). */
let bridgeAiAvailable = false;
export function setBridgeAiAvailable(v: boolean): void {
  bridgeAiAvailable = v;
}

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
  const target = resolveBackend(getAiBackend(), key, bridgeAiAvailable);
  if (!target) throw new AiClientError(NO_KEY_HINT, 'no_key');
  const url = target === 'api' ? `/api/ai/${feature}` : `${getBridgeUrl()}/api/ai/${feature}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-anthropic-model': getAiModel(),
  };
  // The bridge runs `claude -p` with your local login; the key only travels to the hosted route.
  if (target === 'api') headers['x-anthropic-key'] = key;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
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
