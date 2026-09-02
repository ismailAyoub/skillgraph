import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { type CompileResult, compile, type EntryNodeT, type SkillDoc } from '@skillgraph/core';
import { writeFiles } from '../fs';

export interface ProjectOptions {
  doc: SkillDoc;
  /** Install the compiled skill under `.claude/skills/<name>/` (false = baseline project). */
  withSkill: boolean;
  /** Replace the entry description before compiling (trigger evals / optimizer candidates). */
  description?: string;
  /** Skill folder on disk; `files` are resolved against it and copied into `<root>/inputs/`. */
  skillRoot?: string;
  files?: string[];
  /** Parent folder for the temp project (default: os tmpdir). */
  baseDir?: string;
}

export interface Project {
  root: string;
  name: string;
  skillDir?: string;
  inputsDir?: string;
  /** Input files copied into the project, relative to `root`. */
  inputs: string[];
  cleanup(): void;
}

export function entryOf(doc: SkillDoc): EntryNodeT {
  const entry = doc.nodes.find((n) => n.kind === 'entry');
  if (!entry) throw new Error('graph has no entry node');
  return entry as EntryNodeT;
}

/** Compile the doc, optionally with a different entry description (doc is not mutated). */
export function compileWithDescription(doc: SkillDoc, description?: string): CompileResult {
  if (description === undefined) return compile(doc);
  const nodes = doc.nodes.map((n) => (n.kind === 'entry' ? { ...n, description } : n));
  return compile({ ...doc, nodes });
}

/** Build a throwaway Claude Code project folder for one eval run. */
export function createProject(opts: ProjectOptions): Project {
  const name = entryOf(opts.doc).name;
  const base = opts.baseDir ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'skillgraph-eval-'));
  // Always create .claude so Claude Code treats the folder as the project root.
  mkdirSync(join(root, '.claude'), { recursive: true });
  let skillDir: string | undefined;
  if (opts.withSkill) {
    skillDir = join(root, '.claude', 'skills', name);
    const result = compileWithDescription(opts.doc, opts.description);
    writeFiles(skillDir, result.files, result.binaryFiles);
  }
  const inputs: string[] = [];
  let inputsDir: string | undefined;
  if (opts.files && opts.files.length > 0) {
    inputsDir = join(root, 'inputs');
    mkdirSync(inputsDir, { recursive: true });
    for (const rel of opts.files) {
      const src = opts.skillRoot ? resolve(opts.skillRoot, rel) : resolve(rel);
      if (!existsSync(src) || !statSync(src).isFile()) continue;
      const target = join(inputsDir, basename(rel));
      copyFileSync(src, target);
      inputs.push(`inputs/${basename(rel)}`);
    }
  }
  return {
    root,
    name,
    skillDir,
    inputsDir,
    inputs,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
