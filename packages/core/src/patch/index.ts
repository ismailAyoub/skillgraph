import { z } from 'zod';
import {
  EdgeSchema,
  NodeSchema,
  ProfileSchema,
  type SkillDoc,
  SkillDocSchema,
  type SkillEdge,
  type SkillNode,
} from '../schema/graph';

export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), node: NodeSchema }),
  z.object({ op: z.literal('update'), id: z.string(), data: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({
    op: z.literal('move'),
    id: z.string(),
    parentId: z.string().nullable(),
    order: z.number(),
  }),
  z.object({ op: z.literal('addEdge'), edge: EdgeSchema }),
  z.object({
    op: z.literal('updateEdge'),
    id: z.string(),
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal('removeEdge'), id: z.string() }),
  z.object({ op: z.literal('setProfile'), profile: ProfileSchema }),
  /** Restore a previously removed node together with its edges (used by inverse patches). */
  z.object({ op: z.literal('restore'), node: NodeSchema, edges: z.array(EdgeSchema) }),
]);
export type PatchOpT = z.infer<typeof PatchOp>;

export const GraphPatch = z.object({ ops: z.array(PatchOp) });
export type GraphPatchT = z.infer<typeof GraphPatch>;

export type ApplyResult = { doc: SkillDoc; inverse: GraphPatchT };

function findNode(doc: SkillDoc, id: string): SkillNode {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Node not found: ${id}`);
  return n;
}

function findEdge(doc: SkillDoc, id: string): SkillEdge {
  const e = doc.edges.find((x) => x.id === id);
  if (!e) throw new Error(`Edge not found: ${id}`);
  return e;
}

function pickPrev(
  node: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(data)) prev[k] = node[k];
  return prev;
}

/**
 * Apply a patch to a doc. Returns the new (validated) doc and the inverse patch,
 * so undo/redo comes for free. Pure: the input doc is not mutated.
 */
export function applyPatch(input: SkillDoc, patch: GraphPatchT): ApplyResult {
  let doc: SkillDoc = { profile: input.profile, nodes: [...input.nodes], edges: [...input.edges] };
  const inverseOps: PatchOpT[] = [];

  for (const op of patch.ops) {
    switch (op.op) {
      case 'add': {
        if (doc.nodes.some((n) => n.id === op.node.id))
          throw new Error(`Duplicate node id: ${op.node.id}`);
        doc.nodes.push(op.node);
        inverseOps.unshift({ op: 'remove', id: op.node.id });
        break;
      }
      case 'restore': {
        if (doc.nodes.some((n) => n.id === op.node.id))
          throw new Error(`Duplicate node id: ${op.node.id}`);
        doc.nodes.push(op.node);
        doc.edges.push(...op.edges);
        inverseOps.unshift({ op: 'remove', id: op.node.id });
        break;
      }
      case 'update': {
        const node = findNode(doc, op.id);
        const prev = pickPrev(node as Record<string, unknown>, op.data);
        const next = { ...(node as Record<string, unknown>), ...op.data };
        for (const [k, v] of Object.entries(op.data)) if (v === undefined) delete next[k];
        doc.nodes = doc.nodes.map((n) => (n.id === op.id ? (next as SkillNode) : n));
        inverseOps.unshift({ op: 'update', id: op.id, data: prev });
        break;
      }
      case 'remove': {
        const node = findNode(doc, op.id);
        const incident = doc.edges.filter((e) => e.source === op.id || e.target === op.id);
        // Children are re-parented to the removed node's parent, keeping their relative order.
        const children = doc.nodes.filter((n) => n.parentId === op.id);
        for (const child of children) {
          inverseOps.unshift({
            op: 'move',
            id: child.id,
            parentId: child.parentId,
            order: child.order,
          });
        }
        doc.nodes = doc.nodes
          .filter((n) => n.id !== op.id)
          .map((n) => (n.parentId === op.id ? { ...n, parentId: node.parentId } : n));
        doc.edges = doc.edges.filter((e) => e.source !== op.id && e.target !== op.id);
        inverseOps.unshift({ op: 'restore', node, edges: incident });
        break;
      }
      case 'move': {
        const node = findNode(doc, op.id);
        inverseOps.unshift({ op: 'move', id: op.id, parentId: node.parentId, order: node.order });
        doc.nodes = doc.nodes.map((n) =>
          n.id === op.id ? { ...n, parentId: op.parentId, order: op.order } : n,
        );
        break;
      }
      case 'addEdge': {
        if (doc.edges.some((e) => e.id === op.edge.id))
          throw new Error(`Duplicate edge id: ${op.edge.id}`);
        findNode(doc, op.edge.source);
        findNode(doc, op.edge.target);
        doc.edges.push(op.edge);
        inverseOps.unshift({ op: 'removeEdge', id: op.edge.id });
        break;
      }
      case 'updateEdge': {
        const edge = findEdge(doc, op.id);
        const prev = pickPrev(edge as Record<string, unknown>, op.data);
        const next = { ...(edge as Record<string, unknown>), ...op.data };
        for (const [k, v] of Object.entries(op.data)) if (v === undefined) delete next[k];
        doc.edges = doc.edges.map((e) => (e.id === op.id ? (next as SkillEdge) : e));
        inverseOps.unshift({ op: 'updateEdge', id: op.id, data: prev });
        break;
      }
      case 'removeEdge': {
        const edge = findEdge(doc, op.id);
        doc.edges = doc.edges.filter((e) => e.id !== op.id);
        inverseOps.unshift({ op: 'addEdge', edge });
        break;
      }
      case 'setProfile': {
        inverseOps.unshift({ op: 'setProfile', profile: doc.profile });
        doc = { ...doc, profile: op.profile };
        break;
      }
    }
  }

  return { doc: SkillDocSchema.parse(doc), inverse: { ops: inverseOps } };
}

/** Stable sort of nodes by (parentId, order, id); used before saving so diffs are deterministic. */
export function sortDoc(doc: SkillDoc): SkillDoc {
  const nodes = [...doc.nodes].sort((a, b) => {
    const pa = a.parentId ?? '';
    const pb = b.parentId ?? '';
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const edges = [...doc.edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { profile: doc.profile, nodes, edges };
}
