import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { type GraphPatchT, type SkillDoc, SkillDocSchema, type SkillNode } from '@skillgraph/core';
import { type Ai, type AiOptions, createAi } from '../src/index';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** A recorded `messages.parse` response: only the fields `callStructured` reads. */
export interface RecordedResponse {
  stop_reason: string;
  content?: unknown[];
  parsed_output: unknown;
  stop_details?: { category?: string; explanation?: string };
}

export function fixture(name: string): RecordedResponse {
  return JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as RecordedResponse;
}

export interface FakeClient {
  client: Anthropic;
  /** Every `messages.parse` param object, in call order. */
  calls: Record<string, unknown>[];
}

/** A stand-in for the SDK: `messages.parse` returns the recorded responses in order. */
export function fakeClient(...responses: RecordedResponse[]): FakeClient {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const fake = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        const res = responses[Math.min(i, responses.length - 1)];
        i += 1;
        if (res === undefined) throw new Error('fake client: no recorded response');
        return res;
      },
    },
  };
  return { client: fake as unknown as Anthropic, calls };
}

/** An `Ai` backed by recorded responses; no network, no API key. */
export function fakeAi(
  responses: RecordedResponse[],
  opts: AiOptions = {},
): Ai & { calls: Record<string, unknown>[] } {
  const fake = fakeClient(...responses);
  const ai = createAi({ ...opts, client: fake.client });
  return Object.assign(ai, { calls: fake.calls });
}

/** `createAi` over a single recorded fixture file. */
export function aiFor(name: string, opts: AiOptions = {}) {
  return fakeAi([fixture(name)], opts);
}

/** entry + phase + 2 steps + reference, with a next edge and a reads edge. */
export function demoDoc(): SkillDoc {
  return SkillDocSchema.parse({
    profile: 'claude-code',
    nodes: [
      {
        id: 'entry_root',
        kind: 'entry',
        order: 0,
        name: 'demo-skill',
        description: 'Reviews pull request descriptions. Use when the user asks for a PR summary.',
        triggers: ['pull request', 'PR description'],
      },
      { id: 'phase_review', kind: 'phase', order: 1, title: 'Review the diff' },
      {
        id: 'step_read',
        kind: 'step',
        parentId: 'phase_review',
        order: 0,
        title: 'Read the diff',
        instruction: 'Read the full diff before writing anything.',
        why: 'The summary must describe what actually changed.',
      },
      {
        id: 'step_write',
        kind: 'step',
        parentId: 'phase_review',
        order: 1,
        title: 'Write the summary',
        instruction: 'Write a three-sentence summary of the change.',
      },
      {
        id: 'reference_style',
        kind: 'reference',
        order: 2,
        path: 'references/style.md',
        source: 'inline',
        body: '# Style\n\nUse the imperative mood.\n',
        readWhen: 'when the summary needs a house style check',
      },
    ],
    edges: [
      { id: 'edge_flow', kind: 'next', source: 'step_read', target: 'step_write' },
      { id: 'edge_reads', kind: 'reads', source: 'step_write', target: 'reference_style' },
    ],
  });
}

/** demoDoc plus a raw_markdown node, for the decompile fallback. */
export function docWithRaw(): SkillDoc {
  const doc = demoDoc();
  return SkillDocSchema.parse({
    ...doc,
    nodes: [
      ...doc.nodes,
      {
        id: 'raw_leftover',
        kind: 'raw_markdown',
        order: 3,
        body: '## Notes\n\n- Check the tests pass.\n- Check the changelog is updated.\n',
      },
    ],
  });
}

/** The node of the add op at `index`, or of the first add op when `index` is omitted. */
export function addedNode(patch: GraphPatchT, index?: number): SkillNode {
  const op = index === undefined ? patch.ops.find((o) => o.op === 'add') : patch.ops[index];
  if (op?.op !== 'add') throw new Error(`expected an add op at ${index ?? 'any index'}`);
  return op.node;
}

/** Params of the nth recorded `messages.parse` call. */
export function callParams(calls: Record<string, unknown>[], index = 0): Record<string, unknown> {
  const params = calls[index];
  if (!params) throw new Error(`no recorded call at index ${index}`);
  return params;
}

/** The system prompt of the nth call. */
export function systemOf(calls: Record<string, unknown>[], index = 0): string {
  return String(callParams(calls, index).system);
}

/** The content of the single user turn of the nth call. */
export function userTurn(calls: Record<string, unknown>[], index = 0): string {
  const messages = callParams(calls, index).messages as { role: string; content: string }[];
  const turn = messages[0];
  if (!turn || messages.length !== 1 || turn.role !== 'user') {
    throw new Error('expected exactly one user turn');
  }
  return turn.content;
}
