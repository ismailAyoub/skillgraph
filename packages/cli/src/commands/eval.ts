import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AiOptions } from '@skillgraph/ai';
import { createClaudeCliBackend } from '@skillgraph/ai/claude-cli';
import { decompile, migrate, type SkillDoc } from '@skillgraph/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { type AiPort, createAiPort } from '../eval/ai-port';
import { applyDescription, optimizeDescription, writeDescriptionHistory } from '../eval/optimize';
import { readEvalSuite, reportLine, runTaskEvals } from '../eval/tasks';
import { aggregateTraces, readTraces } from '../eval/trace';
import {
  parseTriggerQueries,
  runTriggerEvals,
  TRIGGER_QUERIES_FILE,
  writeTriggerResults,
} from '../eval/triggers';
import { entryOf } from '../eval/workspace';
import { graphPath, readJson, readSkillDir, writeJson } from '../fs';

interface CommonArgs {
  key?: string;
  model?: string;
  backend?: string;
}

function loadDoc(dir: string): SkillDoc {
  const gp = graphPath(dir);
  if (existsSync(gp)) return migrate(readJson(gp)).doc;
  if (!existsSync(dir)) throw new Error(`no such folder: ${dir}`);
  return decompile(readSkillDir(dir)).file.doc;
}

function aiOptions(args: CommonArgs): AiOptions {
  const apiKey = args.key ?? process.env.ANTHROPIC_API_KEY;
  const backend = args.backend ?? 'auto';
  if (backend === 'api' || (backend === 'auto' && apiKey)) {
    if (!apiKey)
      throw new Error('no API key: pass --key or set ANTHROPIC_API_KEY, or use --backend claude');
    return { apiKey, ...(args.model ? { model: args.model } : {}) };
  }
  if (backend !== 'claude' && backend !== 'auto')
    throw new Error(`unknown --backend ${backend}; use api, claude or auto`);
  return { backend: createClaudeCliBackend(args.model ? { model: args.model } : {}) };
}

function ai(args: CommonArgs): AiPort {
  return createAiPort(aiOptions(args));
}

function fail(e: unknown): number {
  console.error(pc.red((e as Error).message));
  return 1;
}

/** `eval queries`: generate trigger queries with the model and save them next to the skill. */
export async function queriesCommand(
  args: CommonArgs & { dir: string; count?: number; json?: boolean; out?: string },
): Promise<number> {
  try {
    const dir = resolve(args.dir);
    const doc = loadDoc(dir);
    const queries = await ai(args).triggerQueries({ doc, count: args.count });
    if (args.json) {
      console.log(JSON.stringify(queries, null, 2));
      return 0;
    }
    const out = args.out ? resolve(args.out) : join(dir, TRIGGER_QUERIES_FILE);
    writeJson(out, queries);
    const yes = queries.filter((q) => q.should_trigger).length;
    console.log(pc.green(`${queries.length} queries (${yes} should trigger) -> ${out}`));
    return 0;
  } catch (e) {
    return fail(e);
  }
}

/** `eval triggers`: does `claude -p <query>` pick the skill up? */
export async function triggersCommand(
  args: CommonArgs & {
    dir: string;
    queries?: string;
    runs?: number;
    concurrency?: number;
    description?: string;
    maxTurns?: number;
    timeout?: number;
    json?: boolean;
  },
): Promise<number> {
  try {
    const dir = resolve(args.dir);
    const doc = loadDoc(dir);
    const queriesPath = resolve(args.queries ?? join(dir, TRIGGER_QUERIES_FILE));
    if (!existsSync(queriesPath))
      throw new Error(`no trigger queries at ${queriesPath} (run \`skillgraph eval queries\`)`);
    const queries = parseTriggerQueries(readJson(queriesPath));
    const out = await runTriggerEvals({
      doc,
      queries,
      description: args.description,
      runs: args.runs,
      concurrency: args.concurrency,
      model: args.model,
      maxTurns: args.maxTurns,
      timeoutMs: args.timeout ? args.timeout * 1000 : undefined,
      onResult: (r) => {
        if (args.json) return;
        const mark = r.pass ? pc.green('pass') : pc.red('FAIL');
        console.log(`  ${mark} ${r.triggered ? 'triggered' : 'no trigger'}  ${r.query}`);
        for (const err of r.errors ?? []) console.log(pc.red(`       run failed: ${err}`));
      },
    });
    const path = writeTriggerResults(dir, out);
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else
      console.log(
        pc.bold(
          `${out.summary.passed}/${out.summary.total} passed (${Math.round(out.summary.pass_rate * 100)}%) -> ${path}`,
        ),
      );
    return out.summary.failed > 0 ? 1 : 0;
  } catch (e) {
    return fail(e);
  }
}

/** `eval optimize`: iterate on the entry description until the trigger evals pass. */
export async function optimizeCommand(
  args: CommonArgs & {
    dir: string;
    queries?: string;
    iterations?: number;
    holdout?: number;
    seed?: number;
    runs?: number;
    concurrency?: number;
    apply?: boolean;
    json?: boolean;
  },
): Promise<number> {
  try {
    const dir = resolve(args.dir);
    const doc = loadDoc(dir);
    const queriesPath = resolve(args.queries ?? join(dir, TRIGGER_QUERIES_FILE));
    if (!existsSync(queriesPath))
      throw new Error(`no trigger queries at ${queriesPath} (run \`skillgraph eval queries\`)`);
    const queries = parseTriggerQueries(readJson(queriesPath));
    const port = ai(args);
    const out = await optimizeDescription({
      doc,
      queries,
      ai: port,
      maxIterations: args.iterations,
      holdout: args.holdout,
      seed: args.seed,
      evaluate: (description, qs) =>
        runTriggerEvals({
          doc,
          queries: qs,
          description,
          runs: args.runs,
          concurrency: args.concurrency,
          model: args.model,
        }),
      onIteration: (it) => {
        if (args.json) return;
        console.log(
          pc.bold(`iteration ${it.iteration}`),
          `train ${it.train.summary.passed}/${it.train.summary.total}`,
          it.test ? `test ${it.test.summary.passed}/${it.test.summary.total}` : '',
        );
        console.log(pc.dim(`  ${it.description}`));
      },
    });
    const path = writeDescriptionHistory(dir, out);
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else
      console.log(pc.green(`best ${out.best_score} (iteration ${out.best_iteration}) -> ${path}`));
    if (args.apply) {
      applyDescription(dir, out.best_description);
      console.log(pc.green(`applied best description to ${dir}`));
    }
    return 0;
  } catch (e) {
    return fail(e);
  }
}

/** `eval run`: task evals (with_skill vs without_skill) + benchmark. */
export async function runCommand(
  args: CommonArgs & {
    dir: string;
    runs?: number;
    baseline?: boolean;
    only?: string;
    maxTurns?: number;
    timeout?: number;
    out?: string;
    trace?: boolean;
    aiAlign?: boolean;
    json?: boolean;
  },
): Promise<number> {
  try {
    const dir = resolve(args.dir);
    const doc = loadDoc(dir);
    const suite = readEvalSuite(dir);
    const out = await runTaskEvals({
      doc,
      skillDir: dir,
      suite,
      ai: ai(args),
      runs: args.runs,
      baseline: args.baseline !== false,
      only: args.only ? args.only.split(',').map((s) => s.trim()) : undefined,
      model: args.model,
      maxTurns: args.maxTurns,
      timeoutMs: args.timeout ? args.timeout * 1000 : undefined,
      outDir: args.out ? resolve(args.out) : undefined,
      trace: args.trace,
      aiAlign: args.aiAlign,
      onRun: (r) => {
        if (!args.json) console.log(`  ${reportLine(r)}`);
      },
    });
    if (args.json) console.log(JSON.stringify(out.benchmark, null, 2));
    else {
      const s = out.benchmark.run_summary;
      console.log(pc.bold(`benchmark -> ${join(out.runDir, 'benchmark.json')}`));
      console.log(
        `  with_skill    ${((s.with_skill?.pass_rate.mean ?? 0) * 100).toFixed(0)}%`,
        `\n  without_skill ${((s.without_skill?.pass_rate.mean ?? 0) * 100).toFixed(0)}%`,
        `\n  delta         ${s.delta?.pass_rate ?? '—'}`,
      );
    }
    return 0;
  } catch (e) {
    return fail(e);
  }
}

/** `eval heatmap`: per-node coverage from the recorded traces. */
export function heatmapCommand(args: { dir: string; json?: boolean }): number {
  try {
    const dir = resolve(args.dir);
    const doc = loadDoc(dir);
    const traces = readTraces(dir);
    const heatmap = aggregateTraces(dir);
    if (args.json) {
      console.log(JSON.stringify({ runs: traces.length, heatmap }, null, 2));
      return 0;
    }
    console.log(pc.bold(`${entryOf(doc).name}: ${traces.length} trace(s)`));
    if (traces.length === 0) {
      console.log(pc.dim('  no traces yet (run `skillgraph eval run --trace`)'));
      return 0;
    }
    for (const node of [...doc.nodes].sort((a, b) => a.order - b.order)) {
      const entry = heatmap[node.id];
      const ratio = entry?.ratio ?? 0;
      const bar = '█'.repeat(Math.round(ratio * 10)).padEnd(10, '·');
      const label = `${node.kind}:${node.id}`;
      const line = `  ${bar} ${(ratio * 100).toFixed(0).padStart(3)}%  ${label}`;
      console.log(ratio === 0 ? pc.dim(line) : line);
    }
    return 0;
  } catch (e) {
    return fail(e);
  }
}

const int = (v: string) => Number.parseInt(v, 10);
const num = (v: string) => Number.parseFloat(v);

export function registerEvalCommand(program: Command): void {
  const evalCmd = program
    .command('eval')
    .description('Trigger and task evals for a skill (needs the `claude` CLI and an API key)');

  evalCmd
    .command('queries')
    .description('Generate trigger queries for the skill description')
    .argument('<dir>', 'skill folder')
    .option('-n, --count <n>', 'how many queries (default 20)', int)
    .option('-o, --out <file>', `output file (default: <dir>/${TRIGGER_QUERIES_FILE})`)
    .option('-k, --key <key>', 'Anthropic API key (default: ANTHROPIC_API_KEY)')
    .option('-b, --backend <backend>', 'api | claude | auto (claude = local Claude Code login)')
    .option('-m, --model <model>', 'model for the AI calls')
    .option('--json', 'print JSON instead of writing the file')
    .action(async (dir, opts) => process.exit(await queriesCommand({ dir, ...opts })));

  evalCmd
    .command('triggers')
    .description('Run the trigger evals: does Claude Code pick this skill up?')
    .argument('<dir>', 'skill folder')
    .option('-q, --queries <file>', `queries file (default: <dir>/${TRIGGER_QUERIES_FILE})`)
    .option('-r, --runs <n>', 'runs per query, majority vote (default 3)', int)
    .option('-c, --concurrency <n>', 'parallel `claude` processes (default 4)', int)
    .option('-d, --description <text>', 'candidate description to test instead of the graph one')
    .option('--max-turns <n>', 'max turns per run (default 3)', int)
    .option('--timeout <seconds>', 'per-run timeout in seconds', num)
    .option('-m, --model <model>', 'model for the executor runs')
    .option('--json', 'machine-readable output')
    .action(async (dir, opts) => process.exit(await triggersCommand({ dir, ...opts })));

  evalCmd
    .command('optimize')
    .description('Iterate on the description until the trigger evals pass (train/test split)')
    .argument('<dir>', 'skill folder')
    .option('-q, --queries <file>', `queries file (default: <dir>/${TRIGGER_QUERIES_FILE})`)
    .option('-i, --iterations <n>', 'max iterations (default 5)', int)
    .option('--holdout <ratio>', 'test split ratio (default 0.4)', num)
    .option('--seed <n>', 'split seed (default 42)', int)
    .option('-r, --runs <n>', 'runs per query (default 3)', int)
    .option('-c, --concurrency <n>', 'parallel `claude` processes (default 4)', int)
    .option('--apply', 'write the best description back into SKILL.graph.json and recompile')
    .option('-k, --key <key>', 'Anthropic API key (default: ANTHROPIC_API_KEY)')
    .option('-b, --backend <backend>', 'api | claude | auto (claude = local Claude Code login)')
    .option('-m, --model <model>', 'model for the AI calls')
    .option('--json', 'machine-readable output')
    .action(async (dir, opts) => process.exit(await optimizeCommand({ dir, ...opts })));

  evalCmd
    .command('run')
    .description('Run the task evals from evals/evals.json and write a benchmark')
    .argument('<dir>', 'skill folder')
    .option('-r, --runs <n>', 'runs per configuration (default 1)', int)
    .option('--no-baseline', 'skip the without_skill configuration')
    .option('--only <ids>', 'comma-separated eval ids to run')
    .option('--max-turns <n>', 'max turns per run', int)
    .option('--timeout <seconds>', 'per-run timeout in seconds', num)
    .option('-o, --out <dir>', 'run root (default: <dir>/evals/runs/<timestamp>)')
    .option('--trace', 'record node traces for the with_skill runs')
    .option('--ai-align', 'use the AI aligner on top of the deterministic trace mapping')
    .option('-k, --key <key>', 'Anthropic API key (default: ANTHROPIC_API_KEY)')
    .option('-b, --backend <backend>', 'api | claude | auto (claude = local Claude Code login)')
    .option('-m, --model <model>', 'model for the executor and grader')
    .option('--json', 'print benchmark.json')
    .action(async (dir, opts) => process.exit(await runCommand({ dir, ...opts })));

  evalCmd
    .command('heatmap')
    .description('Per-node coverage across the recorded traces')
    .argument('<dir>', 'skill folder')
    .option('--json', 'machine-readable output')
    .action((dir, opts) => process.exit(heatmapCommand({ dir, ...opts })));
}
