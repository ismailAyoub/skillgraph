import { describe, expect, it } from 'vitest';
import { AiError, normalizeAiPatch, validateProposal } from '../src/index';
import type { AiPatchOp } from '../src/schemas';
import { addedNode, demoDoc } from './helpers';

function aiOp(partial: Partial<AiPatchOp> & { op: AiPatchOp['op'] }): AiPatchOp {
  return { id: null, node: null, data: null, edge: null, parentId: null, order: null, ...partial };
}

describe('validateProposal', () => {
  it('accepts a well-formed patch and returns it normalized', () => {
    const doc = demoDoc();
    const patch = validateProposal(doc, {
      ops: [{ op: 'update', id: 'step_write', data: { why: 'Reviewers skim.' } }],
    });
    expect(patch.ops).toHaveLength(1);
    // The doc is not mutated: validation is a dry run.
    expect(doc.nodes.find((n) => n.id === 'step_write')).not.toHaveProperty('why');
  });

  it("forces provenance 'ai' on added nodes", () => {
    const patch = validateProposal(demoDoc(), {
      ops: [
        {
          op: 'add',
          node: {
            id: 'step_new',
            kind: 'step',
            parentId: 'phase_review',
            order: 2,
            instruction: 'Post the summary.',
            provenance: 'user',
          },
        },
      ],
    });
    expect(addedNode(patch, 0).provenance).toBe('ai');
  });

  it('rejects a patch referencing an unknown node id', () => {
    for (const ops of [
      [{ op: 'update', id: 'step_ghost', data: { why: 'x' } }],
      [{ op: 'remove', id: 'step_ghost' }],
      [{ op: 'move', id: 'step_ghost', parentId: null, order: 0 }],
      [
        {
          op: 'addEdge',
          edge: { id: 'edge_new', kind: 'next', source: 'step_read', target: 'step_ghost' },
        },
      ],
    ]) {
      const err = (() => {
        try {
          validateProposal(demoDoc(), { ops });
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('invalid_patch');
      expect((err as AiError).message).toMatch(/does not apply/);
    }
  });

  it('rejects a duplicate node id', () => {
    expect(() =>
      validateProposal(demoDoc(), {
        ops: [
          {
            op: 'add',
            node: { id: 'step_read', kind: 'step', parentId: null, order: 9, instruction: 'dup' },
          },
        ],
      }),
    ).toThrow(/Duplicate node id/);
    try {
      validateProposal(demoDoc(), {
        ops: [
          {
            op: 'add',
            node: { id: 'step_read', kind: 'step', parentId: null, order: 9, instruction: 'dup' },
          },
        ],
      });
    } catch (err) {
      expect((err as AiError).code).toBe('invalid_patch');
    }
  });

  it('rejects a duplicate edge id', () => {
    try {
      validateProposal(demoDoc(), {
        ops: [
          {
            op: 'addEdge',
            edge: { id: 'edge_flow', kind: 'next', source: 'step_read', target: 'step_write' },
          },
        ],
      });
      throw new Error('expected a rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('invalid_patch');
    }
  });

  it('rejects malformed ops', () => {
    for (const patch of [
      { ops: [{ op: 'frobnicate', id: 'step_read' }] },
      { ops: [{ op: 'update', data: { why: 'no id' } }] },
      { ops: [{ op: 'add', node: { kind: 'step' } }] },
      { ops: [{ op: 'move', id: 'step_read' }] },
      { ops: 'not-an-array' },
      {},
      null,
    ]) {
      const err = (() => {
        try {
          validateProposal(demoDoc(), patch);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('invalid_patch');
      expect((err as AiError).message).toMatch(/GraphPatch schema/);
      expect((err as AiError).details).toBeTruthy();
    }
  });
});

describe('normalizeAiPatch', () => {
  it('parses JSON-string payloads and stamps provenance and order', () => {
    const doc = demoDoc();
    const raw = normalizeAiPatch(doc, {
      ops: [
        aiOp({
          op: 'add',
          node: JSON.stringify({
            id: 'step_publish',
            kind: 'step',
            parentId: 'phase_review',
            instruction: 'Post it.',
          }),
        }),
      ],
    });
    const patch = validateProposal(doc, raw);
    expect(addedNode(patch, 0)).toMatchObject({
      id: 'step_publish',
      parentId: 'phase_review',
      order: 2,
      provenance: 'ai',
    });
  });

  it('renames an added node whose id already exists and rewrites later references', () => {
    const doc = demoDoc();
    const raw = normalizeAiPatch(doc, {
      ops: [
        aiOp({
          op: 'add',
          node: JSON.stringify({ id: 'step_read', kind: 'step', instruction: 'Collides.' }),
        }),
        aiOp({
          op: 'update',
          id: 'step_read',
          data: JSON.stringify({ why: 'Points at the new node.' }),
        }),
      ],
    });
    const patch = validateProposal(doc, raw);
    const added = addedNode(patch, 0).id;
    expect(added).not.toBe('step_read');
    expect(patch.ops[1]).toMatchObject({ op: 'update', id: added });
  });

  it('rejects an unknown node kind and non-JSON payloads', () => {
    const doc = demoDoc();
    expect(() =>
      normalizeAiPatch(doc, {
        ops: [aiOp({ op: 'add', node: JSON.stringify({ id: 'x', kind: 'wormhole' }) })],
      }),
    ).toThrow(AiError);
    expect(() => normalizeAiPatch(doc, { ops: [aiOp({ op: 'add', node: '{not json' })] })).toThrow(
      /not valid JSON/,
    );
    expect(() =>
      normalizeAiPatch(doc, { ops: [aiOp({ op: 'update', id: null, data: '{}' })] }),
    ).toThrow(/update op without id/);
  });
});
