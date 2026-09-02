import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, contentHash, decompile } from '@skillgraph/core';
import pc from 'picocolors';
import { graphPath, readSkillDir, writeJson } from '../fs';

export function importCommand(args: {
  dir: string;
  out?: string;
  force?: boolean;
  json?: boolean;
}): number {
  const dir = resolve(args.dir);
  if (!existsSync(resolve(dir, 'SKILL.md'))) {
    console.error(pc.red(`No SKILL.md in ${dir}`));
    return 2;
  }
  const target = resolve(args.out ?? graphPath(dir));
  if (existsSync(target) && !args.force) {
    console.error(pc.red(`${target} exists. Pass --force to overwrite it.`));
    return 3;
  }
  const input = readSkillDir(dir);
  const { file, report } = decompile(input);
  const compiled = compile(file.doc);
  // Record what is on disk now, so the next compile only refuses if files changed after this import.
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(compiled.files))
    hashes[rel] = contentHash(input.files[rel] ?? content);
  writeJson(target, {
    ...file,
    compiled: { profile: compiled.report.profile, at: new Date().toISOString(), files: hashes },
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const pct = Math.round(report.coverage * 100);
  console.log(
    pc.green(`Imported ${file.doc.nodes.length} nodes, ${file.doc.edges.length} edges → ${target}`),
  );
  console.log(
    `  structure recognized: ${pct}% of the body; ${report.items.filter((i) => i.kind === 'raw').length} raw block(s) kept verbatim`,
  );
  if (report.nonRelativeMentions.length) {
    console.log(
      pc.yellow(
        `  non-relative file mentions resolved by suffix: ${report.nonRelativeMentions.join(', ')}`,
      ),
    );
  }
  return 0;
}
