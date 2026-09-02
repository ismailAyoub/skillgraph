import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { compile, lint, migrate } from '@skillgraph/core';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJson } from '../src/fs';
import { createSkillgraphMcpServer, VOCABULARY_URI } from '../src/mcp/server';
import { VOCABULARY_MD } from '../src/mcp/vocabulary';

const META_SKILL = resolve(__dirname, '../../../skills/skillgraph-authoring');

interface ToolText {
  text: string;
  isError: boolean;
  json: <T = Record<string, unknown>>() => T;
}

async function connect(dir: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createSkillgraphMcpServer({ dir });
  await server.connect(serverTransport);
  const client = new Client({ name: 'skillgraph-test', version: '0.0.0' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolText> => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = res.content.map((c) => c.text ?? '').join('\n');
    return {
      text,
      isError: res.isError === true,
      json: () => JSON.parse(text.slice(text.indexOf('\n{') >= 0 ? text.indexOf('\n{') : 0)),
    };
  };
  return { client, server, call };
}

describe('mcp server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillgraph-mcp-'));
  let call: Awaited<ReturnType<typeof connect>>['call'];
  let client: Client;

  beforeAll(async () => {
    const c = await connect(dir);
    call = c.call;
    client = c.client;
  });
  afterAll(async () => {
    await client.close();
  });

  it('lists the tools and serves the vocabulary resource', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        'graph_apply_patch',
        'graph_compile',
        'graph_get',
        'graph_import',
        'graph_init',
        'graph_lint',
        'graph_vocabulary',
        'skill_export',
      ].sort(),
    );
    const res = await client.readResource({ uri: VOCABULARY_URI });
    expect((res.contents[0] as { text?: string } | undefined)?.text).toBe(VOCABULARY_MD);
    expect((await call('graph_vocabulary')).text).toContain('## GraphPatch');
  });

  it('refuses bad skill names and missing skills', async () => {
    expect((await call('graph_get', { skill: '../etc' })).isError).toBe(true);
    expect((await call('graph_get', { skill: 'Nope_Bad' })).isError).toBe(true);
    expect((await call('graph_init', { name: 'Bad Name', description: 'x' })).isError).toBe(true);
    const missing = await call('graph_get', { skill: 'does-not-exist' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/No SKILL.graph.json or SKILL.md/);
  });

  it('init -> apply_patch -> compile -> lint -> get round trip', async () => {
    const init = await call('graph_init', {
      name: 'release-notes',
      description:
        'Writes release notes from merged pull requests. Use whenever the user asks for release notes, a changelog, or what shipped, even if they only mention a version number.',
      title: 'Release Notes',
    });
    expect(init.isError, init.text).toBe(false);
    expect(existsSync(join(dir, 'release-notes', 'SKILL.graph.json'))).toBe(true);
    expect(existsSync(join(dir, 'release-notes', 'SKILL.md'))).toBe(true);

    const patched = await call('graph_apply_patch', {
      skill: 'release-notes',
      patch: {
        ops: [
          {
            op: 'add',
            node: {
              id: 'phase_gather',
              kind: 'phase',
              parentId: null,
              order: 1,
              title: 'Gather changes',
              summary: 'Collect the merged PRs.',
            },
          },
          {
            op: 'add',
            node: {
              id: 'step_list',
              kind: 'step',
              parentId: 'phase_gather',
              order: 1,
              title: 'List merged PRs',
              instruction: 'since the last tag with `gh pr list --state merged`.',
              why: 'The git log alone hides squashed context.',
            },
          },
          {
            op: 'add',
            node: {
              id: 'step_group',
              kind: 'step',
              parentId: 'phase_gather',
              order: 2,
              title: 'Group them',
              instruction: 'by feature, fix and chore.',
            },
          },
          {
            op: 'addEdge',
            edge: { id: 'e_list_group', kind: 'next', source: 'step_list', target: 'step_group' },
          },
        ],
      },
    });
    expect(patched.isError, patched.text).toBe(false);
    const p = patched.json<{
      nodeCount: number;
      inverse: { ops: unknown[] };
      lint: { errors: number };
    }>();
    expect(p.nodeCount).toBe(4);
    expect(p.inverse.ops).toHaveLength(4);
    expect(p.lint.errors).toBe(0);

    const compiled = await call('graph_compile', { skill: 'release-notes' });
    expect(compiled.isError, compiled.text).toBe(false);
    expect(compiled.json<{ written: string[] }>().written).toContain('SKILL.md');

    const linted = await call('graph_lint', { skill: 'release-notes' });
    expect(linted.isError).toBe(false);
    expect(linted.json<{ errors: number }>().errors).toBe(0);

    const got = await call('graph_get', { skill: 'release-notes' });
    expect(got.isError).toBe(false);
    expect(got.text).toContain('step_list (step, order 1) "List merged PRs"');
    const file = got.json<{ doc: { nodes: { id: string }[] } }>();
    expect(file.doc.nodes.map((n) => n.id)).toContain('step_group');

    const md = readFileSync(join(dir, 'release-notes', 'SKILL.md'), 'utf8');
    expect(md).toContain('## Gather changes');
    expect(md).toContain(
      '1. **List merged PRs** since the last tag with `gh pr list --state merged`.',
    );
    expect(md).toContain('2. **Group them** by feature, fix and chore.');
  });

  it('rejects invalid patches without writing', async () => {
    const before = readFileSync(join(dir, 'release-notes', 'SKILL.graph.json'), 'utf8');
    const bad = await call('graph_apply_patch', {
      skill: 'release-notes',
      patch: {
        ops: [
          { op: 'addEdge', edge: { id: 'e_x', kind: 'next', source: 'nope', target: 'step_list' } },
        ],
      },
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Node not found: nope/);
    const malformed = await call('graph_apply_patch', {
      skill: 'release-notes',
      patch: { ops: [{ op: 'teleport', id: 'step_list' }] },
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.text).toMatch(/Invalid GraphPatch/);
    expect(readFileSync(join(dir, 'release-notes', 'SKILL.graph.json'), 'utf8')).toBe(before);
  });

  it('refuses to overwrite hand-edited files unless forced', async () => {
    const mdPath = join(dir, 'release-notes', 'SKILL.md');
    writeFileSync(mdPath, `${readFileSync(mdPath, 'utf8')}\n<!-- hand edit -->\n`);
    const refused = await call('graph_compile', { skill: 'release-notes' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/hand-edited/);
    const refusedPatch = await call('graph_apply_patch', {
      skill: 'release-notes',
      patch: {
        ops: [{ op: 'update', id: 'step_group', data: { why: 'Readers scan by category.' } }],
      },
    });
    expect(refusedPatch.isError).toBe(true);
    const forced = await call('graph_compile', { skill: 'release-notes', force: true });
    expect(forced.isError, forced.text).toBe(false);
    expect(readFileSync(mdPath, 'utf8')).not.toContain('hand edit');
  });

  it('imports a plain SKILL.md folder and exports a zip', async () => {
    const plain = join(dir, 'plain-skill');
    const md = [
      '---',
      'name: plain-skill',
      'description: Does a plain thing. Use whenever the user asks for a plain thing.',
      '---',
      '',
      '# Plain skill',
      '',
      '## Steps',
      '',
      '1. **Do the thing** carefully.',
      '',
    ].join('\n');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'SKILL.md'), md);

    const viaGet = await call('graph_get', { skill: 'plain-skill' });
    expect(viaGet.isError).toBe(false);
    expect(viaGet.text).toContain('source: skill.md');
    expect(existsSync(join(plain, 'SKILL.graph.json'))).toBe(false);

    const imported = await call('graph_import', { skill: 'plain-skill' });
    expect(imported.isError, imported.text).toBe(false);
    expect(imported.json<{ coverage: number }>().coverage).toBeGreaterThan(0);
    expect(existsSync(join(plain, 'SKILL.graph.json'))).toBe(true);
    expect((await call('graph_import', { skill: 'plain-skill' })).isError).toBe(true);
    expect((await call('graph_import', { skill: 'plain-skill', force: true })).isError).toBe(false);

    const out = join(dir, 'plain.zip');
    const exported = await call('skill_export', { skill: 'plain-skill', out, clean: true });
    expect(exported.isError, exported.text).toBe(false);
    const entries = Object.keys(unzipSync(readFileSync(out)));
    expect(entries).toContain('plain-skill/SKILL.md');
    expect(entries.some((k) => k.endsWith('SKILL.graph.json'))).toBe(false);
  });
});

describe('skillgraph-authoring meta-skill', () => {
  it('is a compiled graph whose vocabulary reference matches vocabulary.ts and lints clean', () => {
    const file = migrate(readJson(join(META_SKILL, 'SKILL.graph.json')));
    const vocab = file.doc.nodes.find(
      (n) => n.kind === 'reference' && (n as { path: string }).path === 'references/vocabulary.md',
    ) as { body: string } | undefined;
    expect(vocab?.body).toBe(VOCABULARY_MD);
    const result = compile(file.doc);
    for (const [rel, content] of Object.entries(result.files))
      expect(readFileSync(join(META_SKILL, rel), 'utf8'), rel).toBe(content);
    const l = lint(file.doc, { compiled: result, dirName: 'skillgraph-authoring' });
    expect(l.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.report.lines).toBeLessThan(500);
  });
});
