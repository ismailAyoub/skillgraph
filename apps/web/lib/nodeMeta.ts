import type { NodeKind, SkillNode } from '@skillgraph/core';

export interface KindMeta {
  label: string;
  short: string;
  color: string;
  bg: string;
  group: 'flow' | 'files' | 'quality' | 'other';
  description: string;
}

export const KIND_META: Record<NodeKind, KindMeta> = {
  entry: {
    label: 'Skill',
    short: 'Skill',
    color: '#3b5bdb',
    bg: '#e8edff',
    group: 'other',
    description: 'Name, description and frontmatter',
  },
  phase: {
    label: 'Phase',
    short: 'Phase',
    color: '#6b6b73',
    bg: '#f1f1ef',
    group: 'flow',
    description: 'A section that groups steps',
  },
  step: {
    label: 'Step',
    short: 'Step',
    color: '#1f8a4c',
    bg: '#e6f4ec',
    group: 'flow',
    description: 'An imperative instruction',
  },
  decision: {
    label: 'Decision',
    short: 'If',
    color: '#b7791f',
    bg: '#fbf1dc',
    group: 'flow',
    description: 'A question with labeled branches',
  },
  loop: {
    label: 'Loop',
    short: 'Loop',
    color: '#805ad5',
    bg: '#efe8fb',
    group: 'flow',
    description: 'Repeat steps until a condition holds',
  },
  ask_user: {
    label: 'Ask user',
    short: 'Ask',
    color: '#d9480f',
    bg: '#fdebe1',
    group: 'flow',
    description: 'A blocking question for the human',
  },
  delegate: {
    label: 'Subagent',
    short: 'Agent',
    color: '#0b7285',
    bg: '#e0f4f7',
    group: 'flow',
    description: 'Delegate a task to a subagent',
  },
  skill_call: {
    label: 'Sub-skill',
    short: 'Skill',
    color: '#0b7285',
    bg: '#e0f4f7',
    group: 'flow',
    description: 'Invoke another skill',
  },
  inject: {
    label: 'Inject',
    short: '!cmd',
    color: '#5c5f66',
    bg: '#eceef1',
    group: 'flow',
    description: 'Dynamic context from a command (Claude Code)',
  },
  reference: {
    label: 'Reference',
    short: 'Ref',
    color: '#1c7ed6',
    bg: '#e3f0fc',
    group: 'files',
    description: 'A doc the agent reads on demand',
  },
  script: {
    label: 'Script',
    short: 'Script',
    color: '#495057',
    bg: '#eceef1',
    group: 'files',
    description: 'Bundled executable',
  },
  asset: {
    label: 'Asset',
    short: 'Asset',
    color: '#868e96',
    bg: '#f1f3f5',
    group: 'files',
    description: 'Template or static file',
  },
  catalog: {
    label: 'Catalog',
    short: 'Catalog',
    color: '#1c7ed6',
    bg: '#e3f0fc',
    group: 'files',
    description: 'Priority table over reference categories',
  },
  output_format: {
    label: 'Output',
    short: 'Out',
    color: '#2b8a3e',
    bg: '#e6f4ec',
    group: 'quality',
    description: 'Deliverable template',
  },
  guardrail: {
    label: 'Guardrail',
    short: 'Rule',
    color: '#c53030',
    bg: '#fde8e8',
    group: 'quality',
    description: 'A do or a do not',
  },
  example: {
    label: 'Example',
    short: 'Ex',
    color: '#2b8a3e',
    bg: '#e6f4ec',
    group: 'quality',
    description: 'Input → output pair',
  },
  checklist: {
    label: 'Checklist',
    short: 'Check',
    color: '#2b8a3e',
    bg: '#e6f4ec',
    group: 'quality',
    description: 'Verification or red flags',
  },
  raw_markdown: {
    label: 'Markdown',
    short: 'MD',
    color: '#868e96',
    bg: '#f1f3f5',
    group: 'other',
    description: 'Verbatim markdown',
  },
  note: {
    label: 'Note',
    short: 'Note',
    color: '#e67700',
    bg: '#fff4e6',
    group: 'other',
    description: 'Canvas-only annotation',
  },
};

export const PALETTE_ORDER: NodeKind[] = [
  'phase',
  'step',
  'decision',
  'loop',
  'ask_user',
  'delegate',
  'skill_call',
  'inject',
  'reference',
  'script',
  'asset',
  'catalog',
  'output_format',
  'guardrail',
  'example',
  'checklist',
  'raw_markdown',
  'note',
];

export const FILE_KINDS_SET = new Set<string>(['reference', 'script', 'asset']);
export const CONTAINER_KINDS_SET = new Set<string>(['phase', 'loop']);
export const ATTACH_KINDS_SET = new Set<string>(['guardrail', 'example']);

/** Default field values for a freshly created node of a kind. */
export function defaultNodeData(
  kind: NodeKind,
  id: string,
  parentId: string | null,
  order: number,
): SkillNode {
  const base = { id, parentId, order, provenance: 'user' as const };
  switch (kind) {
    case 'phase':
      return { ...base, kind, title: 'New phase', stepStyle: 'numbered' };
    case 'step':
      return { ...base, kind, title: 'Do the thing', instruction: '' };
    case 'decision':
      return { ...base, kind, question: 'Which case applies?' };
    case 'loop':
      return { ...base, kind, until: 'the result is good enough', title: 'Iterate' };
    case 'ask_user':
      return { ...base, kind, title: 'Ask', question: 'What does the user want?', blocking: true };
    case 'delegate':
      return { ...base, kind, task: 'Investigate and report back.' };
    case 'skill_call':
      return { ...base, kind, skill: 'other-skill' };
    case 'inject':
      return { ...base, kind, command: 'git status' };
    case 'reference':
      return {
        ...base,
        kind,
        path: 'references/notes.md',
        source: 'inline',
        body: '# Notes\n',
        inline: 'never',
        title: 'notes',
      };
    case 'script':
      return {
        ...base,
        kind,
        path: 'scripts/run.sh',
        language: 'bash',
        code: '#!/bin/bash\nset -euo pipefail\n',
        title: 'run.sh',
      };
    case 'asset':
      return {
        ...base,
        kind,
        path: 'assets/template.md',
        content: '',
        encoding: 'utf8',
        title: 'template.md',
      };
    case 'catalog':
      return { ...base, kind, categories: [], quickReference: 'auto' };
    case 'output_format':
      return {
        ...base,
        kind,
        template: '# Title\n\n## Summary\n',
        format: 'markdown',
        strictness: 'exact',
      };
    case 'guardrail':
      return { ...base, kind, polarity: 'dont', text: "Don't guess.", why: 'Ask when unsure.' };
    case 'example':
      return { ...base, kind, input: '', output: '' };
    case 'checklist':
      return {
        ...base,
        kind,
        variant: 'verification',
        style: 'task',
        items: [{ text: 'The output exists.' }],
      };
    case 'raw_markdown':
      return { ...base, kind, body: '' };
    case 'note':
      return { ...base, kind, body: 'Note to self' };
    default:
      throw new Error(`Cannot create node of kind ${kind}`);
  }
}

/** One-line summary of a node for the canvas card. */
export function nodeSummary(n: SkillNode): string {
  const r = n as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  switch (n.kind) {
    case 'entry':
      return pick('description');
    case 'step':
      return pick('instruction', 'why');
    case 'decision':
      return pick('question');
    case 'loop':
      return `until ${pick('until') || '…'}`;
    case 'ask_user':
      return pick('question');
    case 'delegate':
      return pick('task');
    case 'skill_call':
      return `/${pick('skill')}`;
    case 'inject':
      return `!\`${pick('command')}\``;
    case 'reference':
    case 'script':
    case 'asset':
      return pick('path');
    case 'catalog':
      return `${(r.categories as unknown[] | undefined)?.length ?? 0} categories`;
    case 'output_format':
      return pick('intro') || (pick('template').split('\n')[0] ?? '');
    case 'guardrail':
      return pick('text');
    case 'example':
      return pick('input');
    case 'checklist':
      return `${(r.items as unknown[] | undefined)?.length ?? 0} items`;
    case 'raw_markdown':
    case 'note':
      return pick('body');
    default:
      return '';
  }
}

export function nodeTitle(n: SkillNode): string {
  if (n.kind === 'entry') return (n as { name: string }).name;
  if (n.title) return n.title;
  if (n.kind === 'decision') return (n as { question: string }).question || 'Decision';
  if (n.kind === 'guardrail') return (n as { text: string }).text || 'Guardrail';
  if (n.kind === 'loop') return 'Repeat';
  if (n.kind === 'output_format') return 'Output format';
  if (n.kind === 'checklist')
    return (n as { variant: string }).variant === 'red-flags' ? 'Red flags' : 'Checklist';
  if (n.kind === 'example')
    return (n as { label?: string }).label
      ? `Example ${(n as { label?: string }).label}`
      : 'Example';
  if (n.kind === 'raw_markdown') return 'Markdown';
  if (n.kind === 'catalog') return 'Catalog';
  if (n.kind === 'skill_call') return `/${(n as { skill: string }).skill}`;
  return KIND_META[n.kind as NodeKind]?.label ?? n.kind;
}
