import type { SkillDoc, SkillNode } from '@skillgraph/core';
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { CONTAINER_KINDS_SET, FILE_KINDS_SET } from './nodeMeta';

export interface Box {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

const elk = new ELK();

export const NODE_W = 220;
export const GROUP_PAD = { top: 40, left: 16, right: 16, bottom: 16 };

export function estimateHeight(n: SkillNode, measured?: { w?: number; h?: number }): number {
  if (measured?.h) return measured.h;
  const r = n as Record<string, unknown>;
  const text = ['instruction', 'question', 'description', 'task', 'text', 'body', 'path', 'until']
    .map((k) => (typeof r[k] === 'string' ? (r[k] as string) : ''))
    .join(' ');
  const lines = Math.min(4, Math.max(1, Math.ceil(text.length / 34)));
  return 44 + lines * 16;
}

/** Auto-layout the whole doc with ELK (layered, top-down, compound nodes for containers). */
export async function autoLayout(
  doc: SkillDoc,
  measured: Record<string, Box> = {},
): Promise<Record<string, Box>> {
  const byParent = new Map<string | null, SkillNode[]>();
  for (const n of doc.nodes) {
    if (n.kind === 'entry' || n.kind === 'note') continue;
    const p = n.parentId ?? null;
    const list = byParent.get(p) ?? [];
    list.push(n);
    byParent.set(p, list);
  }
  for (const list of byParent.values())
    list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const build = (parentId: string | null): ElkNode[] =>
    (byParent.get(parentId) ?? []).map((n) => {
      const isContainer = CONTAINER_KINDS_SET.has(n.kind);
      const node: ElkNode = {
        id: n.id,
        width: NODE_W,
        height: isContainer ? 80 : estimateHeight(n, measured[n.id]),
      };
      if (isContainer) {
        node.children = build(n.id);
        node.layoutOptions = {
          'elk.padding': `[top=${GROUP_PAD.top},left=${GROUP_PAD.left},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.right}]`,
          'elk.direction': 'DOWN',
        };
      }
      return node;
    });

  const ids = new Set(doc.nodes.map((n) => n.id));
  const edges: ElkExtendedEdge[] = doc.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== 'entry_root')
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  // Reading order: consecutive flow siblings without a flow edge between them get a layout-only edge,
  // so phases stack top-down in `order` and disconnected steps do not spread sideways.
  const flowEdgeKey = new Set(
    doc.edges
      .filter((e) => e.kind === 'next' || e.kind === 'branch')
      .map((e) => `${e.source}>${e.target}`),
  );
  const hasFlowEdge = (id: string) =>
    doc.edges.some(
      (e) => (e.kind === 'next' || e.kind === 'branch') && (e.source === id || e.target === id),
    );
  for (const [, siblings] of byParent) {
    const flow = siblings.filter(
      (n) => !FILE_KINDS_SET.has(n.kind) && n.kind !== 'guardrail' && n.kind !== 'example',
    );
    for (let i = 0; i + 1 < flow.length; i++) {
      const a = flow[i] as SkillNode;
      const b = flow[i + 1] as SkillNode;
      if (flowEdgeKey.has(`${a.id}>${b.id}`)) continue;
      if (
        hasFlowEdge(a.id) &&
        hasFlowEdge(b.id) &&
        !CONTAINER_KINDS_SET.has(a.kind) &&
        !CONTAINER_KINDS_SET.has(b.kind)
      )
        continue;
      edges.push({ id: `virtual-${a.id}-${b.id}`, sources: [a.id], targets: [b.id] });
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.componentComponent': '48',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: [{ id: 'entry_root', width: NODE_W, height: 70 }, ...build(null)],
    edges,
  };

  const out = await elk.layout(graph);
  const result: Record<string, Box> = {};
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      result[c.id] = { x: c.x ?? 0, y: c.y ?? 0, w: c.width, h: c.height };
      walk(c);
    }
  };
  walk(out);
  // Keep entry at the top-left of the canvas.
  const entry = result.entry_root;
  if (entry) result.entry_root = { ...entry, x: 24, y: 24 };
  return result;
}
