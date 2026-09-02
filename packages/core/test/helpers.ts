import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ImportInput } from '../src/decompiler/index';

const TEXT_EXT =
  /\.(md|markdown|txt|mdx|sh|bash|py|js|mjs|cjs|ts|rb|json|yaml|yml|html|css|csv|toml|xml|svg)$/i;

/** Load a skill folder from disk into the decompiler's input shape. */
export function loadSkillDir(dir: string): ImportInput {
  const files: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.') || name === '__pycache__' || name === 'node_modules') continue;
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
  return { files, binaryFiles, dirName: dir.split('/').pop(), deterministicIds: true };
}

export function fixtureDirs(root: string): string[] {
  return readdirSync(root)
    .filter((n) => statSync(join(root, n)).isDirectory())
    .map((n) => join(root, n))
    .sort();
}
