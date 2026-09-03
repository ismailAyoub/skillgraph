import type { GraphPatchT, SkillFile, SkillNode } from '@skillgraph/core';
import { type Box, estimateHeight, NODE_W } from './layout';

const GAP = 18;
const INSET = { x: 16, y: 44 };

/**
 * Canvas boxes for the nodes an unpack patch adds, so they fan out below the node they came
 * from instead of piling up at the container origin. When the source had a box, the new nodes
 * take its place and the siblings under it slide down; when it had none, they go under the
 * lowest sibling. Nodes nested inside a phase this unpack created stack inside that phase.
 * Auto-layout can tidy the result later; this only keeps the first view readable.
 */
export function placeUnpacked(file: SkillFile, patch: GraphPatchT): Record<string, Box> {
  const first = patch.ops.find((op) => op.op === 'remove' || op.op === 'update');
  const sourceId = first && (first.op === 'remove' || first.op === 'update') ? first.id : null;
  const source = sourceId ? file.doc.nodes.find((n) => n.id === sourceId) : undefined;
  const sourceBox = sourceId ? file.layout.nodes[sourceId] : undefined;
  const sourceParent = source?.parentId ?? null;
  const sourceStays = first?.op === 'update' && source !== undefined;
  const siblings = file.doc.nodes.filter(
    (n) => (n.parentId ?? null) === sourceParent && n.id !== sourceId,
  );
  const boxOf = (n: SkillNode): Box | undefined => file.layout.nodes[n.id];

  let originX = INSET.x;
  let startY = INSET.y;
  if (sourceBox && source) {
    originX = sourceBox.x;
    startY = sourceStays ? sourceBox.y + estimateHeight(source, sourceBox) + GAP : sourceBox.y;
  } else {
    for (const n of siblings) {
      const b = boxOf(n);
      if (b) startY = Math.max(startY, b.y + estimateHeight(n, b) + GAP);
    }
  }

  const boxes: Record<string, Box> = {};
  // Next free y per container.
  const cursors = new Map<string | null, number>([[sourceParent, startY]]);
  for (const op of patch.ops) {
    if (op.op !== 'add') continue;
    const parent = op.node.parentId ?? null;
    const inNewContainer = parent !== null && parent in boxes;
    const x = inNewContainer ? INSET.x : originX;
    const y = cursors.get(parent) ?? (inNewContainer ? INSET.y : startY);
    const box: Box = { x, y };
    if (op.node.kind === 'phase' || op.node.kind === 'loop') box.w = NODE_W + 2 * INSET.x;
    boxes[op.node.id] = box;
    cursors.set(parent, y + estimateHeight(op.node, box) + GAP);
  }

  // The new run took the source's place: slide the siblings that sat below it.
  if (sourceBox && source) {
    const added = (cursors.get(sourceParent) ?? startY) - startY;
    const freed = sourceStays ? 0 : estimateHeight(source, sourceBox) + GAP;
    const delta = added - freed;
    if (delta > 0) {
      for (const n of siblings) {
        const b = boxOf(n);
        if (b && b.y > sourceBox.y) boxes[n.id] = { ...b, y: b.y + delta };
      }
    }
  }
  return boxes;
}
