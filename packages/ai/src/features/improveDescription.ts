import { compile, type SkillDoc } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { systemPrompt, wrapUntrusted } from '../prompt';
import { ImproveDescriptionOutputSchema } from '../schemas';
import type { TriggerEvalResult } from '../types';
import { DESCRIPTION_RULES } from './describe';

const ROLE = `You optimize the description of an Agent Skill for triggering accuracy (the skill-creator description optimizer). The description appears in Claude's available_skills list; Claude decides whether to invoke the skill from the name and description alone. Your goal is a description that triggers for relevant queries and stays quiet for irrelevant ones.

${DESCRIPTION_RULES}

How to use the eval results: generalize from the failures to broader categories of user intent and situations where the skill is or is not useful. Do NOT produce an ever-expanding list of the specific failing queries: that overfits, and every description is injected into every conversation, so length is expensive. Prefer restructuring (different sentence order, a contrast clause, a broader or narrower category) over appending. If previous attempts exist, try something structurally different from all of them. Stay under 1024 characters, ideally 100-200 words.

Return the new description text only in \`description\` (no quotes, no tags) and a short \`reasoning\` explaining which failure categories the change addresses.`;

function fmt(r: TriggerEvalResult): string {
  const runs = r.runs?.length
    ? ` (triggered ${r.runs.filter(Boolean).length}/${r.runs.length} runs)`
    : '';
  return `- "${r.query}"${runs}`;
}

export async function improveDescription(
  ctx: CallContext,
  input: {
    doc: SkillDoc;
    results: TriggerEvalResult[];
    history?: { description: string; passRate: number }[];
  },
): Promise<{ description: string; reasoning: string }> {
  const entry = input.doc.nodes.find((n) => n.kind === 'entry') as
    | { name?: string; description?: string }
    | undefined;
  const failedToTrigger = input.results.filter((r) => r.should_trigger && !r.pass);
  const falseTriggers = input.results.filter((r) => !r.should_trigger && !r.pass);
  const passed = input.results.filter((r) => r.pass).length;
  const sections = [
    `Score: ${passed}/${input.results.length} queries pass.`,
    failedToTrigger.length > 0
      ? `FAILED TO TRIGGER (should have triggered but did not):\n${failedToTrigger.map(fmt).join('\n')}`
      : 'FAILED TO TRIGGER: none',
    falseTriggers.length > 0
      ? `FALSE TRIGGERS (triggered but should not have):\n${falseTriggers.map(fmt).join('\n')}`
      : 'FALSE TRIGGERS: none',
    `PASSED:\n${input.results
      .filter((r) => r.pass)
      .map((r) => `- [${r.should_trigger ? 'trigger' : 'no-trigger'}] "${r.query}"`)
      .join('\n')}`,
  ].join('\n\n');
  const history =
    input.history && input.history.length > 0
      ? input.history
          .map(
            (h, i) =>
              `<attempt n="${i + 1}" pass_rate="${h.passRate.toFixed(2)}">\n${h.description}\n</attempt>`,
          )
          .join('\n')
      : '(none)';
  const skillMd = compile(input.doc).skillMd;
  const user = [
    `Improve the description of the skill "${entry?.name ?? 'skill'}".`,
    wrapUntrusted('current_description', entry?.description ?? ''),
    wrapUntrusted('eval_results', sections),
    wrapUntrusted('previous_attempts', history),
    wrapUntrusted('compiled_skill_md', skillMd),
  ].join('\n\n');
  const out = await callStructured(ctx, ImproveDescriptionOutputSchema, systemPrompt(ROLE), user);
  let description = out.description.trim().replace(/^["']|["']$/g, '');
  if (description.length > 1024) description = `${description.slice(0, 1021).trimEnd()}...`;
  return { description, reasoning: out.reasoning.trim() };
}
