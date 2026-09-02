import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decompile, lint, migrate } from '@skillgraph/core';
import pc from 'picocolors';
import { graphPath, readJson, readSkillDir } from '../fs';
import { printDiagnostics } from '../report';

export function lintCommand(args: { dir: string; json?: boolean }): number {
  const dir = resolve(args.dir);
  const dirName = dir.split('/').pop();
  const gp = graphPath(dir);
  const doc = existsSync(gp) ? migrate(readJson(gp)).doc : decompile(readSkillDir(dir)).file.doc;
  const result = lint(doc, { dirName });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(pc.bold(`${dirName} (${existsSync(gp) ? 'graph' : 'imported from SKILL.md'})`));
    printDiagnostics(result);
  }
  return result.errors > 0 ? 1 : 0;
}
