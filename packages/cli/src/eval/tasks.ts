import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Grading } from '@skillgraph/ai';
import type { SkillDoc } from '@skillgraph/core';
import { readJson, writeJson } from '../fs';
import type { AiPort } from './ai-port';
import { type Benchmark, writeBenchmark } from './benchmark';
import { type ClaudeRunner, type ClaudeRunResult, runClaude } from './claude-runner';
import { buildVisits, type TraceFile, writeTrace } from './trace';
import { createProject, entryOf } from './workspace';

export const EVALS_FILE = 'evals/evals.json';
export const RUNS_DIR = 'evals/runs';

export interface EvalCase {
  id: number | string;
  prompt: string;
  expected_output?: string;
  files?: string[];
  expectations: string[];
}

export interface EvalSuite {
  skill_name: string;
  evals: EvalCase[];
}

export type Configuration = 'with_skill' | 'without_skill';

export interface ExecutionMetrics {
  tool_calls: Record<string, number>;
  total_tool_calls: number;
  total_steps: number;
  files_created: string[];
  errors_encountered: number;
  output_chars: number;
  transcript_chars: number;
}

export interface Timing {
  total_tokens: number;
  duration_ms: number;
  total_duration_seconds: number;
  executor_start: string;
  executor_end: string;
  executor_duration_seconds: number;
  grader_duration_seconds: number;
}

export interface TaskRunReport {
  evalId: number | string;
  configuration: Configuration;
  run: number;
  dir: string;
  metrics: ExecutionMetrics;
  timing: Timing;
  grading: Grading;
}

export interface TaskEvalOptions {
  doc: SkillDoc;
  /** Skill folder: `files` are resolved against it and results are written under `evals/runs`. */
  skillDir: string;
  suite: EvalSuite;
  ai: Pick<AiPort, 'grade' | 'alignTrace'>;
  /** Runs per configuration (default 1). */
  runs?: number;
  /** Also run the `without_skill` configuration (default true). */
  baseline?: boolean;
  /** Only run these eval ids. */
  only?: (number | string)[];
  runner?: ClaudeRunner;
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
  /** Run root; defaults to `<skillDir>/evals/runs/<timestamp>`. */
  outDir?: string;
  /** Temp folder parent for the throwaway projects. */
  baseDir?: string;
  /** Write `evals/traces/*.json` for the `with_skill` runs. */
  trace?: boolean;
  /** Use the AI aligner on top of the deterministic trace mapping. */
  aiAlign?: boolean;
  onRun?: (report: TaskRunReport) => void;
}

export interface TaskEvalOutput {
  runDir: string;
  reports: TaskRunReport[];
  benchmark: Benchmark;
}

/** Validate a loose JSON value as an `evals/evals.json` suite. */
export function parseEvalSuite(raw: unknown): EvalSuite {
  const r = raw as { skill_name?: unknown; evals?: unknown };
  if (!r || typeof r !== 'object' || !Array.isArray(r.evals))
    throw new Error('evals.json must be { skill_name, evals: [...] }');
  const evals = r.evals.map((item, i) => {
    const e = item as Record<string, unknown>;
    if (typeof e.prompt !== 'string' || !e.prompt.trim())
      throw new Error(`eval #${i + 1} needs a string prompt`);
    const expectations = Array.isArray(e.expectations)
      ? e.expectations.filter((x): x is string => typeof x === 'string')
      : [];
    if (expectations.length === 0) throw new Error(`eval #${i + 1} needs expectations`);
    const id = typeof e.id === 'number' || typeof e.id === 'string' ? e.id : i + 1;
    return {
      id,
      prompt: e.prompt,
      expected_output: typeof e.expected_output === 'string' ? e.expected_output : undefined,
      files: Array.isArray(e.files)
        ? e.files.filter((f): f is string => typeof f === 'string')
        : [],
      expectations,
    } satisfies EvalCase;
  });
  return {
    skill_name: typeof r.skill_name === 'string' ? r.skill_name : '',
    evals,
  };
}

export function readEvalSuite(skillDir: string): EvalSuite {
  const path = join(skillDir, EVALS_FILE);
  if (!existsSync(path)) throw new Error(`no ${EVALS_FILE} in ${skillDir}`);
  return parseEvalSuite(readJson(path));
}

/** Render the parsed stream as a readable transcript (skill-creator's transcript.md). */
export function renderTranscript(
  evalCase: EvalCase,
  configuration: Configuration,
  run: ClaudeRunResult,
): string {
  const lines = [
    `# Eval ${evalCase.id} — ${configuration} — run`,
    '',
    '## Prompt',
    '',
    evalCase.prompt,
    '',
    '## Transcript',
    '',
  ];
  for (const ev of run.events) {
    if (ev.type === 'text') {
      lines.push(`### Turn ${ev.turn} — assistant`, '', ev.text ?? '', '');
    } else {
      lines.push(
        `### Turn ${ev.turn} — tool: ${ev.tool}`,
        '',
        '```json',
        JSON.stringify(ev.input ?? {}, null, 2),
        '```',
        '',
      );
    }
  }
  lines.push('## Result', '', run.result || '(no result)', '');
  if (run.timedOut) lines.push('> The run timed out.', '');
  if (run.stderr.trim()) lines.push('## stderr', '', '```', run.stderr.trim(), '```', '');
  return `${lines.join('\n')}\n`;
}

function listFiles(root: string, dir = root, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.claude' || name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listFiles(root, full, out);
    else out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

function snapshot(root: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const rel of listFiles(root)) map.set(rel, statSync(join(root, rel)).mtimeMs);
  return map;
}

/** Copy files created or modified during the run into `<runDir>/outputs/`. */
function collectOutputs(root: string, before: Map<string, number>, outputsDir: string): string[] {
  const created: string[] = [];
  for (const rel of listFiles(root)) {
    if (rel.startsWith('inputs/')) continue;
    const mtime = statSync(join(root, rel)).mtimeMs;
    const prev = before.get(rel);
    if (prev !== undefined && prev === mtime) continue;
    const target = join(outputsDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, rel), target);
    created.push(rel);
  }
  return created.sort();
}

function outputChars(dir: string): number {
  let total = 0;
  for (const rel of listFiles(dir)) total += statSync(join(dir, rel)).size;
  return total;
}

function metricsOf(run: ClaudeRunResult, filesCreated: string[], transcript: string) {
  return {
    tool_calls: run.toolCalls,
    total_tool_calls: run.totalToolCalls,
    total_steps: run.numTurns,
    files_created: filesCreated,
    errors_encountered: run.toolResults.filter((t) => t.isError).length + (run.isError ? 1 : 0),
    output_chars: 0,
    transcript_chars: transcript.length,
  } satisfies ExecutionMetrics;
}

function readOutputTexts(outputsDir: string, limit = 20_000): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of listFiles(outputsDir).slice(0, 20)) {
    try {
      const content = readFileSync(join(outputsDir, rel), 'utf8');
      out[rel] = content.length > limit ? `${content.slice(0, limit)}\n… (truncated)` : content;
    } catch {
      // binary or unreadable output; skip
    }
  }
  return out;
}

function promptFor(evalCase: EvalCase, inputs: string[]): string {
  if (inputs.length === 0) return evalCase.prompt;
  return `${evalCase.prompt}\n\nInput files (relative to the project root): ${inputs.join(', ')}`;
}

const seconds = (ms: number) => Math.round((ms / 1000) * 10) / 10;

/**
 * Run every eval in the suite `runs` times per configuration, grade each run with the AI port and
 * aggregate everything into `benchmark.json` / `benchmark.md` at the run root.
 */
export async function runTaskEvals(opts: TaskEvalOptions): Promise<TaskEvalOutput> {
  const entry = entryOf(opts.doc);
  const runsPer = Math.max(1, opts.runs ?? 1);
  const baseline = opts.baseline !== false;
  const runner = opts.runner ?? runClaude;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = opts.outDir ?? join(opts.skillDir, RUNS_DIR, stamp);
  const cases = opts.only
    ? opts.suite.evals.filter((e) => opts.only?.some((id) => String(id) === String(e.id)))
    : opts.suite.evals;
  if (cases.length === 0) throw new Error('no evals to run');
  const configs: Configuration[] = baseline ? ['with_skill', 'without_skill'] : ['with_skill'];
  const reports: TaskRunReport[] = [];

  for (const evalCase of cases) {
    const evalDir = join(runDir, `eval-${evalCase.id}`);
    writeJson(join(evalDir, 'eval_metadata.json'), {
      eval_id: evalCase.id,
      eval_name: evalCase.expected_output?.slice(0, 80),
      prompt: evalCase.prompt,
      expected_output: evalCase.expected_output,
      expectations: evalCase.expectations,
      files: evalCase.files ?? [],
    });
    for (const configuration of configs) {
      for (let run = 1; run <= runsPer; run++) {
        const dir = join(evalDir, configuration, `run-${run}`);
        mkdirSync(dir, { recursive: true });
        const project = createProject({
          doc: opts.doc,
          withSkill: configuration === 'with_skill',
          skillRoot: opts.skillDir,
          files: evalCase.files,
          baseDir: opts.baseDir,
        });
        try {
          const before = snapshot(project.root);
          const startedAt = new Date();
          const result = await runner({
            prompt: promptFor(evalCase, project.inputs),
            cwd: project.root,
            maxTurns: opts.maxTurns,
            model: opts.model,
            timeoutMs: opts.timeoutMs,
          });
          const endedAt = new Date();
          const outputsDir = join(dir, 'outputs');
          mkdirSync(outputsDir, { recursive: true });
          const filesCreated = collectOutputs(project.root, before, outputsDir);
          const transcript = renderTranscript(evalCase, configuration, result);
          writeFileSync(join(dir, 'transcript.md'), transcript, 'utf8');
          const metrics = metricsOf(result, filesCreated, transcript);
          metrics.output_chars = outputChars(outputsDir);
          writeJson(join(outputsDir, 'metrics.json'), metrics);
          writeJson(join(dir, 'metrics.json'), metrics);

          const gradeStart = Date.now();
          const grading = await opts.ai.grade({
            prompt: evalCase.prompt,
            expectations: evalCase.expectations,
            transcript,
            outputs: readOutputTexts(outputsDir),
          });
          const graderSeconds = seconds(Date.now() - gradeStart);
          const timing: Timing = {
            total_tokens: result.totalTokens ?? 0,
            duration_ms: result.durationMs,
            total_duration_seconds: seconds(result.durationMs) + graderSeconds,
            executor_start: startedAt.toISOString(),
            executor_end: endedAt.toISOString(),
            executor_duration_seconds: seconds(result.durationMs),
            grader_duration_seconds: graderSeconds,
          };
          writeJson(join(dir, 'timing.json'), timing);
          writeJson(join(dir, 'grading.json'), {
            ...grading,
            execution_metrics: metrics,
            timing,
          });

          if (opts.trace && configuration === 'with_skill') {
            const visits = await buildVisits(opts.doc, result.events, {
              ai: opts.ai,
              aiAlign: opts.aiAlign,
            });
            const trace: TraceFile = {
              evalId: evalCase.id,
              run,
              configuration,
              createdAt: startedAt.toISOString(),
              visits,
              events: result.events,
            };
            writeTrace(opts.skillDir, trace);
            writeJson(join(dir, 'trace.json'), trace);
          }

          const report: TaskRunReport = {
            evalId: evalCase.id,
            configuration,
            run,
            dir,
            metrics,
            timing,
            grading,
          };
          reports.push(report);
          opts.onRun?.(report);
        } finally {
          project.cleanup();
        }
      }
    }
  }

  const benchmark = writeBenchmark(runDir, {
    skill_name: entry.name,
    skill_path: opts.skillDir,
    executor_model: opts.model ?? 'default',
    analyzer_model: 'default',
    runs_per_configuration: runsPer,
  });
  return { runDir, reports, benchmark };
}

/** Short label for CLI output, e.g. `eval-2 with_skill run-1: 3/4 (75%)`. */
export function reportLine(r: TaskRunReport): string {
  const s = r.grading.summary;
  const dirName = basename(r.dir);
  return `eval-${r.evalId} ${r.configuration} ${dirName}: ${s.passed}/${s.total} (${Math.round(s.pass_rate * 100)}%)`;
}
