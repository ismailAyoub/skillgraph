import {
  applyPatch,
  GraphPatch,
  type GraphPatchT,
  NODE_KINDS,
  newId,
  type SkillDoc,
  type UnpackableKind,
  unpackNodes,
  unpackShape,
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

export interface ProposalOptions {
  /**
   * Node kinds whose markdown procedure gets unpacked into nodes after the AI patch (core
   * `unpackNode`): a raw_markdown body, a reference that is really the workflow, a step that
   * embeds sub-steps. The canvas is the point of the tool, so a model that answers with one
   * blob of markdown still yields step nodes.
   */
  unpack?: readonly UnpackableKind[];
}

/** For features that draft the skill: the canvas should show every step, so references that hold the procedure are dissolved too. */
export const UNPACK_DRAFT: readonly UnpackableKind[] = ['raw_markdown', 'reference', 'step'];
/** For features that edit one node: raw markdown and embedded sub-steps only; a reference the user asked for stays a reference. */
export const UNPACK_EDIT: readonly UnpackableKind[] = ['raw_markdown', 'step'];

/**
 * Append, to a validated patch, the ops that unpack every node the patch adds or updates whose
 * markdown hides a procedure (kinds in `kinds`). The result is one patch, still all-or-nothing.
 */
export function unpackProposal(
  doc: SkillDoc,
  patch: GraphPatchT,
  kinds: readonly UnpackableKind[],
): GraphPatchT {
  if (kinds.length === 0 || patch.ops.length === 0) return patch;
  const applied = applyPatch(doc, patch).doc;
  const touched: string[] = [];
  for (const op of patch.ops) {
    const id = op.op === 'add' ? op.node.id : op.op === 'update' ? op.id : null;
    if (id && !touched.includes(id)) touched.push(id);
  }
  const ids = touched.filter((id) => {
    const node = applied.nodes.find((n) => n.id === id);
    return (
      node !== undefined &&
      (kinds as readonly string[]).includes(node.kind) &&
      unpackShape(node) !== null
    );
  });
  if (ids.length === 0) return patch;
  return { ops: [...patch.ops, ...unpackNodes(applied, ids).ops] };
}

/**
 * normalizeAiPatch + validateProposal (+ unpackProposal when asked) in one step.
 *
 * Unpacking is an improvement, not a requirement, so a failure there falls back to the plain
 * validated patch: a blob on the canvas beats rejecting the model's whole turn. The
 * `graph/procedure-in-markdown` lint still flags it and the editor still offers to unpack it.
 */
export function toProposalPatch(
  doc: SkillDoc,
  patch: AiPatch,
  opts: ProposalOptions = {},
): GraphPatchT {
  const validated = validateProposal(doc, normalizeAiPatch(doc, patch));
  if (!opts.unpack || opts.unpack.length === 0) return validated;
  try {
    return validateProposal(doc, unpackProposal(doc, validated, opts.unpack));
  } catch {
    return validated;
  }
}
