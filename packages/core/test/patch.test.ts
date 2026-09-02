import { describe, expect, it } from 'vitest';
import { applyPatch } from '../src/patch/index';
import { emptyDoc } from '../src/schema/graph';

describe('applyPatch', () => {
  it('applies ops and returns an inverse that restores the doc', () => {
    const doc = emptyDoc('demo', 'Demo skill. Use when demoing.');
    const step1 = applyPatch(doc, {
      ops: [
        {
          op: 'add',
          node: {
            id: 'phase_1',
            kind: 'phase',
            parentId: null,
            order: 1,
            title: 'Plan',
            provenance: 'user',
            stepStyle: 'numbered',
          },
        },
        {
          op: 'add',
          node: {
            id: 'step_1',
            kind: 'step',
            parentId: 'phase_1',
            order: 1,
            title: 'Read',
            instruction: 'the code',
            provenance: 'user',
          },
        },
        {
          op: 'add',
          node: {
            id: 'step_2',
            kind: 'step',
            parentId: 'phase_1',
            order: 2,
            title: 'Fix',
            instruction: 'it',
            provenance: 'user',
          },
        },
        { op: 'addEdge', edge: { id: 'e1', kind: 'next', source: 'step_1', target: 'step_2' } },
      ],
    });
    expect(step1.doc.nodes).toHaveLength(4);
    const step2 = applyPatch(step1.doc, {
      ops: [
        {
          op: 'update',
          id: 'step_1',
          data: { title: 'Read carefully', why: 'Bugs hide in details.' },
        },
        { op: 'move', id: 'step_2', parentId: null, order: 5 },
        { op: 'remove', id: 'phase_1' },
        { op: 'setProfile', profile: 'universal' },
      ],
    });
    expect(step2.doc.profile).toBe('universal');
    expect(step2.doc.nodes.find((n) => n.id === 'phase_1')).toBeUndefined();
    expect(step2.doc.nodes.find((n) => n.id === 'step_1')?.parentId).toBeNull();
    const restored = applyPatch(step2.doc, step2.inverse);
    const norm = (d: typeof doc) =>
      JSON.stringify({
        ...d,
        nodes: [...d.nodes].sort((a, b) => a.id.localeCompare(b.id)),
        edges: [...d.edges].sort((a, b) => a.id.localeCompare(b.id)),
      });
    expect(norm(restored.doc)).toBe(norm(step1.doc));
    const back = applyPatch(restored.doc, step1.inverse);
    expect(norm(back.doc)).toBe(norm(doc));
  });

  it('rejects edges to unknown nodes', () => {
    const doc = emptyDoc('demo', 'Demo.');
    expect(() =>
      applyPatch(doc, {
        ops: [
          { op: 'addEdge', edge: { id: 'e', kind: 'next', source: 'entry_root', target: 'nope' } },
        ],
      }),
    ).toThrow();
  });
});
