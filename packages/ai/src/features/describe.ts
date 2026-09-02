import type { SkillDoc } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { DescribeOutputSchema, TriggerQueriesOutputSchema } from '../schemas';
import type { DescribeResult, TriggerQuery } from '../types';

export const DESCRIPTION_RULES = `How a skill description works: it appears in Claude's available_skills list next to the name; Claude decides from the description alone whether to consult the skill, and only for tasks it cannot trivially do itself. Claude under-triggers, so descriptions should be a little pushy.

A strong description:
- Starts with what the skill does in the imperative/third person ("Guides ...", "Use this skill to ...", "Create, edit and audit ..."), never "I", "you" or "this skill will".
- Then says when to use it: concrete user situations and phrasings, including cases where the user does not name the artifact ("whenever the user mentions dashboards, metrics or wants to display company data, even if they never say 'dashboard'").
- Names the near-misses it does NOT cover when confusion with another skill is likely ("Do not use for PDFs or spreadsheets").
- Is 100-200 words, under 1024 characters, no angle brackets, no time-sensitive facts, one paragraph.
- Focuses on user intent and outcomes, not implementation details.`;

export const TRIGGER_QUERY_RULES = `Trigger queries are realistic user messages used to test whether a description triggers correctly. Write them the way real users type: specific, a bit messy, with context ("ok so my boss sent me this xlsx in my downloads, 'Q4 sales final FINAL v2.xlsx', she wants a profit margin column, revenue is column C and costs D i think"). Never one-liners like "format this data".
- should_trigger=true (about half): different phrasings of the same intents, formal and casual, cases that never name the skill or the file type but clearly need it, uncommon uses, and cases where this skill competes with another but should win. Make them substantive enough that Claude would benefit from consulting a skill.
- should_trigger=false (the other half): NEAR-MISSES only. Share keywords or the domain but need something else: adjacent domains, ambiguous phrasing where a naive keyword match would trigger, contexts where another tool is more appropriate. Never obviously irrelevant queries ("write a fibonacci function" is useless as a negative for a PDF skill).`;

const ROLE = `You write skill descriptions and trigger-evaluation queries for Agent Skills.

${DESCRIPTION_RULES}

${TRIGGER_QUERY_RULES}

Produce exactly three candidate descriptions with structurally different approaches (for example: outcome-led, situation-led, contrast-led), each with a one-sentence rationale naming the trade-off, plus 16-20 trigger queries (half should trigger, half near-miss negatives) that a good description must satisfy.`;

export async function describe(
  ctx: CallContext,
  input: { doc: SkillDoc },
): Promise<DescribeResult> {
  const user = [
    'Write description candidates and trigger queries for this skill.',
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
  ].join('\n\n');
  const out = await callStructured(ctx, DescribeOutputSchema, systemPrompt(ROLE), user);
  return {
    candidates: out.candidates.map((c) => ({
      description: c.description.trim(),
      rationale: c.rationale.trim(),
    })),
    triggerQueries: out.triggerQueries.map(cleanQuery),
  };
}

const QUERIES_ROLE = `You write trigger-evaluation queries for Agent Skills.

${TRIGGER_QUERY_RULES}`;

export async function triggerQueries(
  ctx: CallContext,
  input: { doc: SkillDoc; count?: number },
): Promise<TriggerQuery[]> {
  const count = Math.max(2, Math.round(input.count ?? 20));
  const positives = Math.ceil(count / 2);
  const user = [
    `Write exactly ${count} trigger queries for this skill: ${positives} with should_trigger=true and ${count - positives} near-miss queries with should_trigger=false.`,
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
  ].join('\n\n');
  const out = await callStructured(
    ctx,
    TriggerQueriesOutputSchema,
    systemPrompt(QUERIES_ROLE),
    user,
  );
  return out.queries.map(cleanQuery).slice(0, count);
}

function cleanQuery(q: TriggerQuery): TriggerQuery {
  return { query: q.query.trim(), should_trigger: Boolean(q.should_trigger) };
}
