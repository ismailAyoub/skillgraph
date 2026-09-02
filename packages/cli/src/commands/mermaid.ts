import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ctx, decompile, migrate, toMermaid } from '@skillgraph/core';
import { graphPath, readJson, readSkillDir } from '../fs';

export function mermaidCommand(args: { dir: string }): number {
  const dir = resolve(args.dir);
  const gp = graphPath(dir);
  const doc = existsSync(gp) ? migrate(readJson(gp)).doc : decompile(readSkillDir(dir)).file.doc;
  process.stdout.write(toMermaid(new Ctx(doc)));
  return 0;
}
