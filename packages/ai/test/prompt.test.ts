import { describe, expect, it } from 'vitest';
import { describeGraphForPrompt, NODE_VOCABULARY } from '../src/index';
import { demoDoc, docWithRaw } from './helpers';

describe('describeGraphForPrompt', () => {
  const text = describeGraphForPrompt(demoDoc());

  it('lists every node id with its kind, parent and order', () => {
    for (const id of ['entry_root', 'phase_review', 'step_read', 'step_write', 'reference_style']) {
      expect(text).toContain(`[${id}]`);
    }
    expect(text).toMatch(/\[entry_root] entry \(parent=root, order=0\)/);
    expect(text).toMatch(/\[step_read] step \(parent=phase_review, order=0\)/);
    expect(text).toContain('profile: claude-code');
    expect(text).toContain('nodes (5):');
  });

  it('renders edges as labelled arrows between node ids', () => {
    expect(text).toContain('edges (2):');
    expect(text).toContain('[edge_flow] step_read -next-> step_write');
    expect(text).toContain('[edge_reads] step_write -reads-> reference_style');
    // Every edge line carries an arrow of the form -<kind>->.
    const edgeLines = text.split('\n').slice(text.split('\n').indexOf('edges (2):') + 1);
    expect(edgeLines).toHaveLength(2);
    expect(edgeLines.every((l) => /\s-\w+->\s/.test(l))).toBe(true);
  });

  it('includes the key fields the model needs, and marks AI/import provenance', () => {
    expect(text).toContain('name=demo-skill');
    expect(text).toMatch(/instruction=Read the full diff/);
    expect(text).toContain('path=references/style.md');
    expect(text).not.toContain('provenance=user');

    const doc = docWithRaw();
    doc.nodes = doc.nodes.map((n) =>
      n.id === 'raw_leftover' ? { ...n, provenance: 'ai' as const } : n,
    );
    expect(describeGraphForPrompt(doc)).toContain(
      '[raw_leftover] raw_markdown (parent=root, order=3, provenance=ai)',
    );
  });
});

describe('NODE_VOCABULARY', () => {
  it('documents every patch op and the containment rule', () => {
    for (const op of [
      '"add"',
      '"update"',
      '"remove"',
      '"move"',
      '"addEdge"',
      '"updateEdge"',
      '"removeEdge"',
    ]) {
      expect(NODE_VOCABULARY).toContain(op);
    }
    expect(NODE_VOCABULARY).toContain('parentId');
  });
});
