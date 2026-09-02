import {
  applyPatch,
  GraphPatch,
  type GraphPatchT,
  NODE_KINDS,
  newId,
  type SkillDoc,
} from '@skillgraph/core';
import { AiError } from './errors';
import type { AiPatch } from './schemas';

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJsonObject(text: string | null, what: string): Rec {
  if (text === null || text.trim() === '') {
    throw new AiError('invalid_patch', `Missing ${what} in AI patch op`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new AiError('invalid_patch', `${what} is not valid JSON: ${(err as Error).message}`, {
      details: text,
      cause: err,
    });
  }
  if (!isRecord(value))
    throw new AiError('invalid_patch', `${what} must be a JSON object`, { details: text });
  return value;
}

function maxSiblingOrder(doc: SkillDoc, parentId: string | null, pending: Rec[]): number {
  let max = -1;
  for (const n of doc.nodes) if ((n.parentId ?? null) === parentId) max = Math.max(max, n.order);
  for (const n of pending) {
    if ((n.parentId ?? null) === parentId && typeof n.order === 'number')
      max = Math.max(max, n.order);
  }
  return max;
}

/**
 * Convert the model's loose patch (JSON strings for node/data/edge) into GraphPatch input.
 * Ensures added nodes have unique ids (renaming collisions and rewriting later references),
 * `provenance: 'ai'`, a sane parentId and an order defaulting to max sibling order + 1.
 */
export function normalizeAiPatch(doc: SkillDoc, patch: AiPatch): unknown {
  const existingNodeIds = new Set(doc.nodes.map((n) => n.id));
  const existingEdgeIds = new Set(doc.edges.map((e) => e.id));
  const renamed = new Map<string, string>();
  const added: Rec[] = [];
  const ops: unknown[] = [];

  const ref = (id: unknown): unknown =>
    typeof id === 'string' && renamed.has(id) ? renamed.get(id) : id;

  for (const op of patch.ops) {
    switch (op.op) {
      case 'add': {
        const node = parseJsonObject(op.node, 'node');
        const kind = typeof node.kind === 'string' ? node.kind : 'node';
        if (!(NODE_KINDS as readonly string[]).includes(kind)) {
          throw new AiError('invalid_patch', `Unknown node kind in add op: ${kind}`, {
            details: node,
          });
        }
        let id = typeof node.id === 'string' && node.id.trim() !== '' ? node.id : newId(kind);
        if (existingNodeIds.has(id)) {
          const fresh = newId(kind);
          renamed.set(id, fresh);
          id = fresh;
        }
        existingNodeIds.add(id);
        const parentId =
          node.parentId === undefined || node.parentId === null || node.parentId === ''
            ? null
            : ref(node.parentId);
        if (typeof parentId === 'string' && !existingNodeIds.has(parentId)) {
          throw new AiError('invalid_patch', `add ${id}: parentId ${parentId} does not exist`, {
            details: node,
          });
        }
        const order =
          typeof node.order === 'number' && Number.isFinite(node.order)
            ? Math.round(node.order)
            : maxSiblingOrder(doc, parentId as string | null, added) + 1;
        const next: Rec = { ...node, id, parentId, order, provenance: 'ai' };
        for (const [k, v] of Object.entries(next))
          if (v === null && k !== 'parentId') delete next[k];
        added.push(next);
        ops.push({ op: 'add', node: next });
        break;
      }
      case 'update': {
        if (!op.id) throw new AiError('invalid_patch', 'update op without id');
        const data = parseJsonObject(op.data, 'data');
        delete data.id;
        delete data.kind;
        if ('parentId' in data) data.parentId = ref(data.parentId);
        ops.push({ op: 'update', id: ref(op.id), data });
        break;
      }
      case 'remove': {
        if (!op.id) throw new AiError('invalid_patch', 'remove op without id');
        ops.push({ op: 'remove', id: ref(op.id) });
        break;
      }
      case 'move': {
        if (!op.id) throw new AiError('invalid_patch', 'move op without id');
        ops.push({
          op: 'move',
          id: ref(op.id),
          parentId: op.parentId === null ? null : ref(op.parentId),
          order: typeof op.order === 'number' ? Math.round(op.order) : 0,
        });
        break;
      }
      case 'addEdge': {
        const edge = parseJsonObject(op.edge, 'edge');
        const kind = typeof edge.kind === 'string' ? edge.kind : 'next';
        let id = typeof edge.id === 'string' && edge.id.trim() !== '' ? edge.id : newId('edge');
        if (existingEdgeIds.has(id)) id = newId('edge');
        existingEdgeIds.add(id);
        const next: Rec = { ...edge, id, kind, source: ref(edge.source), target: ref(edge.target) };
        for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
        ops.push({ op: 'addEdge', edge: next });
        break;
      }
      case 'updateEdge': {
        if (!op.id) throw new AiError('invalid_patch', 'updateEdge op without id');
        const data = parseJsonObject(op.data, 'data');
        delete data.id;
        if ('source' in data) data.source = ref(data.source);
        if ('target' in data) data.target = ref(data.target);
        ops.push({ op: 'updateEdge', id: op.id, data });
        break;
      }
      case 'removeEdge': {
        if (!op.id) throw new AiError('invalid_patch', 'removeEdge op without id');
        ops.push({ op: 'removeEdge', id: op.id });
        break;
      }
    }
  }
  return { ops };
}

/**
 * Parse with the GraphPatch schema, force `provenance: 'ai'` on added nodes, dry-run
 * `applyPatch(doc)` and return the normalized patch. Throws AiError('invalid_patch') with details.
 */
export function validateProposal(doc: SkillDoc, patch: unknown): GraphPatchT {
  const parsed = GraphPatch.safeParse(patch);
  if (!parsed.success) {
    throw new AiError(
      'invalid_patch',
      `AI patch does not match the GraphPatch schema: ${parsed.error.message}`,
      {
        details: { issues: parsed.error.issues, patch },
      },
    );
  }
  const normalized: GraphPatchT = {
    ops: parsed.data.ops.map((op) =>
      op.op === 'add' || op.op === 'restore'
        ? { ...op, node: { ...op.node, provenance: 'ai' as const } }
        : op,
    ),
  };
  try {
    applyPatch(doc, normalized);
  } catch (err) {
    throw new AiError('invalid_patch', `AI patch does not apply: ${(err as Error).message}`, {
      details: { patch: normalized },
      cause: err,
    });
  }
  return normalized;
}

/** normalizeAiPatch + validateProposal in one step. */
export function toProposalPatch(doc: SkillDoc, patch: AiPatch): GraphPatchT {
  return validateProposal(doc, normalizeAiPatch(doc, patch));
}
