import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  type CompileOptions,
  type CompileResult,
  compile,
  contentHash,
  decompile,
  type FidelityReport,
  type LintResult,
  lint,
  migrate,
  type SkillDoc,
  type SkillFile,
} from '@skillgraph/core';
import { graphPath, readJson, readSkillDir, writeFiles, writeJson } from '../fs';

export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Thrown for user-facing tool failures; the message is returned as an `isError` result. */
export class McpToolError extends Error {}

export interface SkillRef {
  skill?: string;
  path?: string;
}

/** Resolve a tool's `skill` (folder name inside `dir`) or absolute `path` to a skill folder. */
export function resolveSkillDir(dir: string, ref: SkillRef): string {
  if (ref.path) {
    if (!isAbsolute(ref.path)) throw new McpToolError(`path must be absolute: ${ref.path}`);
    return resolve(ref.path);
  }
  if (!ref.skill) throw new McpToolError('Provide `skill` (folder name) or an absolute `path`.');
  if (!SKILL_NAME_RE.test(ref.skill))
    throw new McpToolError(
      `Invalid skill name "${ref.skill}": use lowercase letters, digits and single hyphens.`,
    );
  return join(dir, ref.skill);
}

export function dirName(skillDir: string): string {
  return (
    skillDir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? skillDir
  );
}

export interface LoadedSkill {
  file: SkillFile;
  source: 'graph' | 'skill.md';
  /** Decompiler coverage when the graph was imported from SKILL.md. */
  coverage?: number;
  report?: FidelityReport;
}

/** Load SKILL.graph.json, or import SKILL.md on the fly (nothing is written). */
export function loadSkill(skillDir: string): LoadedSkill {
  const gp = graphPath(skillDir);
  if (existsSync(gp)) return { file: migrate(readJson(gp)), source: 'graph' };
  if (!existsSync(join(skillDir, 'SKILL.md')))
    throw new McpToolError(`No SKILL.graph.json or SKILL.md in ${skillDir}.`);
  const r = decompile(readSkillDir(skillDir));
  return { file: r.file, source: 'skill.md', coverage: r.report.coverage, report: r.report };
}

/** Files recorded at the last compile whose content changed on disk since. */
export function driftedFiles(skillDir: string, file: SkillFile): string[] {
  if (!file.compiled) return [];
  const drifted: string[] = [];
  for (const [rel, hash] of Object.entries(file.compiled.files)) {
    const full = join(skillDir, rel);
    if (!existsSync(full)) continue;
    if (contentHash(readFileSync(full, 'utf8')) !== hash) drifted.push(rel);
  }
  return drifted;
}

export function assertNoDrift(skillDir: string, file: SkillFile, force?: boolean): void {
  if (force) return;
  const drifted = driftedFiles(skillDir, file);
  if (drifted.length)
    throw new McpToolError(
      `Refusing to overwrite hand-edited files: ${drifted.join(', ')}. Re-import with graph_import { force: true } to keep the edits, or pass force: true to overwrite them.`,
    );
}

export function hashFiles(files: Record<string, string>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) hashes[rel] = contentHash(content);
  return hashes;
}

export interface WriteResult {
  file: SkillFile;
  result: CompileResult;
  written: string[];
  lint: LintResult;
}

/** Compile the doc, write SKILL.md + support files and the graph with fresh hashes, then lint. */
export function compileAndWrite(
  skillDir: string,
  file: SkillFile,
  options: CompileOptions = {},
): WriteResult {
  mkdirSync(skillDir, { recursive: true });
  const result = compile(file.doc, options);
  const written = writeFiles(skillDir, result.files, result.binaryFiles);
  const saved: SkillFile = {
    ...file,
    compiled: {
      profile: result.report.profile,
      at: new Date().toISOString(),
      files: hashFiles(result.files),
    },
  };
  writeJson(graphPath(skillDir), saved);
  const l = lint(saved.doc, { compiled: result, dirName: dirName(skillDir) });
  return { file: saved, result, written, lint: l };
}

/** Write only the graph (no compile). Keeps the previous `compiled` info so drift stays detectable. */
export function writeGraph(skillDir: string, file: SkillFile): void {
  mkdirSync(skillDir, { recursive: true });
  writeJson(graphPath(skillDir), file);
}

export function entryName(doc: SkillDoc): string {
  const entry = doc.nodes.find((n) => n.kind === 'entry') as { name?: string } | undefined;
  return entry?.name ?? '';
}

/** One line per node, indented by containment, followed by the edges. */
export function describeDoc(doc: SkillDoc): string {
  const lines: string[] = [];
  const children = (parentId: string | null) =>
    doc.nodes
      .filter((n) => n.kind !== 'entry' && (n.parentId ?? null) === parentId)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const label = (n: Record<string, unknown>): string => {
    for (const k of ['title', 'question', 'until', 'path', 'text', 'skill', 'label', 'command'])
      if (typeof n[k] === 'string' && n[k]) return JSON.stringify(n[k]);
    if (typeof n.instruction === 'string' && n.instruction)
      return JSON.stringify(`${n.instruction.slice(0, 60)}${n.instruction.length > 60 ? '…' : ''}`);
    return '';
  };
  const walk = (parentId: string | null, depth: number) => {
    for (const n of children(parentId)) {
      lines.push(
        `${'  '.repeat(depth)}${n.id} (${n.kind}, order ${n.order}) ${label(n)}`.trimEnd(),
      );
      if (n.kind === 'phase' || n.kind === 'loop') walk(n.id, depth + 1);
    }
  };
  const entry = doc.nodes.find((n) => n.kind === 'entry') as
    | { id: string; name: string }
    | undefined;
  if (entry) lines.push(`${entry.id} (entry) ${entry.name} [profile ${doc.profile}]`);
  walk(null, 0);
  if (doc.edges.length) {
    lines.push('', 'edges:');
    for (const e of [...doc.edges].sort((a, b) => (a.id < b.id ? -1 : 1)))
      lines.push(
        `  ${e.id}: ${e.kind} ${e.source} -> ${e.target}${e.label ? ` "${e.label}"` : ''}${e.isDefault ? ' (default)' : ''}`,
      );
  }
  return lines.join('\n');
}

export function lintSummary(l: LintResult) {
  return {
    errors: l.errors,
    warnings: l.warnings,
    infos: l.infos,
    diagnostics: l.diagnostics.map((d) => ({
      rule: d.rule,
      severity: d.severity,
      message: d.message,
      ...(d.nodeId ? { nodeId: d.nodeId } : {}),
    })),
  };
}
