import { spawn } from 'node:child_process';
import type { TraceEvent } from '@skillgraph/ai';

/** Env var that overrides the `claude` binary (tests point it at a fake script). */
export const CLAUDE_BIN_ENV = 'SKILLGRAPH_CLAUDE_BIN';

export interface ToolResultEvent {
  turn: number;
  toolUseId?: string;
  content: string;
  isError: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ParsedStream {
  /** Assistant content blocks in order, `turn` = 1-based assistant message index. */
  events: TraceEvent[];
  toolResults: ToolResultEvent[];
  /** Final result text (from the `result` event, else the last assistant text). */
  result: string;
  isError: boolean;
  numTurns: number;
  durationMs?: number;
  usage?: TokenUsage;
  totalTokens?: number;
  model?: string;
  sessionId?: string;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  /** Lines that were not valid JSON (kept for debugging). */
  unparsed: string[];
}

export interface RunClaudeOptions {
  prompt: string;
  cwd: string;
  maxTurns?: number;
  model?: string;
  /** Wall clock limit; the process is killed when exceeded. Default 120s. */
  timeoutMs?: number;
  bin?: string;
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
}

export interface ClaudeRunResult extends ParsedStream {
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
  stdout: string;
  command: string[];
}

export type ClaudeRunner = (opts: RunClaudeOptions) => Promise<ClaudeRunResult>;

interface ContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((c) => {
        const r = asRecord(c);
        return r && typeof r.text === 'string' ? r.text : '';
      })
      .filter(Boolean)
      .join('\n');
  return content == null ? '' : JSON.stringify(content);
}

/** Parse `claude -p --output-format stream-json --verbose` output (one JSON object per line). */
export function parseStreamJson(text: string): ParsedStream {
  const out: ParsedStream = {
    events: [],
    toolResults: [],
    result: '',
    isError: false,
    numTurns: 0,
    toolCalls: {},
    totalToolCalls: 0,
    unparsed: [],
  };
  let turn = 0;
  let lastText = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let ev: Record<string, unknown> | undefined;
    try {
      ev = asRecord(JSON.parse(line));
    } catch {
      out.unparsed.push(line);
      continue;
    }
    if (!ev) continue;
    const type = ev.type;
    if (type === 'system') {
      if (typeof ev.model === 'string') out.model = ev.model;
      if (typeof ev.session_id === 'string') out.sessionId = ev.session_id;
      continue;
    }
    if (type === 'assistant') {
      turn += 1;
      const message = asRecord(ev.message);
      if (message && typeof message.model === 'string') out.model = message.model;
      const content = Array.isArray(message?.content) ? (message?.content as ContentBlock[]) : [];
      for (const block of content) {
        if (block.type === 'tool_use') {
          const name = block.name ?? 'unknown';
          out.events.push({ turn, type: 'tool_use', tool: name, input: block.input ?? {} });
          out.toolCalls[name] = (out.toolCalls[name] ?? 0) + 1;
          out.totalToolCalls += 1;
        } else if (block.type === 'text' && typeof block.text === 'string') {
          out.events.push({ turn, type: 'text', text: block.text });
          lastText = block.text;
        }
      }
      continue;
    }
    if (type === 'user') {
      const message = asRecord(ev.message);
      const content = Array.isArray(message?.content) ? (message?.content as ContentBlock[]) : [];
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        out.toolResults.push({
          turn,
          toolUseId: block.tool_use_id,
          content: blockText(block.content),
          isError: block.is_error === true,
        });
      }
      continue;
    }
    if (type === 'result') {
      if (typeof ev.result === 'string') out.result = ev.result;
      out.isError = ev.is_error === true || ev.subtype === 'error';
      if (typeof ev.num_turns === 'number') out.numTurns = ev.num_turns;
      if (typeof ev.duration_ms === 'number') out.durationMs = ev.duration_ms;
      if (typeof ev.session_id === 'string') out.sessionId = ev.session_id;
      const usage = asRecord(ev.usage);
      if (usage) {
        const n = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : 0);
        out.usage = {
          input_tokens: n('input_tokens'),
          output_tokens: n('output_tokens'),
          cache_creation_input_tokens: n('cache_creation_input_tokens'),
          cache_read_input_tokens: n('cache_read_input_tokens'),
        };
        out.totalTokens =
          out.usage.input_tokens +
          out.usage.output_tokens +
          out.usage.cache_creation_input_tokens +
          out.usage.cache_read_input_tokens;
      }
    }
  }
  if (!out.numTurns) out.numTurns = turn;
  if (!out.result) out.result = lastText;
  return out;
}

function stripSkillRef(value: string): string {
  // "/name args", "plugin:name", "name" -> "name"
  let s = value.trim();
  if (s.startsWith('/')) s = s.slice(1);
  s = s.split(/\s+/)[0] ?? '';
  const colon = s.lastIndexOf(':');
  return colon >= 0 ? s.slice(colon + 1) : s;
}

/** True when a `Skill` tool_use names the skill (input.skill / input.command / any string arg). */
export function isSkillCallFor(event: TraceEvent, name: string): boolean {
  if (event.type !== 'tool_use' || event.tool !== 'Skill') return false;
  const input = asRecord(event.input);
  if (!input) return false;
  for (const key of ['skill', 'command', 'name']) {
    const v = input[key];
    if (typeof v === 'string' && stripSkillRef(v) === name) return true;
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && (v === name || v.startsWith(`/${name} `) || v === `/${name}`))
      return true;
  }
  return false;
}

/** True when the skill was invoked (`Skill` tool) or its SKILL.md was read directly (run_eval.py semantics). */
export function detectSkillTrigger(events: TraceEvent[], name: string): boolean {
  for (const ev of events) {
    if (isSkillCallFor(ev, name)) return true;
    if (ev.type === 'tool_use' && ev.tool === 'Read') {
      const input = asRecord(ev.input);
      const fp = input?.file_path;
      if (typeof fp === 'string' && fp.split('\\').join('/').includes(`/skills/${name}/SKILL.md`))
        return true;
    }
  }
  return false;
}

export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env[CLAUDE_BIN_ENV] || 'claude';
}

/** Spawn `claude -p` and parse its stream-json output. Never throws on a failing process. */
export function runClaude(opts: RunClaudeOptions): Promise<ClaudeRunResult> {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
  // Allow nesting `claude -p` inside a Claude Code session (the guard is for interactive TTYs).
  delete env.CLAUDECODE;
  const bin = opts.bin ?? claudeBinary(env);
  const args = ['-p', opts.prompt, '--output-format', 'stream-json', '--verbose'];
  if (opts.maxTurns !== undefined) args.push('--max-turns', String(opts.maxTurns));
  if (opts.model) args.push('--model', opts.model);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = parseStreamJson(stdout);
      resolve({
        ...parsed,
        durationMs: Date.now() - started,
        exitCode,
        timedOut,
        stderr,
        stdout,
        command: [bin, ...args],
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000).unref();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
    });
    child.on('error', (e) => {
      stderr += `${e.message}\n`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
