import { type SkillDoc, unpackableNodes } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { InterviewOutputSchema } from '../schemas';
import type { InterviewStep, InterviewTurn } from '../types';
import { toProposalPatch, UNPACK_DRAFT } from '../validate';

const ROLE = `You interview a person to turn what they know into an Agent Skill graph, one question at a time (the skill-creator "capture intent" flow). Many users are not programmers: plain language, no jargon like JSON or assertion unless they used it first.

Question order (skip what the transcript or graph already answers):
1. What should the skill enable Claude to do? (the outcome and the rough procedure; ask for the steps they follow themselves, edge cases, inputs)
2. When should it trigger? (the user phrasings and situations; also what it should NOT be used for)
3. What is the expected output format? (shape, destination, level of detail; ask for an example when the shape is subtle)
4. Should we set up test cases? Skills with objectively verifiable outputs (file transforms, extraction, code generation, fixed workflows) benefit from tests; subjective ones (writing style, design) often do not. Suggest the fitting default and let them decide.
Then probe only what is still unclear: dependencies, tools, failure modes worth a guardrail.

Each step:
- Ask exactly ONE question (question is null only when done). Make it concrete and easy to answer; offer 2-3 example answers when it helps.
- As soon as the transcript justifies graph changes, return a patch in the same step: set the entry description (what + when, third person, pushy), the entry triggers/negativeTriggers, phases and imperative steps with a why, an output_format node, guardrails, a verification checklist. Build incrementally: update existing nodes rather than re-adding them; reference only ids in the listing; new ids look like <kind>_<slug>.
- The person is here to SEE the workflow on a canvas. Model the procedure as nodes: one step node per step (decision, ask_user, delegate, loop where they fit), grouped into phases. Never put the steps into a raw_markdown node, into a reference body or into one step's instruction as a numbered list; a reference is only for lookup material (tables, API details, templates) that a step reads on demand. If graph_readiness reports procedures hidden in markdown, unpack them into nodes in your next patch.
- confidence is 0..1 for how well the current graph (after your patch) captures the intent.
- done=true (with question=null) only when the graph has an entry with a real description, at least one phase with imperative steps, the trigger situations are captured, the output format question has been answered (or is not applicable) and you have no open question that would change the skill. If the user says they are done, wrap up: emit any final patch and set done=true.`;

/** Same gating as the `graph/procedure-in-markdown` lint: imported references are legitimate files. */
function hiddenProcedures(doc: SkillDoc): number {
  return unpackableNodes(doc).filter(
    ({ node }) =>
      node.kind === 'raw_markdown' ||
      (node.kind === 'step' && node.provenance !== 'import') ||
      (node.kind === 'reference' && node.provenance === 'ai'),
  ).length;
}

function graphReadiness(doc: SkillDoc): string {
  const entry = doc.nodes.find((n) => n.kind === 'entry') as
    | { description?: string; triggers?: string[] }
    | undefined;
  const phases = doc.nodes.filter((n) => n.kind === 'phase');
  const steps = doc.nodes.filter((n) => n.kind === 'step');
  const hasDescription = Boolean(entry?.description && entry.description.length > 40);
  const hasOutput = doc.nodes.some((n) => n.kind === 'output_format');
  return [
    `entry description present: ${hasDescription}`,
    `triggers captured: ${(entry?.triggers?.length ?? 0) > 0}`,
    `phases: ${phases.length}, steps: ${steps.length}`,
    `output_format node: ${hasOutput}`,
    `procedures hidden in markdown (unpack into nodes): ${hiddenProcedures(doc)}`,
  ].join('\n');
}

export async function interview(
  ctx: CallContext,
  input: { doc: SkillDoc; transcript: InterviewTurn[] },
): Promise<InterviewStep> {
  const transcriptText =
    input.transcript.length === 0
      ? '(empty: this is the first step; greet briefly inside the question and ask what the skill should do)'
      : input.transcript
          .map((t) => `${t.role === 'assistant' ? 'interviewer' : 'user'}: ${t.content}`)
          .join('\n\n');
  const user = [
    'Continue the interview: return the next single question and, when justified, a patch.',
    wrapUntrusted('graph_readiness', graphReadiness(input.doc)),
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
    wrapUntrusted('interview_transcript', transcriptText),
  ].join('\n\n');
  const out = await callStructured(ctx, InterviewOutputSchema, systemPrompt(ROLE), user);
  const step: InterviewStep = {
    confidence: Math.min(1, Math.max(0, out.confidence)),
    done: out.done,
  };
  if (out.question && out.question.trim() !== '') step.question = out.question.trim();
  if (out.rationale && out.rationale.trim() !== '') step.rationale = out.rationale.trim();
  if (out.patch && out.patch.ops.length > 0)
    step.patch = toProposalPatch(input.doc, out.patch, { unpack: UNPACK_DRAFT });
  if (!step.done && !step.question) {
    step.question = 'Is there anything else the skill should do, or should we wrap up here?';
  }
  return step;
}
