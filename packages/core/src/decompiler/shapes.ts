import type { Heading, ListItem, Paragraph, PhrasingContent } from 'mdast';
import { inlineToMarkdown } from '../markdown/index';

/**
 * Shape recognizers shared by the decompiler (SKILL.md -> graph) and `unpackNode`
 * (a markdown blob inside a node -> nodes): which headings announce guardrails, steps,
 * outputs or checklists, and how a list item splits into a bold lead and the rest.
 */
export const GUARD_HEADING =
  /anti-?pattern|guideline|principle|rule|do not|don'?t|avoid|never|always|tone|philosophy|pitfall|gotcha|constraint|red flag/i;
export const STEP_HEADING =
  /how it works|process|workflow|steps|phase|procedure|instructions|approach|usage/i;
export const OUTPUT_HEADING = /output|template|report|format|structure|deliverable/i;
export const RED_FLAG_HEADING = /red flag/i;
export const VERIFY_HEADING = /verif|checklist|check|before shipping|done when/i;
export const DONT_RE = /^(don'?t|do not|never|avoid|no |stop )/i;

export function headingText(h: Heading): string {
  return inlineToMarkdown(h.children);
}

export function isSimpleItem(item: ListItem): item is ListItem & { children: [Paragraph] } {
  return item.children.length === 1 && item.children[0]?.type === 'paragraph';
}

export function startsWithStrong(item: ListItem): boolean {
  const first = item.children[0];
  return first?.type === 'paragraph' && first.children[0]?.type === 'strong';
}

/** Split a paragraph that opens with `**bold**` into the lead and the remaining inline content. */
export function splitLead(p: Paragraph): { lead?: string; rest: PhrasingContent[] } {
  const first = p.children[0];
  if (first?.type !== 'strong') return { rest: p.children };
  const rest = [...p.children.slice(1)];
  const r0 = rest[0];
  if (r0 && r0.type === 'text') {
    const value = r0.value.replace(/^ /, '');
    if (value.length === 0) rest.shift();
    else rest[0] = { ...r0, value };
  }
  return { lead: inlineToMarkdown(first.children), rest };
}
