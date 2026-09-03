import type { Heading, List, Paragraph, RootContent } from 'mdast';
import {
  DONT_RE,
  GUARD_HEADING,
  headingText,
  isSimpleItem,
  RED_FLAG_HEADING,
  splitLead,
  startsWithStrong,
  VERIFY_HEADING,
} from '../decompiler/shapes';
import { blocksToMarkdown, inlineToMarkdown, mdBlocks, plainText } from '../markdown/index';
import { applyPatch, type GraphPatchT, type PatchOpT } from '../patch/index';
import {
  FLOW_KINDS,
  type NodeKind,
  type PhaseNodeT,
  type RawMarkdownNodeT,
  type ReferenceNodeT,
  type SkillDoc,
  type SkillEdge,
  type SkillNode,
  type StepNodeT,
} from '../schema/graph';
import { newId } from '../util/ids';

/**
 * Unpack: turn a procedure that hides inside one node's markdown (a `raw_markdown` body, a
 * `references/*.md` that is really the workflow, or a step whose instruction embeds a numbered
 * list) into the nodes it should have been, so the canvas shows the steps instead of one blob.
 * Deterministic, no AI: the same recognizers the decompiler uses, in a permissive mode where any
 * list becomes nodes.
 */

export interface MarkdownShape {
  /** Top-level list items across every list in the fragment. */
  items: number;
  /** Items that read as steps: every item of an ordered list, or of a bullet list whose items all open with a bold lead. Task lists do not count. */
  stepItems: number;
  headings: number;
  /** Share of the fragment (by characters) taken by step-like lists, 0..1. */
  share: number;
}

export type UnpackableKind = 'raw_markdown' | 'reference' | 'step';
export const UNPACKABLE_KINDS: readonly UnpackableKind[] = ['raw_markdown', 'reference', 'step'];

function isTaskList(lst: List): boolean {
  return (
    lst.children.length > 0 &&
    lst.children.every((it) => it.checked !== null && it.checked !== undefined)
  );
}

/** An ordered list, or a bullet list whose every item opens with a bold lead. */
function isStepList(lst: List): boolean {
  if (isTaskList(lst)) return false;
  return lst.ordered === true || (lst.children.length > 0 && lst.children.every(startsWithStrong));
}

/** Count what a markdown fragment holds; the basis of every unpack decision. */
export function measureMarkdown(text: string): MarkdownShape {
  const blocks = mdBlocks(text);
  let items = 0;
  let stepItems = 0;
  let headings = 0;
  let stepChars = 0;
  let total = 0;
  for (const b of blocks) {
    const len = blocksToMarkdown([b]).length;
    total += len;
    if (b.type === 'heading') headings += 1;
    else if (b.type === 'list') {
      items += b.children.length;
      if (isStepList(b)) {
        stepItems += b.children.length;
        stepChars += len;
      }
    }
  }
  return { items, stepItems, headings, share: total > 0 ? stepChars / total : 0 };
}

/**
 * What `unpackNode` would find in this node, or null when there is nothing to unpack:
 * - raw_markdown: any list of two or more items, or a heading;
 * - reference (inline): a body that is mostly a procedure (three or more step-like items making up at least half of it);
 * - step: an instruction embedding three or more step-like items.
 */
export function unpackShape(node: SkillNode): MarkdownShape | null {
  switch (node.kind) {
    case 'raw_markdown': {
      const s = measureMarkdown((node as RawMarkdownNodeT).body ?? '');
      return s.items >= 2 || s.headings >= 1 ? s : null;
    }
    case 'reference': {
      const r = node as ReferenceNodeT;
      if (r.source !== 'inline' || !r.body) return null;
      const s = measureMarkdown(r.body);
      return s.stepItems >= 3 && s.share >= 0.5 ? s : null;
    }
    case 'step': {
      const s = measureMarkdown((node as StepNodeT).instruction ?? '');
      return s.stepItems >= 3 ? s : null;
    }
    default:
      return null;
  }
}

/** Every node of the doc that `unpackNode` accepts, in doc order. */
export function unpackableNodes(doc: SkillDoc): { node: SkillNode; shape: MarkdownShape }[] {
  const out: { node: SkillNode; shape: MarkdownShape }[] = [];
  for (const node of doc.nodes) {
    const shape = unpackShape(node);
    if (shape) out.push({ node, shape });
  }
  return out;
}

export interface UnpackOptions {
  /** Id generator (default `newId`; tests pass `sequentialIds()`). */
  id?: (kind: string) => string;
}

// ---- markdown fragment -> nodes ----

interface Frame {
  id: string | null;
  depth: number;
  /** Plain-text title of the section, for the heading heuristics. */
  title: string;
  /** A phase created by this conversion: leading prose becomes its intro, its lists are chained. */
  fresh: boolean;
  /** Last node emitted directly in this frame. */
  last: SkillNode | null;
}

interface ConvertOptions {
  parentId: string | null;
  /** Order of the first node emitted directly under `parentId`. */
  order: number;
  provenance: SkillNode['provenance'];
  id: (kind: string) => string;
  /** Title of the enclosing section (the heading heuristics apply to root-level lists). */
  title: string;
}

interface Converted {
  nodes: SkillNode[];
  edges: SkillEdge[];
}

function convertBlocks(blocks: RootContent[], opts: ConvertOptions): Converted {
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];
  const orders = new Map<string | null, number>([[opts.parentId, opts.order]]);
  const nextOrder = (parent: string | null): number => {
    const n = orders.get(parent) ?? 1;
    orders.set(parent, n + 1);
    return n;
  };
  const stack: Frame[] = [
    { id: opts.parentId, depth: 0, title: opts.title, fresh: false, last: null },
  ];
  const top = (): Frame => stack[stack.length - 1] as Frame;
  const base = (kind: string, frame: Frame) => ({
    id: opts.id(kind),
    parentId: frame.id,
    order: nextOrder(frame.id),
    provenance: opts.provenance,
  });
  const emit = (node: SkillNode, frame: Frame): void => {
    nodes.push(node);
    frame.last = node;
  };
  const appendIntro = (frame: Frame, md: string): void => {
    const phase = nodes.find((n) => n.id === frame.id) as PhaseNodeT | undefined;
    if (!phase) return;
    phase.intro = phase.intro ? `${phase.intro}\n\n${md}` : md;
  };

  const stepsFromList = (lst: List, style: 'numbered' | 'bulleted'): void => {
    const frame = top();
    let prev: SkillNode | null = null;
    lst.children.forEach((item, idx) => {
      const children = [...item.children] as RootContent[];
      let title: string | undefined;
      const p0 = children[0];
      if (p0 && p0.type === 'paragraph') {
        const { lead, rest } = splitLead(p0);
        if (lead !== undefined) {
          title = lead;
          if (rest.length === 0) children.shift();
          else children[0] = { ...p0, children: rest };
        }
      }
      const node: StepNodeT = {
        ...base('step', frame),
        kind: 'step',
        instruction: blocksToMarkdown(children),
      };
      if (title) node.title = title;
      if (idx === 0 && style === 'bulleted') node.listStyle = 'bulleted';
      emit(node, frame);
      if (prev && frame.fresh)
        edges.push({ id: opts.id('edge'), kind: 'next', source: prev.id, target: node.id });
      prev = node;
    });
  };

  const checklistFromList = (
    lst: List,
    variant: 'verification' | 'red-flags' | 'custom',
    style: 'task' | 'bullet',
  ): void => {
    const frame = top();
    const items = lst.children.map((item) => {
      const p0 = item.children[0] as Paragraph;
      const text = inlineToMarkdown(p0.children);
      return style === 'task' ? { text, checked: item.checked ?? false } : { text };
    });
    emit({ ...base('checklist', frame), kind: 'checklist', variant, style, items }, frame);
  };

  const guardrailsFromList = (lst: List): void => {
    const frame = top();
    for (const item of lst.children) {
      const p0 = item.children[0] as Paragraph;
      const { lead, rest } = splitLead(p0);
      const node: SkillNode = {
        ...base('guardrail', frame),
        kind: 'guardrail',
        polarity: DONT_RE.test(plainText(p0.children)) ? 'dont' : 'do',
        text: lead ?? '',
      };
      if (rest.length) node.why = inlineToMarkdown(rest);
      emit(node, frame);
    }
  };

  for (const b of blocks) {
    if (b.type === 'heading') {
      while (top().depth >= b.depth) stack.pop();
      const parent = top();
      const phase: PhaseNodeT = {
        ...base('phase', parent),
        kind: 'phase',
        title: headingText(b as Heading),
        stepStyle: 'numbered',
      };
      emit(phase, parent);
      stack.push({
        id: phase.id,
        depth: b.depth,
        title: plainText(b.children),
        fresh: true,
        last: null,
      });
      continue;
    }
    const frame = top();
    if (b.type === 'list') {
      const allSimple = b.children.every(isSimpleItem);
      const allStrong = b.children.length > 0 && b.children.every(startsWithStrong);
      if (isTaskList(b) && allSimple) {
        checklistFromList(
          b,
          VERIFY_HEADING.test(frame.title)
            ? 'verification'
            : RED_FLAG_HEADING.test(frame.title)
              ? 'red-flags'
              : 'custom',
          'task',
        );
      } else if (b.ordered) {
        stepsFromList(b, 'numbered');
      } else if (allSimple && RED_FLAG_HEADING.test(frame.title) && !allStrong) {
        checklistFromList(b, 'red-flags', 'bullet');
      } else if (allSimple && allStrong && GUARD_HEADING.test(frame.title)) {
        guardrailsFromList(b);
      } else {
        stepsFromList(b, 'bulleted');
      }
      continue;
    }
    if (b.type === 'thematicBreak') continue;
    const md = blocksToMarkdown([b]);
    if (b.type === 'paragraph') {
      if (frame.fresh && frame.last === null) {
        appendIntro(frame, md);
        continue;
      }
      const { lead, rest } = splitLead(b);
      const node: StepNodeT = {
        ...base('step', frame),
        kind: 'step',
        instruction: lead !== undefined ? inlineToMarkdown(rest) : md,
      };
      if (lead) node.title = lead;
      emit(node, frame);
      continue;
    }
    // Code, tables, quotes, HTML: ride along with the step they follow, or open the section.
    if (frame.last?.kind === 'step') {
      const step = frame.last as StepNodeT;
      step.instruction = step.instruction ? `${step.instruction}\n\n${md}` : md;
    } else if (frame.fresh && frame.last === null) {
      appendIntro(frame, md);
    } else {
      emit({ ...base('raw_markdown', frame), kind: 'raw_markdown', body: md }, frame);
    }
  }
  return { nodes, edges };
}

// ---- placement ----

function isFlow(n: SkillNode): boolean {
  return FLOW_KINDS.has(n.kind as NodeKind);
}

function siblingsOf(doc: SkillDoc, parentId: string | null): SkillNode[] {
  return doc.nodes.filter((n) => (n.parentId ?? null) === parentId);
}

function containerHasFlow(doc: SkillDoc, parentId: string | null): boolean {
  const ids = new Set(siblingsOf(doc, parentId).map((n) => n.id));
  return doc.edges.some((e) => (e.kind === 'next' || e.kind === 'branch') && ids.has(e.source));
}

function sectionTitle(doc: SkillDoc, parentId: string | null): string {
  if (parentId === null) return '';
  const parent = doc.nodes.find((n) => n.id === parentId);
  return parent?.title ? plainText(mdBlocksInline(parent.title)) : '';
}

function mdBlocksInline(text: string) {
  const first = mdBlocks(text)[0];
  return first && first.type === 'paragraph' ? first.children : [];
}

/** Move every sibling at `order >= from` (except `exclude`) up by `by`, last first. */
function shiftOps(
  doc: SkillDoc,
  parentId: string | null,
  from: number,
  by: number,
  exclude: string,
): PatchOpT[] {
  if (by <= 0) return [];
  return siblingsOf(doc, parentId)
    .filter((n) => n.id !== exclude && n.order >= from)
    .sort((a, b) => b.order - a.order)
    .map((n) => ({ op: 'move', id: n.id, parentId, order: n.order + by }));
}

function nextEdge(id: string, source: string, target: string): SkillEdge {
  return { id, kind: 'next', source, target };
}

/**
 * Connect a run of new top-level nodes into the flow: `before -> first`, the run in sequence,
 * `last -> after`. Only when every node in the run is a flow node.
 */
function chainOps(
  run: SkillNode[],
  before: string | null,
  after: string | null,
  id: (kind: string) => string,
): PatchOpT[] {
  if (run.length === 0 || !run.every(isFlow)) return [];
  const ops: PatchOpT[] = [];
  const first = run[0] as SkillNode;
  const last = run[run.length - 1] as SkillNode;
  if (before) ops.push({ op: 'addEdge', edge: nextEdge(id('edge'), before, first.id) });
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1] as SkillNode;
    const b = run[i] as SkillNode;
    ops.push({ op: 'addEdge', edge: nextEdge(id('edge'), a.id, b.id) });
  }
  if (after) ops.push({ op: 'addEdge', edge: nextEdge(id('edge'), last.id, after) });
  return ops;
}

function flowEdges(
  doc: SkillDoc,
  nodeId: string,
): { incoming: SkillEdge[]; outgoing: SkillEdge[] } {
  const flow = doc.edges.filter((e) => e.kind === 'next');
  return {
    incoming: flow.filter((e) => e.target === nodeId),
    outgoing: flow.filter((e) => e.source === nodeId),
  };
}

/**
 * Where a run of new nodes joins the container's chain when the replaced node had no flow edges
 * of its own: the flow sibling just before it (if that one has no outgoing next edge) and the
 * one just after (if it has no incoming one).
 */
function looseNeighbours(
  doc: SkillDoc,
  parentId: string | null,
  order: number,
  exclude: string,
): { before: string | null; after: string | null } {
  const flow = siblingsOf(doc, parentId)
    .filter((n) => n.id !== exclude && isFlow(n))
    .sort((a, b) => a.order - b.order);
  const prev = [...flow].reverse().find((n) => n.order <= order);
  const next = flow.find((n) => n.order > order);
  return {
    before: prev && flowEdges(doc, prev.id).outgoing.length === 0 ? prev.id : null,
    after: next && flowEdges(doc, next.id).incoming.length === 0 ? next.id : null,
  };
}

/** Replace `node` in place: its slot and its flow edges go to the converted nodes. */
function replaceInPlace(
  doc: SkillDoc,
  node: SkillNode,
  blocks: RootContent[],
  id: (kind: string) => string,
): GraphPatchT {
  const parentId = node.parentId ?? null;
  const { nodes, edges } = convertBlocks(blocks, {
    parentId,
    order: node.order,
    provenance: node.provenance,
    id,
    title: sectionTitle(doc, parentId),
  });
  const run = nodes.filter((n) => (n.parentId ?? null) === parentId);
  const { incoming, outgoing } = flowEdges(doc, node.id);
  const loose = looseNeighbours(doc, parentId, node.order, node.id);
  const chain = containerHasFlow(doc, parentId);
  const ops: PatchOpT[] = [
    { op: 'remove', id: node.id },
    ...shiftOps(doc, parentId, node.order, run.length - 1, node.id),
    ...nodes.map((n): PatchOpT => ({ op: 'add', node: n })),
    ...edges.map((e): PatchOpT => ({ op: 'addEdge', edge: e })),
    ...(chain
      ? chainOps(run, incoming[0]?.source ?? loose.before, outgoing[0]?.target ?? loose.after, id)
      : []),
  ];
  return { ops };
}

/** Insert the converted nodes right after `host` in its container. */
function insertAfter(
  doc: SkillDoc,
  host: SkillNode,
  blocks: RootContent[],
  provenance: SkillNode['provenance'],
  id: (kind: string) => string,
): { ops: PatchOpT[]; run: SkillNode[] } {
  const parentId = host.parentId ?? null;
  const { nodes, edges } = convertBlocks(blocks, {
    parentId,
    order: host.order + 1,
    provenance,
    id,
    title: sectionTitle(doc, parentId),
  });
  const run = nodes.filter((n) => (n.parentId ?? null) === parentId);
  const { outgoing } = flowEdges(doc, host.id);
  const chain = containerHasFlow(doc, parentId);
  const ops: PatchOpT[] = [
    ...shiftOps(doc, parentId, host.order + 1, run.length, host.id),
    ...nodes.map((n): PatchOpT => ({ op: 'add', node: n })),
    ...edges.map((e): PatchOpT => ({ op: 'addEdge', edge: e })),
  ];
  if (chain && run.every(isFlow)) {
    const out = outgoing[0];
    if (out) ops.push({ op: 'removeEdge', id: out.id });
    const after = out?.target ?? looseNeighbours(doc, parentId, host.order, host.id).after;
    ops.push(...chainOps(run, host.id, after, id));
  }
  return { ops, run };
}

function unpackRaw(doc: SkillDoc, node: RawMarkdownNodeT, id: (kind: string) => string) {
  return replaceInPlace(doc, node, mdBlocks(node.body ?? ''), id);
}

function unpackStep(doc: SkillDoc, node: StepNodeT, id: (kind: string) => string): GraphPatchT {
  const kept: RootContent[] = [];
  const lists: RootContent[] = [];
  for (const b of mdBlocks(node.instruction ?? '')) {
    if (b.type === 'list' && isStepList(b)) lists.push(b);
    else kept.push(b);
  }
  const hollow = kept.length === 0 && !node.title && !node.why && !node.detail?.length;
  if (hollow) return replaceInPlace(doc, node, lists, id);
  const { ops } = insertAfter(doc, node, lists, node.provenance, id);
  return {
    ops: [{ op: 'update', id: node.id, data: { instruction: blocksToMarkdown(kept) } }, ...ops],
  };
}

function humanize(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.[a-z0-9]+$/i, '');
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Procedure';
}

function unpackReference(
  doc: SkillDoc,
  node: ReferenceNodeT,
  id: (kind: string) => string,
): GraphPatchT {
  const blocks = mdBlocks(node.body ?? '');
  const reads = doc.edges.find((e) => e.kind === 'reads' && e.target === node.id);
  const host = reads ? doc.nodes.find((n) => n.id === reads.source) : undefined;
  if (host && isFlow(host)) {
    const { ops } = insertAfter(doc, host, blocks, node.provenance, id);
    return { ops: [{ op: 'remove', id: node.id }, ...ops] };
  }
  // No step reads it: the procedure becomes a root phase of its own.
  const first = blocks[0];
  const enclosed =
    first?.type === 'heading' &&
    blocks.slice(1).every((b) => b.type !== 'heading' || b.depth > first.depth);
  const wrapped: RootContent[] = enclosed
    ? blocks
    : [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: node.title || humanize(node.path) }],
        },
        ...blocks,
      ];
  const rootFlow = doc.nodes.filter((n) => !n.parentId && isFlow(n));
  const order = Math.max(0, ...rootFlow.map((n) => n.order)) + 1;
  const { nodes, edges } = convertBlocks(wrapped, {
    parentId: null,
    order,
    provenance: node.provenance,
    id,
    title: '',
  });
  return {
    ops: [
      { op: 'remove', id: node.id },
      ...nodes.map((n): PatchOpT => ({ op: 'add', node: n })),
      ...edges.map((e): PatchOpT => ({ op: 'addEdge', edge: e })),
    ],
  };
}

/**
 * The patch that replaces one node's markdown procedure with nodes:
 * - `raw_markdown`: the nodes take its slot (and its flow edges); the raw node is removed;
 * - `step`: the embedded lists become the following sibling steps (chained when the container
 *   uses flow edges); the step keeps its other text, or is removed when it held nothing else;
 * - `reference`: the nodes go right after the step that reads it, or into a new root phase when
 *   nothing reads it; the reference is removed.
 * Headings become nested phases, ordered and bold-led lists become steps, task lists become
 * checklists, bold-led bullets under a rules-like heading become guardrails. Provenance is
 * inherited. Throws when the node is not found or `unpackShape` returns null.
 */
export function unpackNode(doc: SkillDoc, nodeId: string, opts: UnpackOptions = {}): GraphPatchT {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  if (!unpackShape(node)) throw new Error(`Nothing to unpack in ${nodeId} (${node.kind})`);
  const id = opts.id ?? newId;
  switch (node.kind) {
    case 'raw_markdown':
      return unpackRaw(doc, node as RawMarkdownNodeT, id);
    case 'reference':
      return unpackReference(doc, node as ReferenceNodeT, id);
    default:
      return unpackStep(doc, node as StepNodeT, id);
  }
}

/** `unpackNode` over several nodes in sequence, folded into one patch (later ids see earlier changes). */
export function unpackNodes(doc: SkillDoc, ids: string[], opts: UnpackOptions = {}): GraphPatchT {
  let current = doc;
  const ops: PatchOpT[] = [];
  for (const id of ids) {
    const patch = unpackNode(current, id, opts);
    ops.push(...patch.ops);
    current = applyPatch(current, patch).doc;
  }
  return { ops };
}
