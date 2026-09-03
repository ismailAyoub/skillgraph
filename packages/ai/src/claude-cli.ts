/**
 * `claude -p` backend (Node only). Runs the local Claude Code CLI in print mode with tools
 * disabled and asks for JSON matching the feature's schema, so a Claude subscription login works
 * without an API key. Import from `@skillgraph/ai/claude-cli`; the main entry stays browser-safe.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { z } from 'zod';
import { AiError } from './errors';
import type { StructuredBackend } from './types';

export const CLAUDE_BIN_ENV = 'SKILLGRAPH_CLAUDE_BIN';

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Path of the Claude Code CLI this process would run: `$SKILLGRAPH_CLAUDE_BIN`, else the first
 * `claude` on PATH. Null when none is executable. Cheap: nothing is spawned.
 */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const wanted = env[CLAUDE_BIN_ENV] || 'claude';
  if (wanted.includes('/')) return isExecutable(wanted) ? wanted : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    // A PATH scan, not a project file: keep bundlers from tracing the whole repo into the output.
    const full = join(/*turbopackIgnore: true*/ dir, wanted);
    if (isExecutable(full)) return full;
  }
  return null;
}

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

/** What `claude auth status` says about the login on this machine. */
export interface ClaudeAuth {
  /** Absolute path of the CLI, or null when it is not installed. */
  bin: string | null;
  loggedIn: boolean;
  /** `claude.ai` for a subscription login, `console` for API billing; null when logged out. */
  method: string | null;
  /** `pro`, `max`, ... when known. */
  subscription: string | null;
  /** The account email when known. */
  account: string | null;
  /** Why the check could not run; the other fields are then best effort. */
  error?: string;
}

const LOGGED_OUT: Omit<ClaudeAuth, 'bin'> = {
  loggedIn: false,
  method: null,
  subscription: null,
  account: null,
};

/** Parse `claude auth status --json` output (tolerates noise around the JSON object). */
export function parseAuthStatus(stdout: string): Omit<ClaudeAuth, 'bin'> {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end < start)
    return { ...LOGGED_OUT, error: 'unexpected output from `claude auth status`' };
  try {
    const o = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
    const method =
      typeof o.authMethod === 'string' && o.authMethod !== 'none' ? o.authMethod : null;
    return {
      loggedIn: o.loggedIn === true,
      method,
      subscription: typeof o.subscriptionType === 'string' ? o.subscriptionType : null,
      account: typeof o.email === 'string' ? o.email : null,
    };
  } catch (e) {
    return {
      ...LOGGED_OUT,
      error: `could not parse \`claude auth status\`: ${(e as Error).message}`,
    };
  }
}

/**
 * Is the Claude Code CLI installed and logged in? Runs `claude auth status --json` (fast, no
 * network). Callers cache this; it is what the editor shows as the subscription status.
 */
export async function claudeAuthStatus(
  opts: { bin?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ClaudeAuth> {
  const env = { ...process.env, ...(opts.env ?? {}) };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const bin = opts.bin ?? findClaudeBin(env);
  if (!bin) return { bin: null, ...LOGGED_OUT };
  try {
    const run = await runCli(
      bin,
      ['auth', 'status', '--json'],
      '',
      tmpdir(),
      opts.timeoutMs ?? 8000,
      env,
    );
    if (run.timedOut) return { bin, ...LOGGED_OUT, error: '`claude auth status` timed out' };
    const parsed = parseAuthStatus(run.stdout);
    if (!parsed.loggedIn && !parsed.error && run.exitCode !== 0 && run.stderr.trim())
      parsed.error = run.stderr.trim();
    return { bin, ...parsed };
  } catch (e) {
    return { bin, ...LOGGED_OUT, error: (e as Error).message };
  }
}

/** The one thing stopping `claude -p` from working, as a sentence for the UI; null when ready. */
export function claudeAuthProblem(auth: ClaudeAuth): string | null {
  if (!auth.bin)
    return 'Claude Code is not installed on this machine (no `claude` on PATH). Install it and log in once, or use an API key.';
  if (!auth.loggedIn)
    return 'Claude Code on this machine is not logged in. In a terminal run `claude auth login`, sign in, and paste the code it shows back into the terminal.';
  return null;
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
