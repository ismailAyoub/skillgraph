import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClaudeCliBackend, extractJsonObject, extractResultText } from '../src/claude-cli';
import { AiError } from '../src/errors';
import { createAi } from '../src/index';
import { demoDoc } from './helpers';

/** Write a fake `claude` that answers from a script keyed by attempt number. */
function fakeClaude(answers: string[], opts: { isError?: boolean; exit?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const bin = join(dir, 'claude');
  const counter = join(dir, 'count');
  writeFileSync(counter, '0');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const n = Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8'));
  fs.writeFileSync(${JSON.stringify(counter)}, String(n + 1));
  fs.writeFileSync(${JSON.stringify(join(dir, 'prompt-'))} + n + '.txt', input);
  fs.writeFileSync(${JSON.stringify(join(dir, 'args.json'))}, JSON.stringify(process.argv.slice(2)));
  const answers = ${JSON.stringify(answers)};
  const result = answers[Math.min(n, answers.length - 1)];
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: ${!!opts.isError}, result }) + '\\n');
  process.exit(${opts.exit ?? 0});
});
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const Schema = z.object({ answer: z.string(), n: z.number() });

describe('claude-cli backend', () => {
  it('parses a plain JSON answer and passes tools-off flags', async () => {
    const bin = fakeClaude(['{"answer":"hi","n":1}']);
    const backend = createClaudeCliBackend({ bin, model: 'claude-sonnet-5' });
    const out = await backend.call(Schema, 'SYSTEM', 'USER');
    expect(out).toEqual({ answer: 'hi', n: 1 });
    const args = JSON.parse(
      require('node:fs').readFileSync(join(bin, '..', 'args.json'), 'utf8'),
    ) as string[];
    expect(args).toContain('--output-format');
    expect(args).toContain('--tools');
    expect(args).toContain('--model');
    const prompt = require('node:fs').readFileSync(join(bin, '..', 'prompt-0.txt'), 'utf8');
    expect(prompt).toContain('SYSTEM');
    expect(prompt).toContain('USER');
    expect(prompt).toContain('"answer"'); // the JSON schema travels in the prompt
  });

  it('accepts fenced JSON with prose around it', async () => {
    const bin = fakeClaude(['Sure! Here you go:\n```json\n{"answer":"x","n":2}\n```\nDone.']);
    const out = await createClaudeCliBackend({ bin }).call(Schema, 's', 'u');
    expect(out).toEqual({ answer: 'x', n: 2 });
  });

  it('retries once with validation feedback, then succeeds', async () => {
    const bin = fakeClaude(['{"answer":"x"}', '{"answer":"x","n":3}']);
    const out = await createClaudeCliBackend({ bin }).call(Schema, 's', 'u');
    expect(out).toEqual({ answer: 'x', n: 3 });
    const retryPrompt = require('node:fs').readFileSync(join(bin, '..', 'prompt-1.txt'), 'utf8');
    expect(retryPrompt).toMatch(/failed schema validation/);
    expect(retryPrompt).toMatch(/\bn\b/);
  });

  it('gives up after the retries with a parse error', async () => {
    const bin = fakeClaude(['not json at all']);
    await expect(
      createClaudeCliBackend({ bin, retries: 1 }).call(Schema, 's', 'u'),
    ).rejects.toMatchObject({
      code: 'parse',
    });
  });

  it('maps a login failure to an auth error', async () => {
    const bin = fakeClaude(['Failed to authenticate: OAuth session expired'], {
      isError: true,
      exit: 1,
    });
    await expect(createClaudeCliBackend({ bin }).call(Schema, 's', 'u')).rejects.toMatchObject({
      code: 'auth',
    });
  });

  it('reports a missing binary clearly', async () => {
    const err = await createClaudeCliBackend({ bin: '/nonexistent/claude' })
      .call(Schema, 's', 'u')
      .catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('api');
    expect(err.message).toMatch(/Cannot find the Claude Code CLI/);
  });

  it('drives a full Ai feature through createAi({ backend })', async () => {
    const bin = fakeClaude([
      JSON.stringify({
        candidates: [{ description: 'Does X. Use when Y.', rationale: 'r' }],
        triggerQueries: [{ query: 'do x', should_trigger: true }],
      }),
    ]);
    const ai = createAi({ backend: createClaudeCliBackend({ bin }) });
    const out = await ai.describe({ doc: demoDoc() });
    expect(out.candidates[0]?.description).toBe('Does X. Use when Y.');
    expect(out.triggerQueries).toHaveLength(1);
  });
});

describe('claude-cli parsing helpers', () => {
  it('extractResultText finds the result line among hook lines', () => {
    const out = extractResultText(
      '{"type":"system","subtype":"hook_started"}\n{"type":"result","is_error":false,"result":"{\\"a\\":1}"}\n',
    );
    expect(out).toEqual({ text: '{"a":1}', isError: false });
  });
  it('extractJsonObject strips fences and prose', () => {
    expect(extractJsonObject('x ```json\n{"a":[1,2]}\n``` y')).toEqual({ a: [1, 2] });
    expect(() => extractJsonObject('nothing')).toThrow();
  });
});
