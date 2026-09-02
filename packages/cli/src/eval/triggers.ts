import { join } from 'node:path';
import type { TriggerEvalResult, TriggerQuery } from '@skillgraph/ai';
import type { SkillDoc } from '@skillgraph/core';
import { writeJson } from '../fs';
import { type ClaudeRunner, detectSkillTrigger, runClaude } from './claude-runner';
import { createProject, entryOf } from './workspace';

/** A TriggerEvalResult plus any run-level failures (auth, timeout, crash) behind it. */
export interface TriggerRunResult extends TriggerEvalResult {
  errors?: string[];
}

export interface TriggerSummary {
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}

export interface TriggerEvalOutput {
  skill_name: string;
  description: string;
  results: TriggerEvalResult[];
  summary: TriggerSummary;
}

export interface TriggerEvalOptions {
  doc: SkillDoc;
  queries: TriggerQuery[];
  /** Candidate description; defaults to the entry description. */
  description?: string;
  /** Runs per query, majority vote (default 3). */
  runs?: number;
  /** Trigger-rate threshold for "triggered" (default 0.5). */
  threshold?: number;
  concurrency?: number;
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
  /** Injected for tests; defaults to spawning `claude`. */
  runner?: ClaudeRunner;
  baseDir?: string;
  onResult?: (result: TriggerRunResult) => void;
}

/** A query counts as triggered when the trigger rate reaches the threshold (>= 0.5 by default). */
export function majorityVote(runs: boolean[], threshold = 0.5): boolean {
  if (runs.length === 0) return false;
  const rate = runs.filter(Boolean).length / runs.length;
  return rate >= threshold;
}

export function summarize(results: TriggerEvalResult[]): TriggerSummary {
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  return {
    passed,
    failed: total - passed,
    total,
    pass_rate: total === 0 ? 0 : Math.round((passed / total) * 10000) / 10000,
  };
}

/** Run `jobs` with at most `limit` in flight, preserving result order. */
export async function runPool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i] as () => Promise<T>;
      results[i] = await job();
    }
  };
  const n = Math.max(1, Math.min(limit, jobs.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/** Trigger eval: does `claude -p <query>` invoke the skill for queries that should (and only those)? */
export async function runTriggerEvals(opts: TriggerEvalOptions): Promise<TriggerEvalOutput> {
  const entry = entryOf(opts.doc);
  const description = opts.description ?? entry.description;
  const runsPerQuery = Math.max(1, opts.runs ?? 3);
  const threshold = opts.threshold ?? 0.5;
  const runner = opts.runner ?? runClaude;
  const project = createProject({
    doc: opts.doc,
    withSkill: true,
    description,
    baseDir: opts.baseDir,
  });
  try {
    const jobs = opts.queries.flatMap((q, qi) =>
      Array.from({ length: runsPerQuery }, () => async () => {
        const run = await runner({
          prompt: q.query,
          cwd: project.root,
          maxTurns: opts.maxTurns ?? 3,
          model: opts.model,
          timeoutMs: opts.timeoutMs,
        });
        const error = run.timedOut
          ? `timed out after ${run.durationMs}ms`
          : run.isError
            ? run.result || run.stderr.trim() || `claude exited with code ${run.exitCode}`
            : undefined;
        return { qi, triggered: detectSkillTrigger(run.events, entry.name), error };
      }),
    );
    const outcomes = await runPool(jobs, opts.concurrency ?? 4);
    // A run that failed (auth, timeout, crash) is not a "no trigger"; surface it instead.
    if (outcomes.length > 0 && outcomes.every((o) => o.error)) {
      throw new Error(`every claude run failed: ${outcomes[0]?.error}`);
    }
    const perQuery = new Map<number, boolean[]>();
    const errorsByQuery = new Map<number, string[]>();
    for (const o of outcomes) {
      const list = perQuery.get(o.qi) ?? [];
      list.push(o.triggered);
      perQuery.set(o.qi, list);
      if (o.error) errorsByQuery.set(o.qi, [...(errorsByQuery.get(o.qi) ?? []), o.error]);
    }
    const results: TriggerRunResult[] = opts.queries.map((q, qi) => {
      const runs = perQuery.get(qi) ?? [];
      const triggered = majorityVote(runs, threshold);
      const errors = errorsByQuery.get(qi);
      const result: TriggerRunResult = {
        query: q.query,
        should_trigger: q.should_trigger,
        triggered,
        pass: triggered === q.should_trigger,
        runs,
        ...(errors ? { errors } : {}),
      };
      opts.onResult?.(result);
      return result;
    });
    return { skill_name: entry.name, description, results, summary: summarize(results) };
  } finally {
    project.cleanup();
  }
}

export const TRIGGER_QUERIES_FILE = 'evals/trigger-queries.json';
export const TRIGGER_RESULTS_FILE = 'evals/trigger-results.json';

export function writeTriggerResults(skillDir: string, out: TriggerEvalOutput): string {
  const path = join(skillDir, TRIGGER_RESULTS_FILE);
  writeJson(path, out);
  return path;
}

/** Validate a loose JSON value as a TriggerQuery[] (accepts `{ queries: [...] }` too). */
export function parseTriggerQueries(raw: unknown): TriggerQuery[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { queries?: unknown }).queries)
      ? (raw as { queries: unknown[] }).queries
      : null;
  if (!list) throw new Error('trigger queries must be an array of { query, should_trigger }');
  return list.map((item, i) => {
    const r = item as { query?: unknown; should_trigger?: unknown };
    if (typeof r.query !== 'string' || typeof r.should_trigger !== 'boolean')
      throw new Error(`trigger query #${i + 1} must have string query and boolean should_trigger`);
    return { query: r.query, should_trigger: r.should_trigger };
  });
}
