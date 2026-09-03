import type { GraphPatchT, SkillFile, SkillNode } from '@skillgraph/core';
import { UNPACKABLE_KINDS } from '@skillgraph/core';
import { type Box, estimateHeight, NODE_W } from './layout';

const GAP = 18;
const INSET = { x: 16, y: 44 };
const UNPACKABLE = new Set<string>(UNPACKABLE_KINDS);

interface Anchor {
  node: SkillNode;
  parentId: string | null;
  /** The source's own box, when it had one. */
  box: Box | undefined;
  /** The source survives the patch (a step keeping its other text), so its run starts below it. */
  stays: boolean;
  x: number;
  startY: number;
}

/**
 * Canvas boxes for the nodes an unpack patch adds, so they fan out below the node they came from
 * instead of piling up at the container origin. A patch may unpack several nodes (the Import
 * panel does), so ops are walked in order and each source anchors the nodes that follow it.
 *
 * A source with a box hands its column and its slot to the run; a source without one starts below
 * the lowest placed sibling. Nodes nested inside a phase this unpack created stack inside that
 * phase. Siblings below the source slide down, but only when that container has a single source:
 * with several, the offsets would compound and auto-layout is the better answer.
 */
export function placeUnpacked(file: SkillFile, patch: GraphPatchT): Record<string, Box> {
  const boxOf = (id: string): Box | undefined => file.layout.nodes[id];
  const siblingsOf = (parentId: string | null, exclude: ReadonlySet<string>): SkillNode[] =>
    file.doc.nodes.filter((n) => (n.parentId ?? null) === parentId && !exclude.has(n.id));

  // Every node this patch unpacks, in op order. A `stepStyle` update on a phase is not a source.
  const sources: { id: string; stays: boolean }[] = [];
  for (const op of patch.ops) {
    if (op.op !== 'remove' && op.op !== 'update') continue;
    const node = file.doc.nodes.find((n) => n.id === op.id);
    if (node && UNPACKABLE.has(node.kind)) sources.push({ id: op.id, stays: op.op === 'update' });
  }
  const sourceIds = new Set(sources.map((s) => s.id));
  const perContainer = new Map<string | null, number>();
  for (const s of sources) {
    const node = file.doc.nodes.find((n) => n.id === s.id);
    if (!node) continue;
    const key = node.parentId ?? null;
    perContainer.set(key, (perContainer.get(key) ?? 0) + 1);
  }

  const boxes: Record<string, Box> = {};
  const cursors = new Map<string | null, number>();

  const anchorFor = (id: string, stays: boolean): Anchor | null => {
    const node = file.doc.nodes.find((n) => n.id === id);
    if (!node) return null;
    const parentId = node.parentId ?? null;
    const box = boxOf(id);
    let x = INSET.x;
    let startY = INSET.y;
    if (box) {
      x = box.x;
      startY = stays ? box.y + estimateHeight(node, box) + GAP : box.y;
    } else {
      // No box of its own: go under the lowest sibling that has one, or anything already placed.
      for (const n of siblingsOf(parentId, sourceIds)) {
        const b = boxOf(n.id);
        if (b) startY = Math.max(startY, b.y + estimateHeight(n, b) + GAP);
      }
      for (const [placedId, b] of Object.entries(boxes)) {
        const placed = patch.ops.find((op) => op.op === 'add' && op.node.id === placedId);
        if (placed?.op === 'add' && (placed.node.parentId ?? null) === parentId)
          startY = Math.max(startY, b.y + estimateHeight(placed.node, b) + GAP);
      }
    }
    return { node, parentId, box, stays, x, startY };
  };

  let anchor: Anchor | null = null;
  let sourceIndex = 0;
  for (const op of patch.ops) {
    if (op.op === 'remove' || op.op === 'update') {
      const next = sources[sourceIndex];
      if (next && next.id === op.id) {
        sourceIndex += 1;
        anchor = anchorFor(next.id, next.stays);
        if (anchor) cursors.set(anchor.parentId, anchor.startY);
      }
      continue;
    }
    if (op.op !== 'add' || !anchor) continue;
    const parent = op.node.parentId ?? null;
    const inNewContainer = parent !== null && parent in boxes;
    const x = inNewContainer ? INSET.x : anchor.parentId === parent ? anchor.x : INSET.x;
    const fallback = inNewContainer ? INSET.y : anchor.startY;
    const y = cursors.get(parent) ?? fallback;
    const box: Box = { x, y };
    if (op.node.kind === 'phase' || op.node.kind === 'loop') box.w = NODE_W + 2 * INSET.x;
    boxes[op.node.id] = box;
    cursors.set(parent, y + estimateHeight(op.node, box) + GAP);
  }

  // The run took the source's slot: slide the siblings that sat below it. Single-source only.
  for (const s of sources) {
    const a = anchorFor(s.id, s.stays);
    if (!a?.box || (perContainer.get(a.parentId) ?? 0) !== 1) continue;
    const added = (cursors.get(a.parentId) ?? a.startY) - a.startY;
    const freed = s.stays ? 0 : estimateHeight(a.node, a.box) + GAP;
    const delta = added - freed;
    if (delta <= 0) continue;
    for (const n of siblingsOf(a.parentId, sourceIds)) {
      const b = boxOf(n.id);
      if (b && b.y > a.box.y) boxes[n.id] = { ...b, y: b.y + delta };
    }
  }
  return boxes;
}
