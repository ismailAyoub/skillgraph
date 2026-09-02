import type { SkillDoc } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { ProposalOutputSchema } from '../schemas';
import type { Proposal } from '../types';
import { toProposalPatch } from '../validate';

const ROLE = `You turn a work transcript (a conversation between a user and an agent, a chat log, a shell session or notes) into an Agent Skill graph: the reusable procedure that would let an agent do this kind of task well next time.

Extract from the transcript: the goal, the tools and commands actually used, the sequence of steps that worked, the corrections the user made (these become guardrails or a why), the inputs and the output shape observed, the decisions taken and their conditions, and anything that had to be looked up (candidate references).

Then build the graph with a patch:
- update the entry: name (kebab-case, if still a placeholder), description (what + when, third person, pushy, mentions the situations seen in the transcript generalized to the category), triggers, negativeTriggers;
- phases with imperative steps (one concern each, why where the transcript shows a reason), decisions for real branch points with an Otherwise, ask_user where the agent needed the user's input;
- an output_format node when the result had a shape; guardrails from the corrections; a verification checklist from what was checked;
- reference or script nodes only for material that is clearly reusable and complete (never invent code that was not in the transcript; summarize instead).
Generalize: no user-specific file names, dates or one-off values; describe the class of input. Do not copy secrets, tokens or personal data. Reuse existing node ids from the listing when updating; new ids look like <kind>_<slug>.`;

export async function fromTranscript(
  ctx: CallContext,
  input: { doc: SkillDoc; transcript: string },
): Promise<Proposal> {
  const user = [
    'Extract a skill from this transcript and return a patch on the current graph.',
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
    wrapUntrusted('transcript', input.transcript),
  ].join('\n\n');
  const out = await callStructured(ctx, ProposalOutputSchema, systemPrompt(ROLE), user);
  return { patch: toProposalPatch(input.doc, out.patch), rationale: out.rationale.trim() };
}
