import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  compile,
  lint,
  measureMarkdown,
  parseDoc,
  type SkillDoc,
  type SkillNode,
  sequentialIds,
  unpackableNodes,
  unpackNode,
  unpackNodes,
} from '../src/index';

const PROCEDURE = [
  '1. **Read the diff** before writing anything.',
  '2. **Summarize** the change in three sentences.',
  '3. **Post** the summary as a comment.',
].join('\n');

function skill(extra: unknown[] = [], edges: unknown[] = []): SkillDoc {
  return parseDoc({
    nodes: [
      {
        id: 'entry_root',
        kind: 'entry',
        order: 0,
        name: 'demo',
        description: 'Reviews pull requests. Use when the user asks for a PR review.',
      },
      { id: 'phase_review', kind: 'phase', order: 1, title: 'Review' },
      {
        id: 'step_read',
        kind: 'step',
        parentId: 'phase_review',
        order: 1,
        title: 'Open the PR',
        instruction: 'in the browser.',
      },
      ...extra,
    ],
    edges,
  });
}

function apply(doc: SkillDoc, nodeId: string): SkillDoc {
  return applyPatch(doc, unpackNode(doc, nodeId, { id: sequentialIds() })).doc;
}

function children(doc: SkillDoc, parentId: string | null): SkillNode[] {
  return doc.nodes
    .filter((n) => (n.parentId ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
}

describe('measureMarkdown / unpackShape', () => {
  it('counts items, step-like items, headings and the procedural share', () => {
    const s = measureMarkdown(`Intro.\n\n${PROCEDURE}\n\n## Notes\n\n- a\n- b`);
    expect(s).toMatchObject({ items: 5, stepItems: 3, headings: 1 });
    expect(s.share).toBeGreaterThan(0.5);
    expect(measureMarkdown('')).toEqual({ items: 0, stepItems: 0, headings: 0, share: 0 });
  });

  it('accepts raw markdown with a list, a procedural reference and a step with sub-steps', () => {
    const raw = { id: 'raw_1', kind: 'raw_markdown', order: 1, body: '- a\n- b' };
    const ref = {
      id: 'ref_1',
      kind: 'reference',
      order: 1,
      path: 'references/procedure.md',
      body: PROCEDURE,
    };
    const step = {
      id: 'step_1',
      kind: 'step',
      order: 1,
      instruction: `Run the checks:\n\n${PROCEDURE}`,
    };
    const doc = skill([raw, ref, step]);
    expect(unpackableNodes(doc).map((u) => u.node.id)).toEqual(['raw_1', 'ref_1', 'step_1']);
  });

  it('leaves prose references, short lists, url references and other kinds alone', () => {
    const doc = skill([
      { id: 'raw_1', kind: 'raw_markdown', order: 1, body: 'Just a paragraph.\n\n- one item' },
      {
        id: 'ref_prose',
        kind: 'reference',
        order: 2,
        path: 'references/background.md',
        body: `${'Long background prose. '.repeat(20)}\n\n${PROCEDURE}`,
      },
      {
        id: 'ref_url',
        kind: 'reference',
        order: 3,
        path: 'references/live.md',
        source: 'url',
        url: 'https://example.test',
        body: PROCEDURE,
      },
      { id: 'step_two', kind: 'step', order: 4, instruction: '1. one\n2. two' },
      { id: 'note_1', kind: 'note', order: 5, body: PROCEDURE },
    ]);
    expect(unpackableNodes(doc)).toEqual([]);
    expect(() => unpackNode(doc, 'note_1')).toThrow(/Nothing to unpack/);
    expect(() => unpackNode(doc, 'ghost')).toThrow(/not found/);
  });
});

describe('unpackNode: raw_markdown', () => {
  it('replaces the raw node with steps in its slot and shifts later siblings', () => {
    const doc = skill([
      { id: 'raw_1', kind: 'raw_markdown', parentId: 'phase_review', order: 2, body: PROCEDURE },
      {
        id: 'step_last',
        kind: 'step',
        parentId: 'phase_review',
        order: 3,
        instruction: 'Done.',
        provenance: 'import',
      },
    ]);
    const next = apply(doc, 'raw_1');
    expect(next.nodes.some((n) => n.kind === 'raw_markdown')).toBe(false);
    const steps = children(next, 'phase_review');
    expect(steps.map((n) => [n.id, n.order])).toEqual([
      ['step_read', 1],
      ['step_0001', 2],
      ['step_0002', 3],
      ['step_0003', 4],
      ['step_last', 5],
    ]);
    expect(steps[1]).toMatchObject({
      title: 'Read the diff',
      instruction: 'before writing anything.',
      provenance: 'user',
    });
    // No flow edges in the container, so none are invented.
    expect(next.edges).toEqual([]);
    expect(compile(next).skillMd).toContain('2. **Read the diff** before writing anything.');
  });

  it('inherits provenance and rewires flow edges through the new steps', () => {
    const doc = skill(
      [
        {
          id: 'raw_1',
          kind: 'raw_markdown',
          parentId: 'phase_review',
          order: 2,
          body: PROCEDURE,
          provenance: 'import',
        },
        { id: 'step_last', kind: 'step', parentId: 'phase_review', order: 3, instruction: 'Done.' },
      ],
      [
        { id: 'e_in', kind: 'next', source: 'step_read', target: 'raw_1' },
        { id: 'e_out', kind: 'next', source: 'raw_1', target: 'step_last' },
      ],
    );
    const next = apply(doc, 'raw_1');
    expect(next.nodes.filter((n) => n.id.startsWith('step_000')).map((n) => n.provenance)).toEqual([
      'import',
      'import',
      'import',
    ]);
    expect(next.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      'step_read>step_0001',
      'step_0001>step_0002',
      'step_0002>step_0003',
      'step_0003>step_last',
    ]);
  });

  it('turns headings into nested phases, prose into intros, task lists into checklists and rule bullets into guardrails', () => {
    const body = [
      '## Prepare',
      '',
      'Get the inputs ready.',
      '',
      '1. **Fetch** the branch.',
      '2. **Build** it.',
      '',
      '### Rules',
      '',
      "- **Don't skip the build.** It hides breakage.",
      '- **Always run lint.** It is fast.',
      '',
      '## Verify',
      '',
      '- [ ] Tests pass',
      '- [x] Changelog updated',
      '',
      '```bash',
      'pnpm test',
      '```',
    ].join('\n');
    const doc = skill([{ id: 'raw_1', kind: 'raw_markdown', order: 2, body }]);
    const next = apply(doc, 'raw_1');
    const root = children(next, null).filter((n) => n.kind !== 'entry');
    expect(root.map((n) => [n.kind, n.title, n.order])).toEqual([
      ['phase', 'Review', 1],
      ['phase', 'Prepare', 2],
      ['phase', 'Verify', 3],
    ]);
    const prepare = children(next, 'phase_0001');
    expect(next.nodes.find((n) => n.id === 'phase_0001')).toMatchObject({
      intro: 'Get the inputs ready.',
    });
    expect(prepare.map((n) => [n.kind, n.title])).toEqual([
      ['step', 'Fetch'],
      ['step', 'Build'],
      ['phase', 'Rules'],
    ]);
    // Steps inside a phase created by the unpack are chained.
    expect(next.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['step_0001>step_0002']);
    const rules = children(next, 'phase_0002');
    expect(rules.map((n) => [n.kind, (n as { polarity: string }).polarity, n.title ?? ''])).toEqual(
      [
        ['guardrail', 'dont', ''],
        ['guardrail', 'do', ''],
      ],
    );
    expect(rules[0]).toMatchObject({ text: "Don't skip the build.", why: 'It hides breakage.' });
    const verify = children(next, 'phase_0003');
    expect(verify.map((n) => n.kind)).toEqual(['checklist', 'raw_markdown']);
    expect(verify[0]).toMatchObject({
      kind: 'checklist',
      variant: 'verification',
      style: 'task',
      items: [
        { text: 'Tests pass', checked: false },
        { text: 'Changelog updated', checked: true },
      ],
    });
    // The fence had no step to ride along with in its section, so it stays raw (nothing is lost).
    expect(verify[1]).toMatchObject({ body: '```bash\npnpm test\n```' });
    expect(compile(next).skillMd).toContain('pnpm test');
  });
});

describe('unpackNode: step', () => {
  it('moves the embedded list into following sibling steps and keeps the lead text', () => {
    const doc = skill(
      [
        {
          id: 'step_checks',
          kind: 'step',
          parentId: 'phase_review',
          order: 2,
          title: 'Run the checks',
          instruction: `in this order:\n\n${PROCEDURE}\n\nThen report.`,
          why: 'Order matters.',
        },
        { id: 'step_last', kind: 'step', parentId: 'phase_review', order: 3, instruction: 'Done.' },
      ],
      [{ id: 'e_out', kind: 'next', source: 'step_checks', target: 'step_last' }],
    );
    const next = apply(doc, 'step_checks');
    const steps = children(next, 'phase_review');
    expect(steps.map((n) => [n.id, n.order])).toEqual([
      ['step_read', 1],
      ['step_checks', 2],
      ['step_0001', 3],
      ['step_0002', 4],
      ['step_0003', 5],
      ['step_last', 6],
    ]);
    expect(steps[1]).toMatchObject({
      title: 'Run the checks',
      instruction: 'in this order:\n\nThen report.',
      why: 'Order matters.',
    });
    expect(next.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      'step_checks>step_0001',
      'step_0001>step_0002',
      'step_0002>step_0003',
      'step_0003>step_last',
    ]);
  });

  it('removes a step that held nothing but the list', () => {
    const doc = skill([
      { id: 'step_only', kind: 'step', parentId: 'phase_review', order: 2, instruction: PROCEDURE },
    ]);
    const next = apply(doc, 'step_only');
    expect(children(next, 'phase_review').map((n) => [n.id, n.order])).toEqual([
      ['step_read', 1],
      ['step_0001', 2],
      ['step_0002', 3],
      ['step_0003', 4],
    ]);
  });
});

describe('unpackNode: reference', () => {
  const ref = {
    id: 'ref_proc',
    kind: 'reference',
    order: 5,
    path: 'references/review-procedure.md',
    body: `Follow these steps.\n\n${PROCEDURE}`,
    provenance: 'ai',
  };

  it('inlines the procedure after the step that reads it and drops the file', () => {
    const doc = skill(
      [
        ref,
        { id: 'step_last', kind: 'step', parentId: 'phase_review', order: 2, instruction: 'Done.' },
      ],
      [{ id: 'e_reads', kind: 'reads', source: 'step_read', target: 'ref_proc' }],
    );
    const next = apply(doc, 'ref_proc');
    expect(next.nodes.some((n) => n.kind === 'reference')).toBe(false);
    expect(next.edges).toEqual([]);
    expect(children(next, 'phase_review').map((n) => [n.id, n.order, n.provenance])).toEqual([
      ['step_read', 1, 'user'],
      ['step_0001', 2, 'ai'],
      ['step_0002', 3, 'ai'],
      ['step_0003', 4, 'ai'],
      ['step_0004', 5, 'ai'],
      ['step_last', 6, 'user'],
    ]);
    expect(next.nodes.find((n) => n.id === 'step_0001')).toMatchObject({
      instruction: 'Follow these steps.',
    });
    expect(Object.keys(compile(next).files)).toEqual(['SKILL.md']);
  });

  it('becomes a root phase named after the file when nothing reads it', () => {
    const next = apply(skill([ref]), 'ref_proc');
    const phase = next.nodes.find((n) => n.id === 'phase_0001');
    expect(phase).toMatchObject({
      kind: 'phase',
      parentId: null,
      order: 2,
      title: 'Review procedure',
      intro: 'Follow these steps.',
      provenance: 'ai',
    });
    expect(children(next, 'phase_0001').map((n) => n.title)).toEqual([
      'Read the diff',
      'Summarize',
      'Post',
    ]);
    expect(compile(next).skillMd).toContain('## Review procedure');
  });

  it('uses an enclosing H1 as the phase instead of wrapping it again', () => {
    const next = apply(
      skill([{ ...ref, body: `# Triage\n\n${PROCEDURE}\n\n## Edge cases\n\n1. Retry once.` }]),
      'ref_proc',
    );
    const phases = next.nodes.filter((n) => n.kind === 'phase').map((n) => [n.title, n.parentId]);
    expect(phases).toEqual([
      ['Review', null],
      ['Triage', null],
      ['Edge cases', 'phase_0001'],
    ]);
  });
});

describe('unpackNodes', () => {
  it('folds several unpacks into one patch', () => {
    const doc = skill([
      { id: 'raw_a', kind: 'raw_markdown', parentId: 'phase_review', order: 2, body: '- a\n- b' },
      { id: 'raw_b', kind: 'raw_markdown', parentId: 'phase_review', order: 3, body: '1. c\n2. d' },
    ]);
    const patch = unpackNodes(doc, ['raw_a', 'raw_b'], { id: sequentialIds() });
    const next = applyPatch(doc, patch).doc;
    expect(children(next, 'phase_review').map((n) => [n.kind, n.order])).toEqual([
      ['step', 1],
      ['step', 2],
      ['step', 3],
      ['step', 4],
      ['step', 5],
    ]);
    expect(unpackableNodes(next)).toEqual([]);
  });
});

describe('lint graph/procedure-in-markdown', () => {
  it('flags raw markdown, AI references and hand-written steps that hide a procedure', () => {
    const doc = skill([
      { id: 'raw_1', kind: 'raw_markdown', order: 2, body: PROCEDURE, provenance: 'import' },
      {
        id: 'ref_ai',
        kind: 'reference',
        order: 3,
        path: 'references/a.md',
        body: PROCEDURE,
        provenance: 'ai',
        readWhen: 'always',
      },
      {
        id: 'ref_import',
        kind: 'reference',
        order: 4,
        path: 'references/b.md',
        body: PROCEDURE,
        provenance: 'import',
      },
      { id: 'step_ai', kind: 'step', order: 5, instruction: PROCEDURE, provenance: 'ai' },
      { id: 'step_import', kind: 'step', order: 6, instruction: PROCEDURE, provenance: 'import' },
    ]);
    const flagged = lint(doc)
      .diagnostics.filter((d) => d.rule === 'graph/procedure-in-markdown')
      .map((d) => [d.nodeId, d.severity]);
    expect(flagged).toEqual([
      ['raw_1', 'warning'],
      ['ref_ai', 'warning'],
      ['step_ai', 'warning'],
    ]);
  });
});
