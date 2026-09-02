import type { SkillDoc } from '@skillgraph/core';
import { type CallContext, callStructured } from '../client';
import { describeGraphForPrompt, systemPrompt, wrapUntrusted } from '../prompt';
import { AlignTraceOutputSchema } from '../schemas';
import type { TraceEvent, TraceVisit } from '../types';

const ROLE = `You align an agent's execution trace with the steps of the skill it was following. The deterministic part (Read of a reference path -> reference node, Bash running scripts/x -> script node, AskUserQuestion -> ask_user, Skill tool -> skill_call, Agent/Task tool -> delegate) is already done by the caller. You handle what is left: mapping text and tool events to step, decision, loop, phase, guardrail and checklist nodes by meaning.

For each event that clearly corresponds to a node, emit a visit: nodeId (from the listing only), the event's turn, a short evidence string (quote or paraphrase of the event) and confidence 0..1 (1.0 = the text names the step; 0.5 = plausible; do not emit below 0.3). A turn may visit several nodes and a node may be visited several times (loops). Do not emit visits for the entry node or for nodes the trace never touches. Do not invent visits to make coverage look good.`;

function fmtEvent(e: TraceEvent): string {
  if (e.type === 'tool_use') {
    const input = e.input === undefined ? '' : ` input=${clip(JSON.stringify(e.input), 400)}`;
    return `turn ${e.turn} tool_use ${e.tool ?? '?'}${input}`;
  }
  return `turn ${e.turn} text: ${clip(e.text ?? '', 600)}`;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export async function alignTrace(
  ctx: CallContext,
  input: { doc: SkillDoc; events: TraceEvent[] },
): Promise<{ visits: TraceVisit[] }> {
  if (input.events.length === 0) return { visits: [] };
  const ids = new Set(input.doc.nodes.filter((n) => n.kind !== 'entry').map((n) => n.id));
  const turns = new Set(input.events.map((e) => e.turn));
  const user = [
    'Align these trace events with the skill graph nodes.',
    wrapUntrusted('skill_graph', describeGraphForPrompt(input.doc)),
    wrapUntrusted('trace', input.events.map(fmtEvent).join('\n')),
  ].join('\n\n');
  const out = await callStructured(ctx, AlignTraceOutputSchema, systemPrompt(ROLE), user);
  const visits = out.visits
    .filter((v) => ids.has(v.nodeId) && turns.has(v.turn) && v.confidence >= 0.3)
    .map((v) => ({
      nodeId: v.nodeId,
      turn: v.turn,
      evidence: v.evidence.trim(),
      confidence: Math.min(1, Math.max(0, v.confidence)),
    }));
  return { visits };
}
