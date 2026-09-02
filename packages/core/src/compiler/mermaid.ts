import type { SkillNode } from '../schema/graph';
import { isKnownNode } from '../schema/graph';
import type { Ctx } from './context';

function label(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 60);
}

function shape(n: SkillNode): [string, string] {
  switch (n.kind) {
    case 'decision':
      return ['{', '}'];
    case 'ask_user':
      return ['[/', '/]'];
    case 'reference':
    case 'script':
    case 'asset':
      return ['[(', ')]'];
    default:
      return ['[', ']'];
  }
}

function nodeText(n: SkillNode): string {
  if (n.title) return n.title;
  if (n.kind === 'raw_markdown')
    return (
      (n as { body: string }).body
        .split('\n')[0]
        ?.replace(/^[#>*\-\s]+/, '')
        .trim() || 'markdown'
    );
  const r = n as Record<string, unknown>;
  for (const k of ['question', 'instruction', 'task', 'text', 'path', 'until', 'skill']) {
    if (typeof r[k] === 'string' && (r[k] as string).trim()) return (r[k] as string).trim();
  }
  return n.kind;
}

/** A `flowchart TD` view of the skill: phases as subgraphs, flow nodes as boxes, next/branch edges as arrows. */
export function toMermaid(ctx: Ctx): string {
  const lines: string[] = ['flowchart TD'];
  const rendered = new Set<string>();
  const mid = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

  const emitContainer = (parentId: string | null, indent: string) => {
    for (const n of ctx.children(parentId)) {
      if (!isKnownNode(n)) continue;
      if (n.kind === 'entry' || n.kind === 'note') continue;
      if (n.kind === 'phase' || n.kind === 'loop') {
        lines.push(`${indent}subgraph ${mid(n.id)}["${label(nodeText(n))}"]`);
        emitContainer(n.id, `${indent}  `);
        lines.push(`${indent}end`);
        rendered.add(n.id);
        continue;
      }
      const [open, close] = shape(n);
      lines.push(`${indent}${mid(n.id)}${open}"${label(nodeText(n))}"${close}`);
      rendered.add(n.id);
    }
  };
  emitContainer(null, '  ');

  for (const e of ctx.doc.edges) {
    if (!rendered.has(e.source) || !rendered.has(e.target)) continue;
    if (e.kind === 'next') lines.push(`  ${mid(e.source)} --> ${mid(e.target)}`);
    else if (e.kind === 'branch')
      lines.push(
        `  ${mid(e.source)} -->|"${label(e.label ?? (e.isDefault ? 'otherwise' : ''))}"| ${mid(e.target)}`,
      );
    else if (e.kind === 'reads' || e.kind === 'runs')
      lines.push(`  ${mid(e.source)} -.-> ${mid(e.target)}`);
  }
  return `${lines.join('\n')}\n`;
}
