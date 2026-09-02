import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, contentHash, emptySkillFile, slugify } from '@skillgraph/core';
import pc from 'picocolors';
import { graphPath, writeFiles, writeJson } from '../fs';

export function initCommand(args: { name: string; description?: string; dir?: string }): number {
  const name = slugify(args.name);
  const dir = resolve(args.dir ?? name);
  if (existsSync(graphPath(dir))) {
    console.error(pc.red(`${dir} already has a SKILL.graph.json`));
    return 3;
  }
  mkdirSync(dir, { recursive: true });
  const file = emptySkillFile(
    name,
    args.description ?? `Describe what ${name} does and when to use it.`,
  );
  const entry = file.doc.nodes[0] as { title?: string; overview?: string };
  entry.title = args.name;
  file.doc.nodes.push(
    {
      id: 'phase_1',
      kind: 'phase',
      parentId: null,
      order: 1,
      title: 'Workflow',
      summary: 'What the skill does, step by step.',
      provenance: 'user',
      stepStyle: 'numbered',
    },
    {
      id: 'step_1',
      kind: 'step',
      parentId: 'phase_1',
      order: 1,
      title: 'First step',
      instruction: 'Describe the first thing to do.',
      provenance: 'user',
    },
  );
  const result = compile(file.doc);
  writeFiles(dir, result.files, result.binaryFiles);
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(result.files)) hashes[rel] = contentHash(content);
  writeJson(graphPath(dir), {
    ...file,
    compiled: { profile: result.report.profile, at: new Date().toISOString(), files: hashes },
  });
  console.log(pc.green(`Created ${dir} with SKILL.graph.json and SKILL.md`));
  return 0;
}
