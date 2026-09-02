import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { AiError } from './errors';
import { type AiOptions, DEFAULT_MODEL } from './types';

export const DEFAULT_MAX_TOKENS = 16000;

export interface CallContext {
  client: Anthropic;
  model: string;
  maxTokens: number;
}

/** Build the call context. `apiKey` is optional: the SDK falls back to ANTHROPIC_API_KEY. */
export function createClient(opts: AiOptions = {}): CallContext {
  const client =
    opts.client ??
    new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  return {
    client,
    model: opts.model ?? DEFAULT_MODEL,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

export function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('auth', 'Anthropic API key missing or invalid', {
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('rate_limit', 'Anthropic rate limit reached; retry later', {
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(
      'api',
      `Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}`,
      {
        status: typeof err.status === 'number' ? err.status : undefined,
        cause: err,
      },
    );
  }
  return new AiError('api', err instanceof Error ? err.message : String(err), { cause: err });
}

/**
 * One structured call: system prompt + a single user turn, parsed against `schema`.
 * Refusals, truncation and unparseable output surface as AiError.
 */
export async function callStructured<T>(
  ctx: CallContext,
  schema: z.ZodType<T>,
  system: string,
  userContent: string,
): Promise<T> {
  let response: Awaited<ReturnType<Anthropic['messages']['parse']>>;
  try {
    response = await ctx.client.messages.parse({
      model: ctx.model,
      max_tokens: ctx.maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
      output_config: { format: zodOutputFormat(schema) },
    });
  } catch (err) {
    throw mapError(err);
  }
  if (response.stop_reason === 'refusal') {
    const details = (
      response as { stop_details?: { category?: string | null; explanation?: string } }
    ).stop_details;
    throw new AiError(
      'refusal',
      `The model declined this request${details?.category ? ` (${details.category})` : ''}${
        details?.explanation ? `: ${details.explanation}` : ''
      }`,
      { details },
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiError('parse', `Output truncated at ${ctx.maxTokens} tokens; raise maxTokens`, {
      details: response,
    });
  }
  const parsed = (response as { parsed_output?: unknown }).parsed_output;
  if (parsed === null || parsed === undefined) {
    throw new AiError('parse', 'The model output did not match the expected schema', {
      details: response.content,
    });
  }
  return parsed as T;
}
