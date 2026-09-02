import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Grading, TraceEvent } from '@skillgraph/ai';
import { type SkillDoc, SkillDocSchema } from '@skillgraph/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateResults,
  calculateStats,
  generateBenchmark,
  type RunResult,
} from '../src/eval/benchmark';
import {
  CLAUDE_BIN_ENV,
  type ClaudeRunResult,
  claudeBinary,
  detectSkillTrigger,
  parseStreamJson,
} from '../src/eval/claude-runner';
import { pickBest, seededRandom, splitEvalSet } from '../src/eval/optimize';
import { parseEvalSuite, runTaskEvals } from '../src/eval/tasks';
import { aggregateTraceFiles, mapEventsToNodes } from '../src/eval/trace';
import { majorityVote, runTriggerEvals, summarize } from '../src/eval/triggers';
import { createProject } from '../src/eval/workspace';
import { writeJson } from '../src/fs';

const tmp = () => mkdtempSync(join(tmpdir(), 'skillgraph-eval-test-'));

function doc(extra: Record<string, unknown>[] = [], name = 'demo-skill'): SkillDoc {
  return SkillDocSchema.parse({
    profile: 'claude-code',
    nodes: [
      {
        id: 'entry',
        kind: 'entry',
        name,
        description: 'Demo skill. Use when drawing a graph of something.',
        order: 0,
      },
      ...extra,
    ],
    edges: [],
  }) as SkillDoc;
}

// A realistic `claude -p --output-format stream-json --verbose` capture.
const STREAM = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1',
    model: 'claude-opus-5',
    tools: ['Read', 'Bash', 'Skill'],
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5',
      content: [
        { type: 'text', text: 'Let me use the skill.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Skill',
          input: { command: '/demo-skill draw the graph' },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [{ type: 'text', text: 'loaded' }],
        },
      ],
    },
  }),
  'not json at all',
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: 'references/a.md' } },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'nope', is_error: true }],
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 2,
    duration_ms: 4321,
    result: 'All done.',
    session_id: 'sess-1',
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 7,
    },
  }),
].join('\n');

describe('claude-runner', () => {
  it('parses stream-json into ordered events, tool counts and usage', () => {
    const p = parseStreamJson(STREAM);
    expect(p.model).toBe('claude-opus-5');
    expect(p.sessionId).toBe('sess-1');
    expect(p.events.map((e) => `${e.turn}:${e.type}:${e.tool ?? ''}`)).toEqual([
      '1:text:',
      '1:tool_use:Skill',
      '2:tool_use:Read',
    ]);
    expect(p.toolCalls).toEqual({ Skill: 1, Read: 1 });
    expect(p.totalToolCalls).toBe(2);
    expect(p.toolResults).toHaveLength(2);
    expect(p.toolResults[1]?.isError).toBe(true);
    expect(p.result).toBe('All done.');
    expect(p.numTurns).toBe(2);
    expect(p.totalTokens).toBe(132);
    expect(p.unparsed).toEqual(['not json at all']);
  });

  it('falls back to the last assistant text and counts turns without a result event', () => {
    const p = parseStreamJson(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    );
    expect(p.result).toBe('hi');
    expect(p.numTurns).toBe(1);
  });

  it('detects the skill trigger from Skill tool calls and direct SKILL.md reads', () => {
    const p = parseStreamJson(STREAM);
    expect(detectSkillTrigger(p.events, 'demo-skill')).toBe(true);
    expect(detectSkillTrigger(p.events, 'other-skill')).toBe(false);

    const byName: TraceEvent[] = [
      { turn: 1, type: 'tool_use', tool: 'Skill', input: { skill: 'plugin:demo-skill' } },
    ];
    expect(detectSkillTrigger(byName, 'demo-skill')).toBe(true);

    const byRead: TraceEvent[] = [
      {
        turn: 1,
        type: 'tool_use',
        tool: 'Read',
        input: { file_path: '/tmp/p/.claude/skills/demo-skill/SKILL.md' },
      },
    ];
    expect(detectSkillTrigger(byRead, 'demo-skill')).toBe(true);
    expect(detectSkillTrigger(byRead, 'nope')).toBe(false);

    const unrelated: TraceEvent[] = [
      { turn: 1, type: 'tool_use', tool: 'Bash', input: { command: 'ls' } },
      { turn: 1, type: 'text', text: 'I could use /demo-skill' },
    ];
    expect(detectSkillTrigger(unrelated, 'demo-skill')).toBe(false);
  });

  it('honours the binary override env var', () => {
    expect(claudeBinary({})).toBe('claude');
    expect(claudeBinary({ [CLAUDE_BIN_ENV]: '/bin/fake' })).toBe('/bin/fake');
  });
});

describe('triggers', () => {
  it('takes a majority vote over the runs', () => {
    expect(majorityVote([])).toBe(false);
    expect(majorityVote([true, false, false])).toBe(false);
    expect(majorityVote([true, true, false])).toBe(true);
    expect(majorityVote([true, false])).toBe(true); // 0.5 >= 0.5
    expect(majorityVote([true, false], 0.75)).toBe(false);
    expect(majorityVote([true, true, true, false], 0.75)).toBe(true);
  });

  it('summarises pass rates', () => {
    expect(
      summarize([
        { query: 'a', should_trigger: true, triggered: true, pass: true },
        { query: 'b', should_trigger: false, triggered: true, pass: false },
        { query: 'c', should_trigger: true, triggered: true, pass: true },
      ]),
    ).toEqual({ passed: 2, failed: 1, total: 3, pass_rate: 0.6667 });
  });

  it('runs an offline end-to-end trigger eval through the fake `claude` binary', async () => {
    const dir = tmp();
    const bin = join(dir, 'fake-claude.mjs');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
emit({ type: 'system', subtype: 'init', model: 'fake', session_id: 's' });
if (/graph/i.test(prompt)) {
  emit({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'demo-skill' } }] },
  });
} else {
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'no skill' }] } });
}
emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 3, result: 'ok' });
`,
      'utf8',
    );
    chmodSync(bin, 0o755);
    const previous = process.env[CLAUDE_BIN_ENV];
    process.env[CLAUDE_BIN_ENV] = bin;
    try {
      const out = await runTriggerEvals({
        doc: doc(),
        queries: [
          { query: 'draw me a graph of this skill', should_trigger: true },
          { query: 'what is the weather', should_trigger: false },
        ],
        runs: 3,
        concurrency: 2,
        baseDir: dir,
      });
      expect(out.skill_name).toBe('demo-skill');
      expect(out.results[0]?.runs).toEqual([true, true, true]);
      expect(out.results[0]?.triggered).toBe(true);
      expect(out.results[1]?.triggered).toBe(false);
      expect(out.summary).toEqual({ passed: 2, failed: 0, total: 2, pass_rate: 1 });
    } finally {
      if (previous === undefined) delete process.env[CLAUDE_BIN_ENV];
      else process.env[CLAUDE_BIN_ENV] = previous;
    }
  }, 30_000);
});

describe('optimize', () => {
  it('splits deterministically and keeps both classes in train and test', () => {
    const queries = Array.from({ length: 10 }, (_, i) => ({
      query: `q${i}`,
      should_trigger: i % 2 === 0,
    }));
    const a = splitEvalSet(queries, 0.4, 42);
    const b = splitEvalSet(queries, 0.4, 42);
    expect(a.test.map((q) => q.query)).toEqual(b.test.map((q) => q.query));
    expect(a.train.map((q) => q.query)).toEqual(b.train.map((q) => q.query));
    expect(a.test).toHaveLength(4);
    expect(a.train).toHaveLength(6);
    expect(a.test.filter((q) => q.should_trigger)).toHaveLength(2);
    expect(a.test.filter((q) => !q.should_trigger)).toHaveLength(2);
    // Every query lands in exactly one side.
    expect([...a.train, ...a.test].map((q) => q.query).sort()).toEqual(
      queries.map((q) => q.query).sort(),
    );
    // A different seed shuffles differently, a zero holdout keeps everything for training.
    expect(splitEvalSet(queries, 0.4, 7).test.map((q) => q.query)).not.toEqual(
      a.test.map((q) => q.query),
    );
    expect(splitEvalSet(queries, 0).test).toEqual([]);
  });

  it('has a reproducible PRNG', () => {
    const a = Array.from({ length: 4 }, seededRandom(1));
    const b = Array.from({ length: 4 }, seededRandom(1));
    expect(a).toEqual(b);
  });

  it('picks the best iteration by test then train score', () => {
    const it = (n: number, testPassed: number, trainPassed: number) => ({
      iteration: n,
      description: `d${n}`,
      train: {
        results: [],
        summary: { passed: trainPassed, failed: 0, total: 5, pass_rate: trainPassed / 5 },
      },
      test: {
        results: [],
        summary: { passed: testPassed, failed: 0, total: 4, pass_rate: testPassed / 4 },
      },
    });
    expect(pickBest([it(1, 2, 5), it(2, 3, 1), it(3, 3, 4)]).iteration).toBe(3);
    expect(pickBest([it(1, 3, 4), it(2, 3, 4)]).iteration).toBe(1);
  });
});

describe('benchmark', () => {
  it('computes mean, sample stddev, min and max', () => {
    expect(calculateStats([])).toEqual({ mean: 0, stddev: 0, min: 0, max: 0 });
    expect(calculateStats([2])).toEqual({ mean: 2, stddev: 0, min: 2, max: 2 });
    expect(calculateStats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({
      mean: 5,
      stddev: 2.1381,
      min: 2,
      max: 9,
    });
  });

  it('aggregates per configuration and reports the signed delta', () => {
    const run = (pass: number, time: number, tokens: number): RunResult => ({
      eval_id: 1,
      run_number: 1,
      pass_rate: pass,
      passed: 0,
      failed: 0,
      total: 0,
      time_seconds: time,
      tokens,
      tool_calls: 0,
      errors: 0,
      expectations: [],
      notes: [],
    });
    const summary = aggregateResults({
      without_skill: [run(0.3, 20, 1000), run(0.5, 30, 2000)],
      with_skill: [run(0.8, 40, 3000), run(1, 50, 5000)],
    });
    expect(summary.with_skill?.pass_rate.mean).toBe(0.9);
    expect(summary.without_skill?.pass_rate.mean).toBe(0.4);
    expect(summary.delta).toEqual({
      pass_rate: '+0.50',
      time_seconds: '+20.0',
      tokens: '+2500',
    });
  });

  it('walks a run tree into benchmark.json', () => {
    const dir = tmp();
    const write = (config: string, run: number, passed: number, tokens: number) => {
      const runDir = join(dir, 'eval-1', config, `run-${run}`);
      writeJson(join(runDir, 'grading.json'), {
        expectations: [{ text: 'x', passed: passed > 0, evidence: 'e' }],
        summary: { passed, failed: 2 - passed, total: 2, pass_rate: passed / 2 },
        execution_metrics: { total_tool_calls: 4, errors_encountered: 0 },
        user_notes_summary: { uncertainties: ['maybe'] },
      });
      writeJson(join(runDir, 'timing.json'), {
        total_tokens: tokens,
        total_duration_seconds: 10,
      });
    };
    writeJson(join(dir, 'eval-1', 'eval_metadata.json'), { eval_id: 7, eval_name: 'Ocean' });
    write('with_skill', 1, 2, 4000);
    write('with_skill', 2, 1, 4000);
    write('without_skill', 1, 0, 2000);

    const b = generateBenchmark(dir, { skill_name: 'demo-skill' });
    expect(b.metadata.skill_name).toBe('demo-skill');
    expect(b.metadata.evals_run).toEqual([7]);
    expect(b.runs).toHaveLength(3);
    expect(b.runs[0]?.configuration).toBe('with_skill');
    expect(b.runs[0]?.eval_name).toBe('Ocean');
    expect(b.runs[0]?.result.tokens).toBe(4000);
    expect(b.runs[0]?.notes).toEqual(['maybe']);
    expect(b.run_summary.with_skill?.pass_rate.mean).toBe(0.75);
    expect(b.run_summary.without_skill?.pass_rate.mean).toBe(0);
    expect(b.run_summary.delta?.pass_rate).toBe('+0.75');
  });
});

describe('trace', () => {
  const traceDoc = doc([
    { id: 'ref1', kind: 'reference', path: 'references/style.md', order: 1 },
    { id: 'script1', kind: 'script', path: 'scripts/check.sh', code: 'echo hi', order: 2 },
    { id: 'ask1', kind: 'ask_user', question: 'Which format do you want?', order: 3 },
    { id: 'call1', kind: 'skill_call', skill: 'other-skill', order: 4 },
    { id: 'del1', kind: 'delegate', agentType: 'reviewer', task: 'review the diff', order: 5 },
  ]);

  it('maps tool calls to nodes deterministically', () => {
    const events: TraceEvent[] = [
      { turn: 1, type: 'text', text: 'thinking' },
      { turn: 1, type: 'tool_use', tool: 'Read', input: { file_path: 'references/style.md' } },
      {
        turn: 2,
        type: 'tool_use',
        tool: 'Bash',
        input: { command: 'bash scripts/check.sh --fast' },
      },
      {
        turn: 3,
        type: 'tool_use',
        tool: 'AskUserQuestion',
        input: { questions: [{ question: 'Which format do you want?' }] },
      },
      { turn: 4, type: 'tool_use', tool: 'Skill', input: { skill: '/other-skill' } },
      {
        turn: 5,
        type: 'tool_use',
        tool: 'Task',
        input: { subagent_type: 'reviewer', description: 'review the diff' },
      },
      { turn: 6, type: 'tool_use', tool: 'Read', input: { file_path: 'references/missing.md' } },
    ];
    const visits = mapEventsToNodes(traceDoc, events);
    expect(visits.map((v) => [v.nodeId, v.turn])).toEqual([
      ['ref1', 1],
      ['script1', 2],
      ['ask1', 3],
      ['call1', 4],
      ['del1', 5],
    ]);
    expect(visits[0]?.confidence).toBe(1);
    // Same input, same output.
    expect(mapEventsToNodes(traceDoc, events)).toEqual(visits);
  });

  it('aggregates per-node coverage across traces', () => {
    const heat = aggregateTraceFiles([
      {
        evalId: 1,
        run: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        events: [],
        visits: [
          { nodeId: 'ref1', turn: 1, evidence: 'a', confidence: 1 },
          { nodeId: 'ref1', turn: 3, evidence: 'a', confidence: 1 },
          { nodeId: 'script1', turn: 2, evidence: 'b', confidence: 1 },
        ],
      },
      {
        evalId: 1,
        run: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        events: [],
        visits: [{ nodeId: 'ref1', turn: 1, evidence: 'a', confidence: 1 }],
      },
    ]);
    expect(heat.ref1).toEqual({ visits: 2, runs: 2, ratio: 1 });
    expect(heat.script1).toEqual({ visits: 1, runs: 2, ratio: 0.5 });
    expect(heat.ask1).toBeUndefined();
  });
});

describe('workspace', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it('installs the compiled skill under .claude/skills/<name>/ and copies input files', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'sample.txt'), 'hello', 'utf8');
    const project = createProject({
      doc: doc(),
      withSkill: true,
      description: 'A replacement description for the trigger eval.',
      skillRoot: dir,
      files: ['sample.txt', 'missing.txt'],
      baseDir: dir,
    });
    cleanups.push(project.cleanup);
    expect(project.name).toBe('demo-skill');
    const skillMd = join(project.root, '.claude', 'skills', 'demo-skill', 'SKILL.md');
    expect(existsSync(skillMd)).toBe(true);
    expect(readFileSync(skillMd, 'utf8')).toContain('A replacement description');
    expect(project.inputs).toEqual(['inputs/sample.txt']);
    expect(readFileSync(join(project.root, 'inputs', 'sample.txt'), 'utf8')).toBe('hello');
  });

  it('leaves the skill out of a baseline project', () => {
    const dir = tmp();
    const project = createProject({ doc: doc(), withSkill: false, baseDir: dir });
    cleanups.push(project.cleanup);
    expect(existsSync(join(project.root, '.claude'))).toBe(true);
    expect(existsSync(join(project.root, '.claude', 'skills'))).toBe(false);
  });
});

describe('tasks', () => {
  it('validates evals.json', () => {
    expect(() => parseEvalSuite({ evals: 'nope' })).toThrow();
    expect(() => parseEvalSuite({ evals: [{ prompt: 'x' }] })).toThrow(/expectations/);
    const suite = parseEvalSuite({
      skill_name: 'demo-skill',
      evals: [{ prompt: 'do it', expectations: ['works'] }],
    });
    expect(suite.evals[0]?.id).toBe(1);
  });

  it('writes the per-run artifacts and a benchmark for both configurations', async () => {
    const dir = tmp();
    const grading: Grading = {
      expectations: [{ text: 'works', passed: true, evidence: 'saw it' }],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
    };
    const runner = async (opts: { cwd: string; prompt: string }): Promise<ClaudeRunResult> => {
      writeFileSync(join(opts.cwd, 'report.md'), `# report for ${opts.prompt}\n`, 'utf8');
      return {
        events: [
          { turn: 1, type: 'tool_use', tool: 'Write', input: { file_path: 'report.md' } },
          { turn: 1, type: 'text', text: 'wrote the report' },
        ],
        toolResults: [],
        result: 'wrote the report',
        isError: false,
        numTurns: 1,
        toolCalls: { Write: 1 },
        totalToolCalls: 1,
        unparsed: [],
        totalTokens: 1234,
        durationMs: 1000,
        exitCode: 0,
        timedOut: false,
        stderr: '',
        stdout: '',
        command: ['fake'],
      };
    };
    const out = await runTaskEvals({
      doc: doc(),
      skillDir: dir,
      suite: {
        skill_name: 'demo-skill',
        evals: [{ id: 1, prompt: 'write a report', expectations: ['works'] }],
      },
      ai: {
        grade: async () => grading,
        alignTrace: async () => ({ visits: [] }),
      },
      runs: 2,
      runner,
      baseDir: dir,
      outDir: join(dir, 'runs'),
    });
    expect(out.reports).toHaveLength(4); // 2 configs x 2 runs
    const runDir = join(dir, 'runs', 'eval-1', 'with_skill', 'run-1');
    for (const f of ['transcript.md', 'metrics.json', 'timing.json', 'grading.json'])
      expect(existsSync(join(runDir, f))).toBe(true);
    expect(existsSync(join(runDir, 'outputs', 'report.md'))).toBe(true);
    expect(existsSync(join(runDir, 'outputs', 'metrics.json'))).toBe(true);
    expect(existsSync(join(dir, 'runs', 'eval-1', 'eval_metadata.json'))).toBe(true);
    expect(readFileSync(join(runDir, 'transcript.md'), 'utf8')).toContain('write a report');
    expect(out.benchmark.runs).toHaveLength(4);
    expect(out.benchmark.run_summary.with_skill?.pass_rate.mean).toBe(1);
    expect(out.benchmark.run_summary.with_skill?.tokens.mean).toBe(1234);
    expect(existsSync(join(dir, 'runs', 'benchmark.json'))).toBe(true);
    expect(readFileSync(join(dir, 'runs', 'benchmark.md'), 'utf8')).toContain(
      '# Skill Benchmark: demo-skill',
    );
  });
});
