import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TriggerEvalResult, TriggerQuery } from '@skillgraph/ai';
import { compile, contentHash, migrate, type SkillDoc } from '@skillgraph/core';
import { graphPath, readJson, writeFiles, writeJson } from '../fs';
import type { AiPort } from './ai-port';
import { summarize, type TriggerEvalOutput, type TriggerSummary } from './triggers';
import { entryOf } from './workspace';

/** mulberry32: small deterministic PRNG so the split is reproducible for a given seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** Stratified train/test split (by should_trigger), mirroring run_loop.py's split_eval_set. */
export function splitEvalSet(
  queries: TriggerQuery[],
  holdout = 0.4,
  seed = 42,
): { train: TriggerQuery[]; test: TriggerQuery[] } {
  if (holdout <= 0) return { train: [...queries], test: [] };
  const rand = seededRandom(seed);
  const trigger = shuffle(
    queries.filter((q) => q.should_trigger),
    rand,
  );
  const noTrigger = shuffle(
    queries.filter((q) => !q.should_trigger),
    rand,
  );
  const nTriggerTest = trigger.length === 0 ? 0 : Math.max(1, Math.floor(trigger.length * holdout));
  const nNoTriggerTest =
    noTrigger.length === 0 ? 0 : Math.max(1, Math.floor(noTrigger.length * holdout));
  return {
    test: [...trigger.slice(0, nTriggerTest), ...noTrigger.slice(0, nNoTriggerTest)],
    train: [...trigger.slice(nTriggerTest), ...noTrigger.slice(nNoTriggerTest)],
  };
}

export interface OptimizeIteration {
  iteration: number;
  description: string;
  /** Why the optimizer proposed this description (absent for the original). */
  reasoning?: string;
  train: { results: TriggerEvalResult[]; summary: TriggerSummary };
  test: { results: TriggerEvalResult[]; summary: TriggerSummary } | null;
}

export interface OptimizeOutput {
  skill_name: string;
  exit_reason: string;
  original_description: string;
  best_description: string;
  best_iteration: number;
  best_score: string;
  best_train_score: string;
  best_test_score: string | null;
  final_description: string;
  iterations_run: number;
  holdout: number;
  train_size: number;
  test_size: number;
  iterations: OptimizeIteration[];
}

export interface OptimizeOptions {
  doc: SkillDoc;
  queries: TriggerQuery[];
  ai: Pick<AiPort, 'improveDescription'>;
  /** Evaluates a description against a set of queries (the trigger eval runner). */
  evaluate: (description: string, queries: TriggerQuery[]) => Promise<TriggerEvalOutput>;
  description?: string;
  maxIterations?: number;
  holdout?: number;
  seed?: number;
  onIteration?: (it: OptimizeIteration) => void;
}

function score(it: OptimizeIteration): [number, number] {
  return [it.test?.summary.passed ?? -1, it.train.summary.passed];
}

/** Pick the best iteration by test passed, then train passed; earlier wins ties. */
export function pickBest(iterations: OptimizeIteration[]): OptimizeIteration {
  let best = iterations[0];
  if (!best) throw new Error('no iterations');
  for (const it of iterations.slice(1)) {
    const [bt, btr] = score(best);
    const [t, tr] = score(it);
    if (t > bt || (t === bt && tr > btr)) best = it;
  }
  return best;
}

/** Eval + improve loop (run_loop.py): evaluate, stop when train all passes, else ask the model for a better description. */
export async function optimizeDescription(opts: OptimizeOptions): Promise<OptimizeOutput> {
  const entry = entryOf(opts.doc);
  const original = entry.description;
  let current = opts.description ?? original;
  const maxIterations = Math.max(1, opts.maxIterations ?? 5);
  const holdout = opts.holdout ?? 0.4;
  const { train, test } = splitEvalSet(opts.queries, holdout, opts.seed ?? 42);
  const trainQueries = new Set(train.map((q) => q.query));
  const iterations: OptimizeIteration[] = [];
  let reasoning: string | undefined;
  let exitReason = 'unknown';

  for (let i = 1; i <= maxIterations; i++) {
    const evaluated = await opts.evaluate(current, [...train, ...test]);
    const trainResults = evaluated.results.filter((r) => trainQueries.has(r.query));
    const testResults = evaluated.results.filter((r) => !trainQueries.has(r.query));
    const it: OptimizeIteration = {
      iteration: i,
      description: current,
      reasoning,
      train: { results: trainResults, summary: summarize(trainResults) },
      test: test.length > 0 ? { results: testResults, summary: summarize(testResults) } : null,
    };
    iterations.push(it);
    opts.onIteration?.(it);
    if (it.train.summary.failed === 0) {
      exitReason = `all_passed (iteration ${i})`;
      break;
    }
    if (i === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`;
      break;
    }
    // Test scores are never shown to the improver (blinded history).
    const history = iterations.map((h) => ({
      description: h.description,
      passRate: h.train.summary.pass_rate,
    }));
    const docWithCurrent: SkillDoc = {
      ...opts.doc,
      nodes: opts.doc.nodes.map((n) => (n.kind === 'entry' ? { ...n, description: current } : n)),
    };
    const proposal = await opts.ai.improveDescription({
      doc: docWithCurrent,
      results: trainResults,
      history,
    });
    current = proposal.description.trim();
    reasoning = proposal.reasoning;
  }

  const best = pickBest(iterations);
  const trainScore = `${best.train.summary.passed}/${best.train.summary.total}`;
  const testScore = best.test ? `${best.test.summary.passed}/${best.test.summary.total}` : null;
  return {
    skill_name: entry.name,
    exit_reason: exitReason,
    original_description: original,
    best_description: best.description,
    best_iteration: best.iteration,
    best_score: testScore ?? trainScore,
    best_train_score: trainScore,
    best_test_score: testScore,
    final_description: current,
    iterations_run: iterations.length,
    holdout,
    train_size: train.length,
    test_size: test.length,
    iterations,
  };
}

export const DESCRIPTION_HISTORY_FILE = 'evals/description-history.json';

export function writeDescriptionHistory(skillDir: string, out: OptimizeOutput): string {
  const path = join(skillDir, DESCRIPTION_HISTORY_FILE);
  writeJson(path, out);
  return path;
}

/** Write `description` into the entry node of SKILL.graph.json and recompile the folder. */
export function applyDescription(skillDir: string, description: string): string[] {
  const gp = graphPath(skillDir);
  if (!existsSync(gp)) throw new Error(`no SKILL.graph.json in ${skillDir}`);
  const file = migrate(readJson(gp));
  const nodes = file.doc.nodes.map((n) => (n.kind === 'entry' ? { ...n, description } : n));
  const doc: SkillDoc = { ...file.doc, nodes };
  const result = compile(doc);
  const written = writeFiles(skillDir, result.files, result.binaryFiles);
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(result.files)) hashes[rel] = contentHash(content);
  writeJson(gp, {
    ...file,
    doc,
    compiled: { profile: result.report.profile, at: new Date().toISOString(), files: hashes },
  });
  return written;
}
