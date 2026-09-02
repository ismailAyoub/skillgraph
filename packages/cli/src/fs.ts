import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { ImportInput } from '@skillgraph/core';

export const GRAPH_FILE = 'SKILL.graph.json';
const TEXT_EXT =
  /\.(md|markdown|txt|mdx|sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|json|yaml|yml|html|css|csv|toml|xml|svg|mmd)$/i;
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store']);

/** Read a skill folder into the decompiler's input shape. */
export function readSkillDir(dir: string): ImportInput {
  const files: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name) || name === GRAPH_FILE) continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(dir, full).split('\\').join('/');
      if (TEXT_EXT.test(name) || name === 'LICENSE' || name === 'Makefile')
        files[rel] = readFileSync(full, 'utf8');
      else binaryFiles[rel] = readFileSync(full).toString('base64');
    }
  };
  walk(dir);
  return {
    files,
    binaryFiles,
    dirName: dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop(),
  };
}

export function writeFiles(
  dir: string,
  files: Record<string, string>,
  binaryFiles: Record<string, string> = {},
): string[] {
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    if (/^scripts\//.test(rel) || /\.(sh|py|rb|pl)$/.test(rel)) chmodSync(full, 0o755);
    written.push(rel);
  }
  for (const [rel, b64] of Object.entries(binaryFiles)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(b64, 'base64'));
    written.push(rel);
  }
  return written.sort();
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function graphPath(dir: string): string {
  return join(dir, GRAPH_FILE);
}

export function hasGraph(dir: string): boolean {
  return existsSync(graphPath(dir));
}
