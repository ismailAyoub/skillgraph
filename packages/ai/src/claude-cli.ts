/**
 * `claude -p` backend (Node only). Runs the local Claude Code CLI in print mode with tools
 * disabled and asks for JSON matching the feature's schema, so a Claude subscription login works
 * without an API key. Import from `@skillgraph/ai/claude-cli`; the main entry stays browser-safe.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AiError } from './errors';
import type { StructuredBackend } from './types';

export const CLAUDE_BIN_ENV = 'SKILLGRAPH_CLAUDE_BIN';

export interface ClaudeCliOptions {
  /** Binary to run (default: `$SKILLGRAPH_CLAUDE_BIN` or `claude`). */
  bin?: string;
  /** Passed as `--model`; omit to use the CLI's default. */
  model?: string;
  /** Kill the process after this long (default 240 s). */
  timeoutMs?: number;
  /** Working directory; default is a fresh temp folder so no project context leaks in. */
  cwd?: string;
  /** Extra CLI arguments appended verbatim. */
  extraArgs?: string[];
  /** Retries after a schema-invalid answer (default 1). */
  retries?: number;
  env?: NodeJS.ProcessEnv;
}

interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function runCli(
  bin: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000);
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Pull the `result` text out of `claude -p --output-format json` output. */
export function extractResultText(stdout: string): { text: string; isError: boolean } {
  const trimmed = stdout.trim();
  // Newer CLIs print one JSON object; some print several lines (hooks) before it.
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i] as string) as {
        type?: string;
        result?: unknown;
        is_error?: boolean;
      };
      if (obj && obj.type === 'result')
        return { text: typeof obj.result === 'string' ? obj.result : '', isError: !!obj.is_error };
    } catch {
      // not JSON; keep looking
    }
  }
  try {
    const obj = JSON.parse(trimmed) as { result?: unknown; is_error?: boolean };
    if (obj && typeof obj === 'object')
      return {
        text: typeof obj.result === 'string' ? obj.result : trimmed,
        isError: !!obj.is_error,
      };
  } catch {
    // raw text
  }
  return { text: trimmed, isError: false };
}

/** Find the JSON object in a model answer: strips code fences and surrounding prose. */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text) ?? '';
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in the answer');
  return JSON.parse(candidate.slice(start, end + 1));
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

function isAuthFailure(text: string): boolean {
  return /authenticat|not logged in|login|oauth|api key/i.test(text);
}

/**
 * A `StructuredBackend` over the local Claude Code CLI. Each call is one `claude -p` with
 * `--tools ""` and `--max-turns 1`; the prompt is passed on stdin so size is not an issue.
 */
export function createClaudeCliBackend(opts: ClaudeCliOptions = {}): StructuredBackend {
  const bin = opts.bin ?? process.env[CLAUDE_BIN_ENV] ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const retries = opts.retries ?? 1;
  const env = { ...process.env, ...(opts.env ?? {}) };
  // A nested Claude Code session refuses to start when it sees these.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return {
    name: 'claude-cli',
    async call<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
      const jsonSchema = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }));
      const base = [
        system,
        '',
        user,
        '',
        'Respond with a single JSON object that conforms to this JSON Schema. Output only the JSON: no prose, no Markdown code fence, no commentary before or after.',
        jsonSchema,
      ].join('\n');
      const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), 'skillgraph-ai-'));
      const ownCwd = !opts.cwd;
      try {
        let prompt = base;
        let lastError: AiError | undefined;
        for (let attempt = 0; attempt <= retries; attempt++) {
          const args = [
            '-p',
            '--output-format',
            'json',
            '--tools',
            '',
            '--max-turns',
            '1',
            ...(opts.model ? ['--model', opts.model] : []),
            ...(opts.extraArgs ?? []),
          ];
          let run: CliRun;
          try {
            run = await runCli(bin, args, prompt, cwd, timeoutMs, env);
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            throw new AiError(
              'api',
              code === 'ENOENT'
                ? `Cannot find the Claude Code CLI (${bin}). Install it or set ${CLAUDE_BIN_ENV}.`
                : `Failed to start ${bin}: ${(e as Error).message}`,
              { cause: e },
            );
          }
          if (run.timedOut)
            throw new AiError('api', `claude -p timed out after ${Math.round(timeoutMs / 1000)}s`);
          const { text, isError } = extractResultText(run.stdout);
          if (isError || (run.exitCode !== 0 && !text)) {
            const message = text || run.stderr.trim() || `claude exited with code ${run.exitCode}`;
            throw new AiError(
              isAuthFailure(message) ? 'auth' : 'api',
              isAuthFailure(message)
                ? `Claude Code is not logged in (${message}). Run \`claude\` once to log in.`
                : `claude -p failed: ${message}`,
            );
          }
          let parsedJson: unknown;
          try {
            parsedJson = extractJsonObject(text);
          } catch (e) {
            lastError = new AiError('parse', `The answer was not JSON: ${(e as Error).message}`, {
              details: text.slice(0, 2000),
            });
            prompt = `${base}\n\nYour previous answer was not a JSON object (${(e as Error).message}). Answer again with only the JSON object.`;
            continue;
          }
          const result = schema.safeParse(parsedJson);
          if (result.success) return result.data;
          lastError = new AiError('parse', 'The answer did not match the expected schema', {
            details: { issues: result.error.issues.slice(0, 12), answer: text.slice(0, 2000) },
          });
          prompt = `${base}\n\nYour previous answer failed schema validation:\n${formatIssues(result.error)}\nAnswer again with only a corrected JSON object.`;
        }
        throw lastError ?? new AiError('parse', 'No answer from claude -p');
      } finally {
        if (ownCwd) rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}
