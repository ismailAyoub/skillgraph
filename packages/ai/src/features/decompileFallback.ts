import type { SkillDoc } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { AiError } from '../errors';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { ProposalOutputSchema } from '../schemas';
import type { Proposal } from '../types';
import { toProposalPatch } from '../validate';

const ROLE = `You are the AI fallback of the SkillGraph decompiler. The deterministic importer kept some markdown verbatim in raw_markdown nodes because no recognizer matched. Your job is to replace those raw chunks with structured nodes that compile back to equivalent prose, so the graph becomes editable.

For each raw_markdown node listed:
- read its body and decide the best structured representation: steps (numbered/bulleted instructions -> step nodes with title = bold lead when present, instruction = the rest, why when a sentence explains the reason), a phase (heading + steps), decision + branch edges (if/when/otherwise prose), guardrail (bold don't/do sentences), checklist (task lists), example (input/output pairs), output_format (templates), catalog (rules tables), ask_user, delegate, skill_call, or a reference when the chunk is long background material better moved to references/<topic>.md (then add a reads edge from a nearby step).
- emit ops that keep the position: new nodes take the raw node's parentId and its order (the first new node reuses the raw node's order; following ones use the next integers, and if that collides with later siblings, emit move ops to shift those siblings). Then remove the raw node.
- preserve wording and meaning; you may fix nothing but the structure. Do not summarize or drop content. If a chunk truly cannot be modelled (odd HTML, front-matter fragments), leave it and say so in the rationale.
New ids look like <kind>_<slug>. Reference only ids from the listing.`;

export async function decompileFallback(
  ctx: CallContext,
  input: { doc: SkillDoc; rawNodeIds?: string[] },
): Promise<Proposal> {
  const rawNodes = input.doc.nodes.filter(
    (n) => n.kind === 'raw_markdown' && (!input.rawNodeIds || input.rawNodeIds.includes(n.id)),
  );
  if (input.rawNodeIds) {
    for (const id of input.rawNodeIds) {
      if (!rawNodes.some((n) => n.id === id)) {
        throw new AiError('invalid_patch', `raw_markdown node not found: ${id}`);
      }
    }
  }
  if (rawNodes.length === 0) {
    return { patch: { ops: [] }, rationale: 'No raw_markdown nodes to convert.' };
  }
  const chunks = rawNodes
    .map((n) =>
      wrapUntrusted('raw_markdown', String((n as { body?: string }).body ?? ''), {
        id: n.id,
        parent: n.parentId ?? 'root',
        order: String(n.order),
      }),
    )
    .join('\n\n');
  const user = [
    `Convert these ${rawNodes.length} raw_markdown node(s) into structured nodes: ${rawNodes.map((n) => n.id).join(', ')}.`,
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
    chunks,
  ].join('\n\n');
  const out = await callStructured(ctx, ProposalOutputSchema, systemPrompt(ROLE), user);
  return { patch: toProposalPatch(input.doc, out.patch), rationale: out.rationale.trim() };
}
