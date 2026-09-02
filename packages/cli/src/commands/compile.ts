import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type CompileOptions, compile, contentHash, lint, migrate } from '@skillgraph/core';
import pc from 'picocolors';
import { graphPath, readJson, writeFiles, writeJson } from '../fs';
import { printDiagnostics } from '../report';

export interface CompileArgs {
  dir: string;
  out?: string;
  profile?: 'universal' | 'claude-code';
  mermaid?: 'none' | 'file' | 'inline';
  force?: boolean;
  quiet?: boolean;
}

/** Compile SKILL.graph.json in a skill folder into SKILL.md + files. Refuses on drift unless --force. */
export function compileCommand(args: CompileArgs): number {
  const dir = resolve(args.dir);
  const gp = graphPath(dir);
  if (!existsSync(gp)) {
    console.error(
      pc.red(`No SKILL.graph.json in ${dir}. Run \`skillgraph import ${args.dir}\` first.`),
    );
    return 2;
  }
  const file = migrate(readJson(gp));
  const out = resolve(args.out ?? dir);

  if (file.compiled && out === dir && !args.force) {
    const drifted: string[] = [];
    for (const [rel, hash] of Object.entries(file.compiled.files)) {
      const full = join(dir, rel);
      if (!existsSync(full)) continue;
      if (contentHash(readFileSync(full, 'utf8')) !== hash) drifted.push(rel);
    }
    if (drifted.length > 0) {
      console.error(pc.red(`Refusing to overwrite hand-edited files: ${drifted.join(', ')}`));
      console.error(
        pc.dim('Re-import with `skillgraph import` to merge, or pass --force to overwrite.'),
      );
      return 3;
    }
  }

  const options: CompileOptions = { profile: args.profile, mermaid: args.mermaid };
  const result = compile(file.doc, options);
  const written = writeFiles(out, result.files, result.binaryFiles);
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(result.files)) hashes[rel] = contentHash(content);
  if (out === dir) {
    writeJson(gp, {
      ...file,
      compiled: { profile: result.report.profile, at: new Date().toISOString(), files: hashes },
    });
  }
  if (!args.quiet) {
    console.log(
      pc.green(`Compiled ${file.doc.nodes.length} nodes → ${written.length} file(s) in ${out}`),
    );
    console.log(
      pc.dim(
        `  SKILL.md: ${result.report.lines} lines, ~${result.report.tokens} tokens (${result.report.profile})`,
      ),
    );
    const l = lint(file.doc, { compiled: result, dirName: dir.split('/').pop() });
    printDiagnostics(l);
  }
  return 0;
}
