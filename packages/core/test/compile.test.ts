import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index';
import { parseDoc } from '../src/schema/graph';

const workflow = parseDoc({
  profile: 'claude-code',
  nodes: [
    {
      id: 'entry_root',
      kind: 'entry',
      name: 'reviewing-prs',
      title: 'Reviewing PRs',
      summary: 'Reviews pull requests for correctness and style.',
      description:
        'Reviews pull requests for correctness and style. Use whenever the user asks for a code review, PR feedback, or mentions a diff.',
      negativeTriggers: ['writing new features'],
      overview: 'auto',
      claudeCode: { argumentHint: '<pr-number>' },
      order: 0,
    },
    {
      id: 'phase_gather',
      kind: 'phase',
      title: 'Gather context',
      summary: 'Load the diff and the standards.',
      order: 1,
    },
    {
      id: 'step_diff',
      kind: 'step',
      parentId: 'phase_gather',
      order: 1,
      title: 'Read the diff',
      instruction: 'with `gh pr diff $0`.',
      why: 'Reviewing from memory misses edge cases.',
    },
    {
      id: 'ref_standards',
      kind: 'reference',
      path: 'references/standards.md',
      body: '# Standards\n\n- No console.log in production.\n',
      summary: 'the team coding standards',
      readWhen: 'the diff touches shared code',
      order: 900,
    },
    {
      id: 'script_lint',
      kind: 'script',
      path: 'scripts/lint.sh',
      code: '#!/bin/bash\nnpm run lint',
      runWhen: 'check formatting before commenting',
      order: 901,
    },
    {
      id: 'phase_review',
      kind: 'phase',
      title: 'Review',
      summary: 'Decide what kind of change it is and review accordingly.',
      order: 2,
    },
    {
      id: 'dec_kind',
      kind: 'decision',
      parentId: 'phase_review',
      order: 1,
      question: 'What kind of change is it?',
    },
    {
      id: 'step_bug',
      kind: 'step',
      parentId: 'phase_review',
      order: 2,
      title: 'Trace the bug',
      instruction: 'to its root cause before judging the fix.',
    },
    {
      id: 'step_feature',
      kind: 'step',
      parentId: 'phase_review',
      order: 3,
      title: 'Check tests',
      instruction: 'cover the new behavior.',
    },
    {
      id: 'step_feature2',
      kind: 'step',
      parentId: 'phase_review',
      order: 4,
      instruction: 'Look for missing error handling.',
    },
    {
      id: 'ask_scope',
      kind: 'ask_user',
      parentId: 'phase_review',
      order: 5,
      title: 'Confirm scope',
      question: 'Ask whether nitpicks are welcome.',
      blocking: true,
    },
    {
      id: 'loop_fix',
      kind: 'loop',
      parentId: 'phase_review',
      order: 6,
      until: 'no blocking issues remain',
      maxIterations: 3,
    },
    {
      id: 'step_comment',
      kind: 'step',
      parentId: 'loop_fix',
      order: 1,
      title: 'Comment',
      instruction: 'on the most severe issue.',
    },
    {
      id: 'guard_tone',
      kind: 'guardrail',
      polarity: 'do',
      text: 'Be specific.',
      why: 'Vague feedback wastes a round trip.',
      order: 10,
    },
    {
      id: 'guard_nits',
      kind: 'guardrail',
      polarity: 'dont',
      text: "Don't block on style.",
      why: 'Formatters exist.',
      order: 11,
    },
    {
      id: 'out_report',
      kind: 'output_format',
      template: '## Summary\n## Blocking\n## Nits',
      format: 'markdown',
      strictness: 'exact',
      order: 12,
    },
    {
      id: 'ex_1',
      kind: 'example',
      label: '1',
      input: 'Fix null deref in parser',
      output: 'Blocking: the guard is on the wrong branch.',
      order: 13,
    },
    {
      id: 'check_done',
      kind: 'checklist',
      variant: 'verification',
      items: [
        { text: 'Every blocking issue cites a line.' },
        { text: 'Tests were run.', why: 'Green CI is the bar.' },
      ],
      order: 14,
    },
  ],
  edges: [
    { id: 'e_reads', kind: 'reads', source: 'step_diff', target: 'ref_standards' },
    { id: 'e_runs', kind: 'runs', source: 'step_diff', target: 'script_lint' },
    { id: 'e_b1', kind: 'branch', source: 'dec_kind', target: 'step_bug', label: 'A bug fix?' },
    { id: 'e_b2', kind: 'branch', source: 'dec_kind', target: 'step_feature', label: 'A feature?' },
    { id: 'e_n1', kind: 'next', source: 'step_feature', target: 'step_feature2' },
    { id: 'e_n2', kind: 'next', source: 'step_bug', target: 'ask_scope' },
    { id: 'e_n3', kind: 'next', source: 'step_feature2', target: 'ask_scope' },
    { id: 'e_n4', kind: 'next', source: 'ask_scope', target: 'loop_fix' },
  ],
});

describe('compile', () => {
  it('renders a workflow skill with prose-first shapes', () => {
    const result = compile(workflow);
    expect(result.skillMd).toMatchInlineSnapshot(`
      "---
      name: reviewing-prs
      description: Reviews pull requests for correctness and style. Use whenever the user asks for a code review, PR feedback, or mentions a diff. Do not use for writing new features.
      argument-hint: <pr-number>
      ---

      # Reviewing PRs

      Reviews pull requests for correctness and style.

      ## How It Works

      1. **Gather context:** Load the diff and the standards.
      2. **Review:** Decide what kind of change it is and review accordingly.

      ## Gather context

      1. **Read the diff** with \`gh pr diff $0\`. Reviewing from memory misses edge cases. Read \`references/standards.md\` for the team coding standards when the diff touches shared code. Run \`scripts/lint.sh\` to check formatting before commenting.

      ## Review

      **What kind of change is it?**

      - **A bug fix?** → **Trace the bug** to its root cause before judging the fix.
      - **A feature?** →
        1. **Check tests** cover the new behavior.
        2. Look for missing error handling.

      1. **Confirm scope** Ask whether nitpicks are welcome. Use the AskUserQuestion tool to gather this input, and do not proceed until you have the answer.

      Repeat the following until no blocking issues remain (at most 3 rounds):

      1. **Comment** on the most severe issue.

      Stop when no blocking issues remain.

      ## Output

      Use this exact template:

      \`\`\`markdown
      ## Summary
      ## Blocking
      ## Nits
      \`\`\`

      ## Examples

      **Example 1:**

      Input: Fix null deref in parser

      Output: Blocking: the guard is on the wrong branch.

      ## Guidelines

      - **Be specific.** Vague feedback wastes a round trip.

      ## Anti-patterns to Avoid

      - **Don't block on style.** Formatters exist.

      ## Verification

      - [ ] Every blocking issue cites a line.
      - [ ] Tests were run. Green CI is the bar.
      "
    `);
    expect(result.files['references/standards.md']).toContain('# Standards');
    expect(result.files['scripts/lint.sh']).toBe('#!/bin/bash\nnpm run lint\n');
    expect(result.report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('is idempotent and layout-independent', () => {
    const a = compile(workflow);
    const b = compile(workflow);
    expect(a.skillMd).toBe(b.skillMd);
  });

  it('drops Claude Code fields under the universal profile and warns', () => {
    const result = compile(workflow, { profile: 'universal' });
    expect(result.skillMd).not.toContain('argument-hint');
    expect(result.skillMd).toContain('Ask the user and wait for their answer before continuing.');
    expect(result.report.diagnostics.some((d) => d.rule === 'profile/dropped-fields')).toBe(true);
  });

  it('emits a mermaid diagram on request', () => {
    const result = compile(workflow, { mermaid: 'file' });
    expect(result.files['assets/workflow.mmd']).toContain('flowchart TD');
    expect(result.files['assets/workflow.mmd']).toContain('dec_kind{');
  });
});
