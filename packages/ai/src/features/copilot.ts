import type { SkillDoc } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { AiError } from '../errors';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { ProposalOutputSchema } from '../schemas';
import type { CopilotIntent, Proposal } from '../types';
import { toProposalPatch, UNPACK_EDIT } from '../validate';

const INTENTS: Record<Exclude<CopilotIntent, 'custom'>, string> = {
  'rewrite-imperative':
    'Rewrite the node text in the imperative, second-person-free form ("Restate the idea as ..." not "You should restate" or "The agent will"). Keep the meaning, tighten wording, keep a bold title of 2-5 words when the node has a title. Emit a single update op.',
  'add-why':
    'Add or improve the `why` of this node: one sentence that explains the reason the step matters or what goes wrong without it, in terms a capable reader finds informative rather than obvious. Do not restate the instruction. Emit a single update op (and improve the instruction only if it is needed for the why to make sense).',
  'split-steps':
    'This node bundles several concerns. Split it into 2-5 sibling steps in the same container, each with one concern, an imperative instruction and a why where useful. Update the original node to hold the first concern (keep its id) and add the others after it with consecutive orders; emit move ops for later siblings only if their orders collide. Add next edges only if the original node already had flow edges.',
  'draft-reference':
    'Move the detailed material of this node into a new reference node (kind reference, path references/<topic>.md, source inline, a markdown body with a short heading structure and, when over 300 lines, a table of contents). Keep the host node short and add a `reads` edge from the host to the new reference with `readWhen`-style guidance in the reference (field readWhen) so the compiler emits "Read references/<topic>.md when ...".',
  'draft-script':
    'Draft a script node (kind script, path scripts/<name>.<ext>, language, complete runnable code with argument parsing and clear stdout output, `runWhen`, `usage` showing the exact command, `outputs` describing what it prints) that automates the deterministic part of this node, and add a `runs` edge from the node to the script. Keep the host instruction focused on what to do with the output. Do not include network calls to unknown hosts or anything destructive.',
  tighten:
    'Tighten this node: remove filler, hedging and repetition, prefer concrete verbs and nouns, keep every constraint that changes behaviour, and keep any why. Aim for at least 30% fewer words without losing meaning. Emit a single update op.',
};

const ROLE = `You are a node copilot for SkillGraph. You receive one target node inside a skill graph and an intent, and you return a minimal GraphPatch that carries out the intent for that node only, plus a short rationale. Do not touch unrelated nodes. Reference only ids present in the listing. New nodes need unique ids of the form <kind>_<slug>.`;

export async function copilot(
  ctx: CallContext,
  input: { doc: SkillDoc; nodeId: string; intent: CopilotIntent; instruction?: string },
): Promise<Proposal> {
  const node = input.doc.nodes.find((n) => n.id === input.nodeId);
  if (!node) throw new AiError('invalid_patch', `Node not found: ${input.nodeId}`);
  const intentText =
    input.intent === 'custom'
      ? (input.instruction?.trim() ??
        (() => {
          throw new AiError('invalid_patch', "copilot intent 'custom' requires an instruction");
        })())
      : [INTENTS[input.intent], input.instruction?.trim()]
          .filter(Boolean)
          .join('\n\nAdditional guidance from the user: ');
  const user = [
    `Target node: ${input.nodeId} (kind ${node.kind}).`,
    `Intent (${input.intent}): ${intentText}`,
    wrapUntrusted('target_node', JSON.stringify(node, null, 2)),
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
  ].join('\n\n');
  const out = await callStructured(ctx, ProposalOutputSchema, systemPrompt(ROLE), user);
  return {
    patch: toProposalPatch(input.doc, out.patch, { unpack: UNPACK_EDIT }),
    rationale: out.rationale.trim(),
  };
}
