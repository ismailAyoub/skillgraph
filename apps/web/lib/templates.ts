import { type SkillDocInput, type SkillFile, SkillFileSchema } from '@skillgraph/core';

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (name: string) => SkillFile;
}

function file(doc: SkillDocInput): SkillFile {
  return SkillFileSchema.parse({
    schemaVersion: 1,
    doc,
    layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  });
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Just the skill entry. Add nodes from the palette.',
    build: (name) =>
      file({
        nodes: [
          {
            id: 'entry_root',
            kind: 'entry',
            name,
            title: humanize(name),
            description: `${humanize(name)}. Use when …`,
            order: 0,
          },
        ],
        edges: [],
      }),
  },
  {
    id: 'workflow',
    name: 'Workflow',
    description:
      'Phases with numbered steps, a decision, an output template and a verification checklist.',
    build: (name) =>
      file({
        nodes: [
          {
            id: 'entry_root',
            kind: 'entry',
            name,
            title: humanize(name),
            summary: `${humanize(name)} in three phases.`,
            description: `${humanize(name)}. Use whenever the user asks for … even if they do not say "${name}" explicitly.`,
            overview: 'auto',
            order: 0,
          },
          {
            id: 'phase_understand',
            kind: 'phase',
            title: 'Understand',
            summary: 'Gather what the task needs.',
            order: 1,
          },
          {
            id: 'step_restate',
            kind: 'step',
            parentId: 'phase_understand',
            order: 1,
            title: 'Restate the request',
            instruction: 'in one sentence and confirm the goal.',
            why: 'A wrong goal wastes every later step.',
          },
          {
            id: 'ask_gaps',
            kind: 'ask_user',
            parentId: 'phase_understand',
            order: 2,
            title: 'Fill the gaps',
            question: 'Ask for anything missing (inputs, constraints, definition of done).',
            blocking: true,
          },
          {
            id: 'phase_do',
            kind: 'phase',
            title: 'Do the work',
            summary: 'Pick the path that fits the input.',
            order: 2,
          },
          {
            id: 'dec_kind',
            kind: 'decision',
            parentId: 'phase_do',
            order: 1,
            question: 'What kind of input did the user give?',
          },
          {
            id: 'step_files',
            kind: 'step',
            parentId: 'phase_do',
            order: 2,
            title: 'Read the files',
            instruction: 'and apply the rules below.',
          },
          {
            id: 'step_nothing',
            kind: 'step',
            parentId: 'phase_do',
            order: 3,
            title: 'Ask which files',
            instruction: 'to work on before doing anything else.',
          },
          {
            id: 'step_apply',
            kind: 'step',
            parentId: 'phase_do',
            order: 4,
            title: 'Apply the change',
            instruction: 'in small, reviewable increments.',
          },
          {
            id: 'phase_ship',
            kind: 'phase',
            title: 'Ship',
            summary: 'Produce the deliverable and verify it.',
            order: 3,
          },
          {
            id: 'step_report',
            kind: 'step',
            parentId: 'phase_ship',
            order: 1,
            title: 'Write the report',
            instruction: 'using the output template.',
          },
          {
            id: 'ref_rules',
            kind: 'reference',
            path: 'references/rules.md',
            body: '# Rules\n\n- Prefer the simplest change that works.\n',
            summary: 'the detailed rules',
            readWhen: 'you are unsure whether a change is allowed',
            order: 900,
          },
          {
            id: 'out_report',
            kind: 'output_format',
            template: '## Summary\n\n## Changes\n\n## Open questions',
            format: 'markdown',
            strictness: 'exact',
            order: 10,
          },
          {
            id: 'guard_1',
            kind: 'guardrail',
            polarity: 'dont',
            text: "Don't guess at requirements.",
            why: 'A clarifying question is cheaper than a wrong deliverable.',
            order: 11,
          },
          {
            id: 'check_1',
            kind: 'checklist',
            variant: 'verification',
            items: [
              { text: 'The report follows the template.' },
              { text: 'Every change was explained.' },
            ],
            order: 12,
          },
        ],
        edges: [
          { id: 'e1', kind: 'next', source: 'step_restate', target: 'ask_gaps' },
          {
            id: 'e2',
            kind: 'branch',
            source: 'dec_kind',
            target: 'step_files',
            label: 'Files or a pattern?',
          },
          {
            id: 'e3',
            kind: 'branch',
            source: 'dec_kind',
            target: 'step_nothing',
            label: 'Nothing?',
          },
          { id: 'e4', kind: 'next', source: 'step_files', target: 'step_apply' },
          { id: 'e5', kind: 'next', source: 'step_nothing', target: 'step_apply' },
          { id: 'e6', kind: 'reads', source: 'step_apply', target: 'ref_rules' },
        ],
      }),
  },
  {
    id: 'knowledge',
    name: 'Knowledge router',
    description: 'A priority table of categories that routes to small reference files.',
    build: (name) =>
      file({
        nodes: [
          {
            id: 'entry_root',
            kind: 'entry',
            name,
            title: humanize(name),
            summary: 'Best practices organized by category and prioritized by impact.',
            description: `${humanize(name)} best practices. Use when writing, reviewing or refactoring code in this area.`,
            referenceIndex: 'none',
            order: 0,
          },
          { id: 'phase_when', kind: 'phase', title: 'When to Apply', order: 1 },
          {
            id: 'raw_when',
            kind: 'raw_markdown',
            parentId: 'phase_when',
            order: 1,
            body: 'Reference these guidelines when:\n\n- Writing new code\n- Reviewing changes\n',
          },
          {
            id: 'catalog_1',
            kind: 'catalog',
            title: 'Rule Categories by Priority',
            quickReference: 'auto',
            categories: [
              { id: 'perf', name: 'Performance', impact: 'CRITICAL', prefix: 'perf-' },
              { id: 'safety', name: 'Safety', impact: 'HIGH', prefix: 'safety-' },
            ],
            order: 2,
          },
          {
            id: 'ref_a',
            kind: 'reference',
            path: 'references/perf-avoid-waterfalls.md',
            body: '# Avoid waterfalls\n\nStart independent work in parallel.\n',
            summary: 'Start independent work in parallel',
            categoryId: 'perf',
            order: 900,
          },
          {
            id: 'ref_b',
            kind: 'reference',
            path: 'references/safety-validate-input.md',
            body: '# Validate input\n\nNever trust external data.\n',
            summary: 'Never trust external data',
            categoryId: 'safety',
            order: 901,
          },
        ],
        edges: [],
      }),
  },
  {
    id: 'stub',
    name: 'Stub (fetch the real rules)',
    description: 'A tiny skill that fetches a URL and applies what it finds.',
    build: (name) =>
      file({
        nodes: [
          {
            id: 'entry_root',
            kind: 'entry',
            name,
            title: humanize(name),
            description: `Review files against ${humanize(name)}. Use when asked to review UI, check accessibility or audit a design.`,
            claudeCode: { argumentHint: '<file-or-pattern>' },
            order: 0,
          },
          { id: 'phase_how', kind: 'phase', title: 'How It Works', order: 1 },
          {
            id: 'step_fetch',
            kind: 'step',
            parentId: 'phase_how',
            order: 1,
            title: 'Fetch the latest guidelines',
            instruction: 'before each review.',
          },
          {
            id: 'step_read',
            kind: 'step',
            parentId: 'phase_how',
            order: 2,
            title: 'Read the specified files',
            instruction: 'or ask the user for files or a pattern.',
          },
          {
            id: 'step_apply',
            kind: 'step',
            parentId: 'phase_how',
            order: 3,
            title: 'Apply every rule',
            instruction: 'and report findings as `file:line` lines.',
          },
          {
            id: 'ref_url',
            kind: 'reference',
            path: 'references/guidelines.md',
            source: 'url',
            url: 'https://example.com/guidelines.md',
            summary: 'all the rules and the output format',
            readWhen: 'before each review',
            order: 900,
          },
        ],
        edges: [
          { id: 'e1', kind: 'reads', source: 'step_fetch', target: 'ref_url' },
          { id: 'e2', kind: 'next', source: 'step_fetch', target: 'step_read' },
          { id: 'e3', kind: 'next', source: 'step_read', target: 'step_apply' },
        ],
      }),
  },
];

export function humanize(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
