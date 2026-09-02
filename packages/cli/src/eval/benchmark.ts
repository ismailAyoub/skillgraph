import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Grading } from '@skillgraph/ai';
import { readJson, writeJson } from '../fs';

export interface Stats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface RunResult {
  eval_id: number | string;
  eval_name?: string;
  run_number: number;
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number;
  tokens: number;
  tool_calls: number;
  errors: number;
  expectations: Grading['expectations'];
  notes: string[];
}

export interface ConfigSummary {
  pass_rate: Stats;
  time_seconds: Stats;
  tokens: Stats;
}

export type RunSummary = Record<string, ConfigSummary> & {
  delta?: { pass_rate: string; time_seconds: string; tokens: string };
};

export interface BenchmarkMetadata {
  skill_name: string;
  skill_path: string;
  executor_model: string;
  analyzer_model: string;
  timestamp: string;
  evals_run: (number | string)[];
  runs_per_configuration: number;
}

export interface Benchmark {
  metadata: BenchmarkMetadata;
  runs: {
    eval_id: number | string;
    eval_name?: string;
    configuration: string;
    run_number: number;
    result: {
      pass_rate: number;
      passed: number;
      failed: number;
      total: number;
      time_seconds: number;
      tokens: number;
      tool_calls: number;
      errors: number;
    };
    expectations: Grading['expectations'];
    notes: string[];
  }[];
  run_summary: RunSummary;
  notes: string[];
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Mean / sample stddev / min / max, rounded to 4 decimals (aggregate_benchmark.calculate_stats). */
export function calculateStats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0;
  return {
    mean: round4(mean),
    stddev: round4(Math.sqrt(variance)),
    min: round4(Math.min(...values)),
    max: round4(Math.max(...values)),
  };
}

function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Walk `<runDir>/eval-<id>/<config>/run-<n>/grading.json` into per-config run results. */
export function loadRunResults(runDir: string): Record<string, RunResult[]> {
  const results: Record<string, RunResult[]> = {};
  if (!isDir(runDir)) return results;
  const evalDirs = readdirSync(runDir)
    .filter((n) => n.startsWith('eval-') && isDir(join(runDir, n)))
    .sort();
  evalDirs.forEach((evalName, evalIdx) => {
    const evalDir = join(runDir, evalName);
    let evalId: number | string = evalIdx;
    let evalTitle: string | undefined;
    const metaPath = join(evalDir, 'eval_metadata.json');
    if (existsSync(metaPath)) {
      try {
        const meta = readJson(metaPath) as { eval_id?: unknown; eval_name?: unknown };
        if (typeof meta.eval_id === 'number' || typeof meta.eval_id === 'string')
          evalId = meta.eval_id;
        if (typeof meta.eval_name === 'string') evalTitle = meta.eval_name;
      } catch {
        // fall through to the folder name
      }
    } else {
      const suffix = evalName.slice('eval-'.length);
      evalId = /^\d+$/.test(suffix) ? Number(suffix) : suffix;
    }
    for (const config of readdirSync(evalDir).sort()) {
      const configDir = join(evalDir, config);
      if (!isDir(configDir)) continue;
      const runDirs = readdirSync(configDir)
        .filter((n) => /^run-\d+$/.test(n) && isDir(join(configDir, n)))
        .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
      if (runDirs.length === 0) continue;
      results[config] ??= [];
      for (const runName of runDirs) {
        const dir = join(configDir, runName);
        const gradingPath = join(dir, 'grading.json');
        if (!existsSync(gradingPath)) {
          console.warn(`Warning: grading.json not found in ${dir}`);
          continue;
        }
        let grading: Record<string, unknown>;
        try {
          grading = readJson(gradingPath) as Record<string, unknown>;
        } catch (e) {
          console.warn(`Warning: invalid JSON in ${gradingPath}: ${(e as Error).message}`);
          continue;
        }
        const summary = (grading.summary ?? {}) as Record<string, unknown>;
        const timing = (grading.timing ?? {}) as Record<string, unknown>;
        let timeSeconds = numberOr(timing.total_duration_seconds, 0);
        let tokens = 0;
        const timingPath = join(dir, 'timing.json');
        if (existsSync(timingPath)) {
          try {
            const t = readJson(timingPath) as Record<string, unknown>;
            if (timeSeconds === 0) timeSeconds = numberOr(t.total_duration_seconds, 0);
            tokens = numberOr(t.total_tokens, 0);
          } catch {
            // ignore unreadable timing
          }
        }
        const metrics = (grading.execution_metrics ?? {}) as Record<string, unknown>;
        if (!tokens) tokens = numberOr(metrics.output_chars, 0);
        const notesSummary = (grading.user_notes_summary ?? {}) as Record<string, unknown>;
        const notes: string[] = [];
        for (const key of ['uncertainties', 'needs_review', 'workarounds']) {
          const list = notesSummary[key];
          if (Array.isArray(list)) notes.push(...list.filter((x) => typeof x === 'string'));
        }
        results[config]?.push({
          eval_id: evalId,
          eval_name: evalTitle,
          run_number: Number(runName.slice(4)),
          pass_rate: numberOr(summary.pass_rate, 0),
          passed: numberOr(summary.passed, 0),
          failed: numberOr(summary.failed, 0),
          total: numberOr(summary.total, 0),
          time_seconds: timeSeconds,
          tokens,
          tool_calls: numberOr(metrics.total_tool_calls, 0),
          errors: numberOr(metrics.errors_encountered, 0),
          expectations: Array.isArray(grading.expectations)
            ? (grading.expectations as Grading['expectations'])
            : [],
          notes,
        });
      }
    }
  });
  return results;
}

const CONFIG_ORDER = ['with_skill', 'without_skill'];

function orderedConfigs(results: Record<string, RunResult[]>): string[] {
  return Object.keys(results).sort((a, b) => {
    const ia = CONFIG_ORDER.indexOf(a);
    const ib = CONFIG_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

const sign = (v: number, digits: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}`;

/** Per-config stats plus `delta` = first config (with_skill) minus second (without_skill). */
export function aggregateResults(results: Record<string, RunResult[]>): RunSummary {
  const summary: RunSummary = {};
  const configs = orderedConfigs(results);
  for (const config of configs) {
    const runs = results[config] ?? [];
    summary[config] = {
      pass_rate: calculateStats(runs.map((r) => r.pass_rate)),
      time_seconds: calculateStats(runs.map((r) => r.time_seconds)),
      tokens: calculateStats(runs.map((r) => r.tokens)),
    };
  }
  const primary = configs[0] ? summary[configs[0]] : undefined;
  const baseline = configs[1] ? summary[configs[1]] : undefined;
  const mean = (s: ConfigSummary | undefined, k: keyof ConfigSummary) => s?.[k].mean ?? 0;
  summary.delta = {
    pass_rate: sign(mean(primary, 'pass_rate') - mean(baseline, 'pass_rate'), 2),
    time_seconds: sign(mean(primary, 'time_seconds') - mean(baseline, 'time_seconds'), 1),
    tokens: sign(mean(primary, 'tokens') - mean(baseline, 'tokens'), 0),
  };
  return summary;
}

export interface BenchmarkMeta {
  skill_name?: string;
  skill_path?: string;
  executor_model?: string;
  analyzer_model?: string;
  runs_per_configuration?: number;
  notes?: string[];
}

export function generateBenchmark(runDir: string, meta: BenchmarkMeta = {}): Benchmark {
  const results = loadRunResults(runDir);
  const run_summary = aggregateResults(results);
  const runs: Benchmark['runs'] = [];
  for (const config of orderedConfigs(results)) {
    for (const r of results[config] ?? []) {
      runs.push({
        eval_id: r.eval_id,
        eval_name: r.eval_name,
        configuration: config,
        run_number: r.run_number,
        result: {
          pass_rate: r.pass_rate,
          passed: r.passed,
          failed: r.failed,
          total: r.total,
          time_seconds: r.time_seconds,
          tokens: r.tokens,
          tool_calls: r.tool_calls,
          errors: r.errors,
        },
        expectations: r.expectations,
        notes: r.notes,
      });
    }
  }
  const evalIds = [...new Set(runs.map((r) => r.eval_id))].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );
  const maxRuns = Math.max(0, ...runs.map((r) => r.run_number));
  return {
    metadata: {
      skill_name: meta.skill_name ?? '<skill-name>',
      skill_path: meta.skill_path ?? '<path/to/skill>',
      executor_model: meta.executor_model ?? '<model-name>',
      analyzer_model: meta.analyzer_model ?? '<model-name>',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      evals_run: evalIds,
      runs_per_configuration: meta.runs_per_configuration ?? maxRuns,
    },
    runs,
    run_summary,
    notes: meta.notes ?? [],
  };
}

const title = (s: string) =>
  s
    .split('_')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ');

export function benchmarkMarkdown(b: Benchmark): string {
  const configs = Object.keys(b.run_summary).filter((k) => k !== 'delta');
  const a = configs[0] ?? 'config_a';
  const c = configs[1] ?? 'config_b';
  const sa = b.run_summary[a] as ConfigSummary | undefined;
  const sb = b.run_summary[c] as ConfigSummary | undefined;
  const d = b.run_summary.delta;
  const pct = (v: number | undefined) => `${((v ?? 0) * 100).toFixed(0)}%`;
  const lines = [
    `# Skill Benchmark: ${b.metadata.skill_name}`,
    '',
    `**Model**: ${b.metadata.executor_model}`,
    `**Date**: ${b.metadata.timestamp}`,
    `**Evals**: ${b.metadata.evals_run.join(', ')} (${b.metadata.runs_per_configuration} runs each per configuration)`,
    '',
    '## Summary',
    '',
    `| Metric | ${title(a)} | ${title(c)} | Delta |`,
    '|--------|------------|---------------|-------|',
    `| Pass Rate | ${pct(sa?.pass_rate.mean)} ± ${pct(sa?.pass_rate.stddev)} | ${pct(sb?.pass_rate.mean)} ± ${pct(sb?.pass_rate.stddev)} | ${d?.pass_rate ?? '—'} |`,
    `| Time | ${(sa?.time_seconds.mean ?? 0).toFixed(1)}s ± ${(sa?.time_seconds.stddev ?? 0).toFixed(1)}s | ${(sb?.time_seconds.mean ?? 0).toFixed(1)}s ± ${(sb?.time_seconds.stddev ?? 0).toFixed(1)}s | ${d?.time_seconds ?? '—'}s |`,
    `| Tokens | ${(sa?.tokens.mean ?? 0).toFixed(0)} ± ${(sa?.tokens.stddev ?? 0).toFixed(0)} | ${(sb?.tokens.mean ?? 0).toFixed(0)} ± ${(sb?.tokens.stddev ?? 0).toFixed(0)} | ${d?.tokens ?? '—'} |`,
  ];
  if (b.notes.length > 0) {
    lines.push('', '## Notes', '');
    for (const n of b.notes) lines.push(`- ${n}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Write benchmark.json + benchmark.md at the run root and return the benchmark. */
export function writeBenchmark(runDir: string, meta: BenchmarkMeta = {}): Benchmark {
  const b = generateBenchmark(runDir, meta);
  writeJson(join(runDir, 'benchmark.json'), b);
  writeFileSync(join(runDir, 'benchmark.md'), benchmarkMarkdown(b), 'utf8');
  return b;
}
