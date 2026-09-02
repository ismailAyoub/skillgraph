import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  type Ai,
  type AiOptions,
  type CopilotIntent,
  createAi,
  isAiError,
  type Proposal,
  type TriggerQuery,
} from '@skillgraph/ai';
import {
  applyPatch,
  compile,
  contentHash,
  type GraphPatchT,
  lint,
  migrate,
  type SkillFile,
} from '@skillgraph/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { graphPath, readJson, writeFiles, writeJson } from '../fs';
import { printDiagnostics } from '../report';

const COPILOT_INTENTS: CopilotIntent[] = [
  'rewrite-imperative',
  'add-why',
  'split-steps',
  'draft-reference',
  'draft-script',
  'tighten',
  'custom',
];

/** Options every `skillgraph ai` subcommand accepts. */
interface CommonOpts {
  key?: string;
  model?: string;
  json?: boolean;
  apply?: boolean;
}

interface LoadedGraph {
  dir: string;
  gp: string;
  file: SkillFile;
}

function loadGraph(dirArg: string): LoadedGraph {
  const dir = resolve(dirArg);
  const gp = graphPath(dir);
  if (!existsSync(gp)) {
    throw new CliError(`No SKILL.graph.json in ${dir}. Run \`skillgraph import ${dirArg}\` first.`);
  }
  return { dir, gp, file: migrate(readJson(gp)) };
}

/** A message the user should see, without a stack trace. */
class CliError extends Error {}

function makeAi(opts: CommonOpts): Ai {
  const apiKey = opts.key ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new CliError('Set ANTHROPIC_API_KEY or pass --key');
  const options: AiOptions = { apiKey };
  if (opts.model) options.model = opts.model;
  return createAi(options);
}

/** Apply a patch to the graph, save it and recompile the skill folder (mirrors `compile`). */
function applyAndRecompile(loaded: LoadedGraph, patch: GraphPatchT, quiet = false): SkillFile {
  const { doc } = applyPatch(loaded.file.doc, patch);
  const next: SkillFile = { ...loaded.file, doc };
  const result = compile(doc);
  const written = writeFiles(loaded.dir, result.files, result.binaryFiles);
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(result.files)) hashes[rel] = contentHash(content);
  writeJson(loaded.gp, {
    ...next,
    compiled: { profile: result.report.profile, at: new Date().toISOString(), files: hashes },
  });
  loaded.file = next;
  if (!quiet) {
    console.log(
      pc.green(
        `Applied ${patch.ops.length} op(s) → ${written.length} file(s), ${result.report.lines} lines, ~${result.report.tokens} tokens`,
      ),
    );
    printDiagnostics(lint(doc, { compiled: result, dirName: loaded.dir.split('/').pop() }));
  }
  return next;
}

function describePatch(patch: GraphPatchT): string {
  return patch.ops
    .map((op) => {
      switch (op.op) {
        case 'add':
          return `  add ${op.node.kind} ${op.node.id}`;
        case 'update':
          return `  update ${op.id} (${Object.keys(op.data).join(', ')})`;
        case 'remove':
          return `  remove ${op.id}`;
        case 'move':
          return `  move ${op.id} → parent ${op.parentId ?? 'root'} order ${op.order}`;
        case 'addEdge':
          return `  addEdge ${op.edge.source} -${op.edge.kind}-> ${op.edge.target}`;
        case 'updateEdge':
          return `  updateEdge ${op.id}`;
        case 'removeEdge':
          return `  removeEdge ${op.id}`;
        case 'setProfile':
          return `  setProfile ${op.profile}`;
        case 'restore':
          return `  restore ${op.node.id}`;
        default:
          return '  (unknown op)';
      }
    })
    .join('\n');
}

function printProposal(proposal: Proposal): void {
  console.log(pc.bold('Rationale'));
  console.log(`  ${proposal.rationale}`);
  console.log(pc.bold(`Patch (${proposal.patch.ops.length} op(s))`));
  console.log(describePatch(proposal.patch) || '  (empty)');
}

/** Print or apply a proposal; returns the process exit code. */
function settle(loaded: LoadedGraph, proposal: Proposal, opts: CommonOpts): number {
  if (opts.json) {
    console.log(JSON.stringify(proposal, null, 2));
    if (!opts.apply) return 0;
  } else {
    printProposal(proposal);
  }
  if (!opts.apply) {
    if (proposal.patch.ops.length > 0 && !opts.json) {
      console.log(pc.dim('Re-run with --apply to write these changes.'));
    }
    return 0;
  }
  if (proposal.patch.ops.length === 0) return 0;
  applyAndRecompile(loaded, proposal.patch, opts.json);
  return 0;
}

function entryId(file: SkillFile): string {
  const entry = file.doc.nodes.find((n) => n.kind === 'entry');
  if (!entry) throw new CliError('The graph has no entry node.');
  return entry.id;
}

function writeQueries(out: string | undefined, queries: TriggerQuery[]): void {
  if (!out) return;
  writeJson(resolve(out), queries);
  console.log(pc.dim(`Wrote ${queries.length} trigger queries to ${resolve(out)}`));
}

// --- subcommand implementations -------------------------------------------------

async function critiqueCommand(dir: string, opts: CommonOpts & { pick?: string }): Promise<number> {
  const loaded = loadGraph(dir);
  const ai = makeAi(opts);
  const result = await ai.critique({ doc: loaded.file.doc });
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(pc.bold('Summary'));
    console.log(`  ${result.summary}`);
    result.findings.forEach((f, i) => {
      const tag =
        f.severity === 'error'
          ? pc.red('error')
          : f.severity === 'warning'
            ? pc.yellow('warn ')
            : pc.cyan('info ');
      const where = f.nodeId ? pc.dim(` [${f.nodeId}]`) : '';
      console.log(`\n${pc.bold(`#${i + 1}`)} ${tag} ${pc.dim(f.rule)} ${f.message}${where}`);
      if (f.patch) console.log(describePatch(f.patch));
    });
    console.log(`\n${result.findings.length} finding(s)`);
  }
  if (!opts.apply) {
    if (result.findings.some((f) => f.patch) && !opts.json) {
      console.log(
        pc.dim('Re-run with --apply (and --pick <n> for one finding) to write the fixes.'),
      );
    }
    return 0;
  }
  const picked = opts.pick
    ? opts.pick
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
    : result.findings.map((_, i) => i + 1);
  const ops = picked.flatMap((n) => result.findings[n - 1]?.patch?.ops ?? []);
  if (ops.length === 0) {
    console.log(pc.yellow('Nothing to apply: the picked findings carry no patch.'));
    return 0;
  }
  applyAndRecompile(loaded, { ops }, opts.json);
  return 0;
}

async function describeCommand(
  dir: string,
  opts: CommonOpts & { pick?: string; out?: string },
): Promise<number> {
  const loaded = loadGraph(dir);
  const ai = makeAi(opts);
  const result = await ai.describe({ doc: loaded.file.doc });
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    result.candidates.forEach((c, i) => {
      console.log(`\n${pc.bold(`#${i + 1}`)} ${c.description}`);
      console.log(pc.dim(`   ${c.rationale}`));
    });
    console.log(`\n${result.triggerQueries.length} trigger query/queries`);
  }
  writeQueries(opts.out, result.triggerQueries);
  if (!opts.apply) {
    if (!opts.json) console.log(pc.dim('Re-run with --apply --pick <n> to set the description.'));
    return 0;
  }
  const index = opts.pick ? Number.parseInt(opts.pick, 10) : 1;
  const candidate = result.candidates[index - 1];
  if (!candidate) throw new CliError(`No candidate #${index}; got ${result.candidates.length}.`);
  applyAndRecompile(
    loaded,
    {
      ops: [
        { op: 'update', id: entryId(loaded.file), data: { description: candidate.description } },
      ],
    },
    opts.json,
  );
  return 0;
}

async function queriesCommand(
  dir: string,
  opts: CommonOpts & { count?: string; out?: string },
): Promise<number> {
  const loaded = loadGraph(dir);
  const ai = makeAi(opts);
  const count = opts.count ? Number.parseInt(opts.count, 10) : undefined;
  const queries = await ai.triggerQueries({
    doc: loaded.file.doc,
    ...(count !== undefined && Number.isFinite(count) ? { count } : {}),
  });
  if (opts.json) {
    console.log(JSON.stringify(queries, null, 2));
  } else {
    for (const q of queries) {
      console.log(`${q.should_trigger ? pc.green('trigger   ') : pc.dim('no-trigger')} ${q.query}`);
    }
  }
  writeQueries(opts.out, queries);
  return 0;
}

async function copilotCommand(
  dir: string,
  opts: CommonOpts & { node?: string; intent?: string; instruction?: string },
): Promise<number> {
  const loaded = loadGraph(dir);
  if (!opts.node) throw new CliError('Pass the target node with --node <id>');
  const intent = (opts.intent ?? 'tighten') as CopilotIntent;
  if (!COPILOT_INTENTS.includes(intent)) {
    throw new CliError(`Unknown --intent ${intent}. One of: ${COPILOT_INTENTS.join(', ')}`);
  }
  const ai = makeAi(opts);
  const proposal = await ai.copilot({
    doc: loaded.file.doc,
    nodeId: opts.node,
    intent,
    ...(opts.instruction ? { instruction: opts.instruction } : {}),
  });
  return settle(loaded, proposal, opts);
}

async function interviewCommand(dir: string, opts: CommonOpts): Promise<number> {
  const loaded = loadGraph(dir);
  const ai = makeAi(opts);
  const rl = createInterface({ input, output });
  const transcript: { role: 'assistant' | 'user'; content: string }[] = [];
  try {
    for (let turn = 0; turn < 40; turn += 1) {
      const step = await ai.interview({ doc: loaded.file.doc, transcript });
      if (step.rationale) console.log(pc.dim(step.rationale));
      if (step.patch && step.patch.ops.length > 0) {
        if (opts.apply) applyAndRecompile(loaded, step.patch);
        else {
          console.log(pc.bold(`Proposed patch (${step.patch.ops.length} op(s), not applied)`));
          console.log(describePatch(step.patch));
        }
      }
      if (step.done || !step.question) {
        console.log(pc.green(`Interview complete (confidence ${step.confidence.toFixed(2)}).`));
        if (!opts.apply) console.log(pc.dim('Re-run with --apply to write the proposed changes.'));
        return 0;
      }
      console.log(`\n${pc.bold(step.question)}`);
      const answer = await rl.question('> ');
      if (['/quit', '/q', 'exit'].includes(answer.trim().toLowerCase())) {
        console.log(pc.dim('Stopped.'));
        return 0;
      }
      transcript.push(
        { role: 'assistant', content: step.question },
        { role: 'user', content: answer },
      );
    }
    console.log(pc.yellow('Reached the interview turn limit.'));
    return 0;
  } finally {
    rl.close();
  }
}

async function fromTranscriptCommand(
  dir: string,
  fileArg: string,
  opts: CommonOpts,
): Promise<number> {
  const loaded = loadGraph(dir);
  const path = resolve(fileArg);
  if (!existsSync(path)) throw new CliError(`No such transcript file: ${path}`);
  const ai = makeAi(opts);
  const proposal = await ai.fromTranscript({
    doc: loaded.file.doc,
    transcript: readFileSync(path, 'utf8'),
  });
  return settle(loaded, proposal, opts);
}

async function importFallbackCommand(
  dir: string,
  opts: CommonOpts & { node?: string },
): Promise<number> {
  const loaded = loadGraph(dir);
  const ai = makeAi(opts);
  const rawNodeIds = opts.node
    ? opts.node
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const proposal = await ai.decompileFallback({
    doc: loaded.file.doc,
    ...(rawNodeIds ? { rawNodeIds } : {}),
  });
  if (proposal.patch.ops.length === 0 && !opts.json) {
    console.log(pc.green('Nothing to convert: no raw_markdown nodes left.'));
    return 0;
  }
  return settle(loaded, proposal, opts);
}

/** Run a subcommand, turning AiError and CliError into a clean message + exit code 1. */
async function run(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    if (isAiError(err)) {
      const hint = err.code === 'auth' ? 'Set ANTHROPIC_API_KEY or pass --key' : err.message;
      console.error(pc.red(`${err.code}: ${hint}`));
      return 1;
    }
    if (err instanceof CliError) {
      console.error(pc.red(err.message));
      return 1;
    }
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}

/** Add the `skillgraph ai` command group. Wire with `registerAiCommand(program)`. */
export function registerAiCommand(program: Command): void {
  const ai = program
    .command('ai')
    .description(
      'AI assistance: critique, describe, copilot, interview, transcript and import fallback',
    );

  const common = <T extends Command>(cmd: T): T => {
    cmd
      .option('-k, --key <key>', 'Anthropic API key (default: $ANTHROPIC_API_KEY)')
      .option('-m, --model <model>', 'model id (default: claude-opus-5)')
      .option('--json', 'machine-readable output');
    return cmd;
  };

  common(
    ai
      .command('critique')
      .description('Review the skill and propose fixes')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .option('--apply', 'apply the proposed patches and recompile')
      .option('--pick <n>', 'with --apply: only these finding numbers (comma-separated)'),
  ).action(async (dir, opts) => process.exit(await run(() => critiqueCommand(dir, opts))));

  common(
    ai
      .command('describe')
      .description('Write description candidates and trigger queries')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .option('--apply', 'set the entry description from the picked candidate')
      .option('--pick <n>', 'candidate number to apply (default: 1)')
      .option('-o, --out <file>', 'write the trigger queries as JSON here'),
  ).action(async (dir, opts) => process.exit(await run(() => describeCommand(dir, opts))));

  common(
    ai
      .command('queries')
      .description('Generate trigger-evaluation queries')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .option('-c, --count <n>', 'how many queries (default: 20)')
      .option('-o, --out <file>', 'write the queries as JSON here'),
  ).action(async (dir, opts) => process.exit(await run(() => queriesCommand(dir, opts))));

  common(
    ai
      .command('copilot')
      .description('Rewrite one node: tighten, add a why, split, draft a reference or script')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .requiredOption('-n, --node <id>', 'target node id')
      .option('-i, --intent <intent>', `one of: ${COPILOT_INTENTS.join(', ')}`, 'tighten')
      .option('--instruction <text>', 'extra guidance (required for --intent custom)')
      .option('--apply', 'apply the proposed patch and recompile'),
  ).action(async (dir, opts) => process.exit(await run(() => copilotCommand(dir, opts))));

  common(
    ai
      .command('interview')
      .description('Question-by-question interview that builds the graph')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .option('--apply', 'apply each proposed patch as the interview goes'),
  ).action(async (dir, opts) => process.exit(await run(() => interviewCommand(dir, opts))));

  common(
    ai
      .command('from-transcript')
      .description('Extract a reusable skill from a work transcript')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .argument('<file>', 'transcript or log file')
      .option('--apply', 'apply the proposed patch and recompile'),
  ).action(async (dir, file, opts) =>
    process.exit(await run(() => fromTranscriptCommand(dir, file, opts))),
  );

  common(
    ai
      .command('import-fallback')
      .description('Turn leftover raw_markdown nodes from an import into structured nodes')
      .argument('<dir>', 'skill folder containing SKILL.graph.json')
      .option('-n, --node <ids>', 'only these raw_markdown node ids (comma-separated)')
      .option('--apply', 'apply the proposed patch and recompile'),
  ).action(async (dir, opts) => process.exit(await run(() => importFallbackCommand(dir, opts))));
}
