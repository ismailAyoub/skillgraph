import {
  type CompileResult,
  compile,
  type Diagnostic,
  lint,
  type SkillDoc,
} from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { CritiqueOutputSchema } from '../schemas';
import type { CritiqueFinding, CritiqueResult } from '../types';
import { toProposalPatch } from '../validate';

const ROLE = `You are a senior reviewer of Agent Skills (SKILL.md folders used by Claude Code and other agents). You review a skill expressed as a SkillGraph and its compiled SKILL.md and return findings, each ideally with a concrete GraphPatch fix.

Review for, in this priority order:
1. Trigger quality: does the description say what + when, in the third person, with pushy concrete triggers? Is it under 1024 characters? Are the entry \`triggers\` phrases present in it?
2. Procedure quality: are steps imperative, one concern each, with a why where the reason is not obvious? Are there dead branches, decisions without an Otherwise, loops without an exit condition, steps that should be split or merged, vague instructions ("handle errors appropriately")?
3. Progressive disclosure: would SKILL.md exceed ~500 lines or ~5000 tokens? Which long material belongs in references/ with a read-when condition? Are references orphaned (never read) or missing a readWhen? Do long reference files have a table of contents?
4. Robustness: missing output format when the result has a shape, missing verification checklist, missing guardrails for the obvious failure modes, missing examples where the format is subtle, time-sensitive statements, MUST/NEVER overuse, overfitting to a single example, terminology drift.
5. Consistency with the existing lint diagnostics: do not repeat a lint that is already reported unless you add a fix; prefer fixing root causes.

Rules for output:
- \`rule\` is 'ai/<kebab-slug>' (e.g. ai/description-not-pushy, ai/step-missing-why, ai/split-into-reference, ai/dead-branch).
- Severity: error = the skill will misbehave or violate the spec; warning = a real quality problem; info = polish.
- Provide a patch whenever the fix is mechanical (text rewrites, adding a why, adding a readWhen, adding a checklist or guardrail node, moving material into a reference). Reference only ids from the listing. Keep each patch minimal and self-contained; patches from different findings may be applied independently, so never depend on another finding's patch.
- 3 to 12 findings. Do not pad; a good skill deserves few findings and a positive summary.`;

export async function critique(
  ctx: CallContext,
  input: { doc: SkillDoc; compiled?: CompileResult; lints?: Diagnostic[] },
): Promise<CritiqueResult> {
  const compiled = input.compiled ?? compile(input.doc);
  const lints = input.lints ?? lint(input.doc, { compiled }).diagnostics;
  const lintText =
    lints.length === 0
      ? '(none)'
      : lints
          .map((d) => `${d.severity} ${d.rule}${d.nodeId ? ` [${d.nodeId}]` : ''}: ${d.message}`)
          .join('\n');
  const user = [
    'Review this skill.',
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
    wrapUntrusted('compiled_skill_md', compiled.skillMd, {
      lines: String(compiled.report.lines),
      tokens: String(compiled.report.tokens),
    }),
    wrapUntrusted('lint_diagnostics', lintText),
  ].join('\n\n');

  const out = await callStructured(ctx, CritiqueOutputSchema, systemPrompt(ROLE), user);
  const findings: CritiqueFinding[] = out.findings.map((f) => {
    const finding: CritiqueFinding = {
      severity: f.severity,
      rule: normalizeRule(f.rule),
      message: f.message,
    };
    if (f.nodeId) finding.nodeId = f.nodeId;
    if (f.patch && f.patch.ops.length > 0) {
      try {
        finding.patch = toProposalPatch(input.doc, f.patch);
      } catch (err) {
        finding.message = `${finding.message} (proposed fix dropped: ${(err as Error).message})`;
      }
    }
    return finding;
  });
  return { findings, summary: out.summary };
}

function normalizeRule(rule: string): string {
  const slug = rule
    .trim()
    .replace(/^ai\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `ai/${slug || 'finding'}`;
}
