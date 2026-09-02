import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { TraceEvent, TraceVisit } from '@skillgraph/ai';
import type { SkillDoc, SkillNode } from '@skillgraph/core';
import { readJson, writeJson } from '../fs';
import type { AiPort } from './ai-port';

export const TRACES_DIR = 'evals/traces';

export interface TraceFile {
  evalId: number | string;
  run: number;
  configuration?: string;
  createdAt: string;
  visits: TraceVisit[];
  events: TraceEvent[];
}

export interface HeatmapEntry {
  visits: number;
  runs: number;
  ratio: number;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const norm = (p: string) => p.split('\\').join('/').replace(/^\.\//, '');

function pathMatches(candidate: string, nodePath: string): boolean {
  const c = norm(candidate);
  const n = norm(nodePath);
  return c === n || c.endsWith(`/${n}`);
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

function overlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

function byOrder(a: SkillNode, b: SkillNode): number {
  return a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1;
}

/** Best node of `kind` by token overlap between `text` and the node's own text; first by order when nothing overlaps. */
function bestByText(
  nodes: SkillNode[],
  text: string,
  nodeText: (n: SkillNode) => string,
): { node: SkillNode; confidence: number } | undefined {
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return { node: nodes[0] as SkillNode, confidence: 0.9 };
  let best: SkillNode | undefined;
  let bestScore = 0;
  for (const n of nodes) {
    const s = overlap(text, nodeText(n));
    if (s > bestScore) {
      best = n;
      bestScore = s;
    }
  }
  if (best && bestScore > 0) return { node: best, confidence: Math.min(0.9, 0.5 + bestScore / 2) };
  return { node: nodes[0] as SkillNode, confidence: 0.4 };
}

function stripSkillRef(value: string): string {
  let s = value.trim();
  if (s.startsWith('/')) s = s.slice(1);
  s = s.split(/\s+/)[0] ?? '';
  const colon = s.lastIndexOf(':');
  return colon >= 0 ? s.slice(colon + 1) : s;
}

function inputText(input: Rec): string {
  return Object.values(input)
    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
    .join(' ');
}

/**
 * Deterministic event -> node mapping. Reads of a reference/asset path, Bash mentioning a script
 * path, AskUserQuestion -> ask_user, Skill -> skill_call, Agent/Task -> delegate, Write/Edit ->
 * output_format. Steps are left to the optional AI aligner.
 */
export function mapEventsToNodes(doc: SkillDoc, events: TraceEvent[]): TraceVisit[] {
  const kinds = (k: string) => doc.nodes.filter((n) => n.kind === k).sort(byOrder);
  const fileNodes = [...kinds('reference'), ...kinds('asset')] as (SkillNode & { path: string })[];
  const scripts = kinds('script') as (SkillNode & { path: string })[];
  const askUsers = kinds('ask_user');
  const skillCalls = kinds('skill_call') as (SkillNode & { skill: string })[];
  const delegates = kinds('delegate') as (SkillNode & { agentType?: string; task: string })[];
  const outputs = kinds('output_format') as (SkillNode & { destination?: string })[];
  const visits: TraceVisit[] = [];
  const push = (nodeId: string, turn: number, evidence: string, confidence: number) =>
    visits.push({ nodeId, turn, evidence, confidence });

  for (const ev of events) {
    if (ev.type !== 'tool_use' || !ev.tool) continue;
    const input = rec(ev.input) ?? {};
    const tool = ev.tool;
    if (tool === 'Read') {
      const fp = str(input.file_path) ?? str(input.path);
      if (!fp) continue;
      for (const n of fileNodes)
        if (pathMatches(fp, n.path)) push(n.id, ev.turn, `Read ${norm(fp)}`, 1);
      continue;
    }
    if (tool === 'Bash') {
      const cmd = str(input.command) ?? '';
      for (const s of scripts) {
        const p = norm(s.path);
        if (cmd.includes(p)) push(s.id, ev.turn, `Bash: ${cmd.slice(0, 120)}`, 1);
        else if (basename(p).length > 3 && cmd.includes(basename(p)))
          push(s.id, ev.turn, `Bash: ${cmd.slice(0, 120)}`, 0.8);
      }
      continue;
    }
    if (tool === 'AskUserQuestion') {
      const questions = Array.isArray(input.questions) ? input.questions : [input];
      const text = questions
        .map((q) => str(rec(q)?.question) ?? str(rec(q)?.header) ?? '')
        .join(' ');
      const hit = bestByText(askUsers, text, (n) => str((n as Rec).question) ?? '');
      if (hit) push(hit.node.id, ev.turn, `AskUserQuestion: ${text.slice(0, 120)}`, hit.confidence);
      continue;
    }
    if (tool === 'Skill') {
      const ref = str(input.skill) ?? str(input.command) ?? str(input.name) ?? '';
      const name = stripSkillRef(ref);
      const exact = skillCalls.filter((n) => stripSkillRef(n.skill) === name);
      if (exact.length > 0) for (const n of exact) push(n.id, ev.turn, `Skill ${ref}`, 1);
      else if (skillCalls.length === 1)
        push((skillCalls[0] as SkillNode).id, ev.turn, `Skill ${ref}`, 0.5);
      continue;
    }
    if (tool === 'Agent' || tool === 'Task') {
      const agentType = str(input.subagent_type);
      const text = `${str(input.description) ?? ''} ${str(input.prompt) ?? ''}`;
      const typed = agentType ? delegates.filter((d) => d.agentType === agentType) : [];
      if (typed.length > 0) {
        const hit = bestByText(typed, text, (n) => (n as { task: string }).task);
        if (hit) push(hit.node.id, ev.turn, `${tool} ${agentType}`, Math.max(hit.confidence, 0.9));
      } else {
        const hit = bestByText(delegates, text, (n) => (n as { task: string }).task);
        if (hit)
          push(hit.node.id, ev.turn, `${tool}: ${text.trim().slice(0, 120)}`, hit.confidence);
      }
      continue;
    }
    if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
      const fp = str(input.file_path) ?? str(input.notebook_path) ?? '';
      const byDest = outputs.filter(
        (o) => o.destination && fp && pathMatches(fp, o.destination.trim()),
      );
      if (byDest.length > 0) for (const o of byDest) push(o.id, ev.turn, `${tool} ${norm(fp)}`, 1);
      else if (outputs.length > 0) {
        const hit = bestByText(
          outputs,
          `${fp} ${inputText(input).slice(0, 2000)}`,
          (n) =>
            `${str((n as Rec).destination) ?? ''} ${str((n as Rec).format) ?? ''} ${str((n as Rec).template) ?? ''}`,
        );
        if (hit) push(hit.node.id, ev.turn, `${tool} ${norm(fp)}`, Math.min(hit.confidence, 0.6));
      }
    }
  }
  return visits;
}

/** Deterministic mapping, then (optionally) the AI aligner for the remaining nodes (steps, phases). */
export async function buildVisits(
  doc: SkillDoc,
  events: TraceEvent[],
  opts: { ai?: Pick<AiPort, 'alignTrace'>; aiAlign?: boolean } = {},
): Promise<TraceVisit[]> {
  const visits = mapEventsToNodes(doc, events);
  if (!opts.aiAlign || !opts.ai) return visits;
  const known = new Set(doc.nodes.map((n) => n.id));
  const seen = new Set(visits.map((v) => `${v.nodeId}@${v.turn}`));
  const aligned = await opts.ai.alignTrace({ doc, events });
  for (const v of aligned.visits) {
    if (!known.has(v.nodeId)) continue;
    const key = `${v.nodeId}@${v.turn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    visits.push(v);
  }
  return visits.sort((a, b) => a.turn - b.turn);
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

export function traceFileName(trace: TraceFile, at = new Date(trace.createdAt)): string {
  return `${stamp(at)}-eval-${trace.evalId}-run-${trace.run}.json`;
}

export function writeTrace(skillDir: string, trace: TraceFile): string {
  const path = join(skillDir, TRACES_DIR, traceFileName(trace));
  writeJson(path, trace);
  return path;
}

function isTraceFile(v: unknown): v is TraceFile {
  const r = rec(v);
  return !!r && Array.isArray(r.visits) && Array.isArray(r.events);
}

/** Read every `*.json` trace under `<dir>` (a skill folder or the traces folder itself). */
export function readTraces(dir: string): TraceFile[] {
  const tracesDir = existsSync(join(dir, TRACES_DIR)) ? join(dir, TRACES_DIR) : dir;
  if (!existsSync(tracesDir)) return [];
  const out: TraceFile[] = [];
  for (const name of readdirSync(tracesDir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const v = readJson(join(tracesDir, name));
      if (isTraceFile(v)) out.push(v);
    } catch {
      // skip unreadable traces
    }
  }
  return out;
}

/** Per-node coverage: in how many traces (runs) was each node visited at least once. */
export function aggregateTraceFiles(traces: TraceFile[]): Record<string, HeatmapEntry> {
  const runs = traces.length;
  const counts = new Map<string, number>();
  for (const t of traces) {
    for (const id of new Set(t.visits.map((v) => v.nodeId)))
      counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: Record<string, HeatmapEntry> = {};
  for (const [id, visits] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    out[id] = { visits, runs, ratio: runs === 0 ? 0 : Math.round((visits / runs) * 10000) / 10000 };
  return out;
}

export function aggregateTraces(dir: string): Record<string, HeatmapEntry> {
  return aggregateTraceFiles(readTraces(dir));
}
