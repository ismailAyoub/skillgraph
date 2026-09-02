import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, decompile, migrate } from '@skillgraph/core';
import { strToU8, zipSync } from 'fflate';
import pc from 'picocolors';
import { graphPath, readJson, readSkillDir } from '../fs';

/** Build a zip of a compiled skill; `clean` omits SKILL.graph.json (e.g. for claude.ai upload). */
export function buildZip(
  dir: string,
  opts: { clean?: boolean; profile?: 'universal' | 'claude-code' } = {},
): { name: string; data: Uint8Array } {
  const gp = graphPath(dir);
  const file = existsSync(gp) ? migrate(readJson(gp)) : decompile(readSkillDir(dir)).file;
  const result = compile(file.doc, { profile: opts.profile });
  const name = file.doc.nodes.find((n) => n.kind === 'entry') as { name: string };
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, content] of Object.entries(result.files))
    entries[`${name.name}/${rel}`] = strToU8(content);
  for (const [rel, b64] of Object.entries(result.binaryFiles))
    entries[`${name.name}/${rel}`] = Uint8Array.from(Buffer.from(b64, 'base64'));
  if (!opts.clean)
    entries[`${name.name}/SKILL.graph.json`] = strToU8(`${JSON.stringify(file, null, 2)}\n`);
  return { name: name.name, data: zipSync(entries, { level: 6 }) };
}

export function exportCommand(args: {
  dir: string;
  zip?: string;
  clean?: boolean;
  profile?: 'universal' | 'claude-code';
}): number {
  const dir = resolve(args.dir);
  const { name, data } = buildZip(dir, { clean: args.clean, profile: args.profile });
  const target = resolve(args.zip ?? `${name}.zip`);
  writeFileSync(target, data);
  console.log(pc.green(`Wrote ${target} (${data.length} bytes)`));
  return 0;
}
