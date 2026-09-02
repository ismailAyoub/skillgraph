import { describe, expect, it } from 'vitest';
import { lint } from '../src/lint/index';
import { parseDoc } from '../src/schema/graph';

describe('lint', () => {
  it('flags spec violations and best-practice gaps', () => {
    const doc = parseDoc({
      nodes: [
        {
          id: 'entry_root',
          kind: 'entry',
          name: 'Bad Name',
          description: 'I help with stuff.',
          referenceIndex: 'none',
          order: 0,
        },
        { id: 'ref_1', kind: 'reference', path: 'references/x.md', body: 'hello', order: 1 },
        { id: 'loop_1', kind: 'loop', until: '', order: 2 },
      ],
      edges: [],
    });
    const result = lint(doc, { dirName: 'other-name' });
    const rules = new Set(result.diagnostics.map((d) => d.rule));
    expect(rules).toContain('spec/name-format');
    expect(rules).toContain('spec/name-matches-dir');
    expect(rules).toContain('style/description-third-person');
    expect(rules).toContain('style/description-has-when');
    expect(rules).toContain('graph/orphan-reference');
    expect(rules).toContain('graph/loop-needs-until');
    expect(result.errors).toBeGreaterThan(0);
  });

  it('passes a clean skill', () => {
    const doc = parseDoc({
      nodes: [
        {
          id: 'entry_root',
          kind: 'entry',
          name: 'good-skill',
          description:
            'Formats commit messages. Use whenever the user asks to write or fix a commit message, even if they just paste a diff.',
          triggers: ['commit message'],
          order: 0,
        },
        {
          id: 'step_1',
          kind: 'step',
          title: 'Summarize',
          instruction: 'the change in one line.',
          order: 1,
        },
      ],
      edges: [],
    });
    const result = lint(doc, { dirName: 'good-skill' });
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
  });
});
