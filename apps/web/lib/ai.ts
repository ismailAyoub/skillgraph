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
import { type SubscriptionStep, subscriptionHint } from './claudeStatus';
import { getAiBackend, getAiModel, getAnthropicKey, notifySettingsChange } from './settings';
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

/** Cached result of the last availability probes (kept fresh by useAiSettings). */
let available: { bridge: boolean; local: boolean; step: SubscriptionStep } = {
  bridge: false,
  local: false,
  step: 'relay',
};
export function setAiAvailability(v: typeof available): void {
  available = v;
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
  const target = resolveBackend(getAiBackend(), key, available.bridge, available.local);
  if (!target) throw new AiClientError(subscriptionHint(available.step), 'no_key');
  const url = target === 'bridge' ? `${getBridgeUrl()}/api/ai/${feature}` : `/api/ai/${feature}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-anthropic-model': getAiModel(),
  };
  // `local` and `bridge` run `claude -p` with your login; the key only travels with `api`.
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
    const why = (e as Error).message || 'Network error';
    throw new AiClientError(
      target === 'bridge'
        ? `Could not reach the local bridge at ${getBridgeUrl()} (${why}). Is \`skillgraph dev\` (or the service) still running?`
        : why,
      'network',
    );
  }
  let body: { ok: boolean; result?: unknown; error?: string; code?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new AiClientError(`Bad response from server (HTTP ${res.status})`, 'api', res.status);
  }
  if (!res.ok || !body.ok) {
    const code = (body.code ?? 'api') as AiClientCode;
    // A login that expired since the last probe: re-probe now so the header and dialog catch up.
    if (code === 'auth') notifySettingsChange();
    throw new AiClientError(body.error ?? `HTTP ${res.status}`, code, res.status);
  }
  return body.result as AiFeatures[F]['output'];
}
