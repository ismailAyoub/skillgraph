import type { Layout, SkillDoc, SkillEdge, SkillNode } from '@skillgraph/core';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import { estimateHeight, GROUP_PAD, NODE_W } from './layout';
import { CONTAINER_KINDS_SET } from './nodeMeta';

export type SkillRFNode = Node<
  { node: SkillNode; issues: number; severity: 'error' | 'warning' | 'info' | null },
  'skill' | 'group'
>;
export type SkillRFEdge = Edge<{ kind: SkillEdge['kind']; edge: SkillEdge }>;

export const EDGE_STYLE: Record<
  SkillEdge['kind'],
  { stroke: string; dash?: string; label?: (e: SkillEdge) => string | undefined }
> = {
  next: { stroke: '#495057' },
  branch: { stroke: '#b7791f', label: (e) => e.label ?? (e.isDefault ? 'otherwise' : 'case') },
  reads: { stroke: '#1c7ed6', dash: '5 4', label: () => 'reads' },
  runs: { stroke: '#495057', dash: '5 4', label: () => 'runs' },
  attaches: { stroke: '#c53030', dash: '2 4', label: () => 'applies to' },
};

interface Sized {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compute group boxes from their children (bottom-up) so containers always wrap their content. */
function computeBoxes(doc: SkillDoc, layout: Layout): Map<string, Sized> {
  const boxes = new Map<string, Sized>();
  const byParent = new Map<string | null, SkillNode[]>();
  for (const n of doc.nodes) {
    const p = n.parentId ?? null;
    const list = byParent.get(p) ?? [];
    list.push(n);
    byParent.set(p, list);
  }
  const size = (n: SkillNode): Sized => {
    const cached = boxes.get(n.id);
    if (cached) return cached;
    const l = layout.nodes[n.id] ?? { x: 0, y: 0 };
    if (CONTAINER_KINDS_SET.has(n.kind)) {
      const kids = byParent.get(n.id) ?? [];
      let maxX = 200;
      let maxY = 60;
      for (const k of kids) {
        const s = size(k);
        maxX = Math.max(maxX, s.x + s.w);
        maxY = Math.max(maxY, s.y + s.h);
      }
      const box = {
        x: l.x,
        y: l.y,
        w: Math.max(l.w ?? 0, maxX + GROUP_PAD.right),
        h: Math.max(l.h ?? 0, maxY + GROUP_PAD.bottom),
      };
      boxes.set(n.id, box);
      return box;
    }
    const box = { x: l.x, y: l.y, w: l.w ?? NODE_W, h: l.h ?? estimateHeight(n, l) };
    boxes.set(n.id, box);
    return box;
  };
  for (const n of doc.nodes) size(n);
  return boxes;
}

export function toFlow(
  doc: SkillDoc,
  layout: Layout,
  selectedId: string | null,
  issuesByNode: Map<string, { count: number; severity: 'error' | 'warning' | 'info' }>,
): { nodes: SkillRFNode[]; edges: SkillRFEdge[] } {
  const boxes = computeBoxes(doc, layout);
  const depth = (n: SkillNode): number => {
    let d = 0;
    let cur: SkillNode | undefined = n;
    const byId = new Map(doc.nodes.map((x) => [x.id, x]));
    while (cur?.parentId) {
      d++;
      cur = byId.get(cur.parentId);
    }
    return d;
  };
  const ordered = [...doc.nodes]
    .filter((n) => n.kind !== 'note' || true)
    .sort((a, b) => depth(a) - depth(b));
  const nodes: SkillRFNode[] = ordered.map((n) => {
    const box = boxes.get(n.id) as Sized;
    const isGroup = CONTAINER_KINDS_SET.has(n.kind);
    const issue = issuesByNode.get(n.id);
    return {
      id: n.id,
      type: isGroup ? 'group' : 'skill',
      position: { x: box.x, y: box.y },
      data: { node: n, issues: issue?.count ?? 0, severity: issue?.severity ?? null },
      parentId: n.parentId ?? undefined,
      extent: n.parentId ? 'parent' : undefined,
      selected: n.id === selectedId,
      draggable: true,
      style: isGroup ? { width: box.w, height: box.h } : { width: NODE_W },
      zIndex: isGroup ? 0 : 1,
    };
  });
  const ids = new Set(doc.nodes.map((n) => n.id));
  const edges: SkillRFEdge[] = doc.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => {
      const style = EDGE_STYLE[e.kind];
      const lateral = e.kind === 'reads' || e.kind === 'runs' || e.kind === 'attaches';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: lateral ? 'side-out' : 'out',
        targetHandle: lateral ? 'side-in' : 'in',
        type: 'smoothstep',
        label: style.label?.(e),
        labelStyle: { fontSize: 10, fill: style.stroke },
        labelBgStyle: { fill: '#ffffff' },
        style: { stroke: style.stroke, strokeDasharray: style.dash },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 16, height: 16 },
        data: { kind: e.kind, edge: e },
        zIndex: 2,
      };
    });
  return { nodes, edges };
}

/** Absolute position of a node (walking up parents) for hit-testing containers. */
export function absolutePosition(
  id: string,
  doc: SkillDoc,
  layout: Layout,
): { x: number; y: number } {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  let x = 0;
  let y = 0;
  let cur = byId.get(id);
  while (cur) {
    const l = layout.nodes[cur.id];
    x += l?.x ?? 0;
    y += l?.y ?? 0;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { x, y };
}

/** Find the deepest container whose box contains the point (absolute coords), excluding `excludeId` and its descendants. */
export function containerAt(
  point: { x: number; y: number },
  doc: SkillDoc,
  layout: Layout,
  excludeId: string,
): string | null {
  const boxes = computeBoxes(doc, layout);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const isDescendant = (id: string): boolean => {
    let cur = byId.get(id);
    while (cur?.parentId) {
      if (cur.parentId === excludeId) return true;
      cur = byId.get(cur.parentId);
    }
    return false;
  };
  let best: { id: string; depth: number } | null = null;
  for (const n of doc.nodes) {
    if (!CONTAINER_KINDS_SET.has(n.kind) || n.id === excludeId || isDescendant(n.id)) continue;
    const abs = absolutePosition(n.id, doc, layout);
    const box = boxes.get(n.id) as Sized;
    if (
      point.x >= abs.x &&
      point.x <= abs.x + box.w &&
      point.y >= abs.y &&
      point.y <= abs.y + box.h
    ) {
      let d = 0;
      let cur: SkillNode | undefined = n;
      while (cur?.parentId) {
        d++;
        cur = byId.get(cur.parentId);
      }
      if (!best || d > best.depth) best = { id: n.id, depth: d };
    }
  }
  return best?.id ?? null;
}
