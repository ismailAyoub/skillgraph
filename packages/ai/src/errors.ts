export type AiErrorCode = 'auth' | 'rate_limit' | 'api' | 'parse' | 'refusal' | 'invalid_patch';

/** Every failure of `@skillgraph/ai` surfaces as an AiError with a stable `code`. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  /** Structured details: zod issues, the offending patch, the raw model output. */
  readonly details?: unknown;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError;
}
