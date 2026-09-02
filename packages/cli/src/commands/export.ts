import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type CompileResult,
  compile,
  decompile,
  type EntryNodeT,
  type ExportTarget,
  migrate,
  pluginScaffold,
  type Scaffold,
  type SkillFile,
  skillsRepoScaffold,
} from '@skillgraph/core';
import type { Command } from 'commander';
import { strToU8, zipSync } from 'fflate';
import pc from 'picocolors';
import { graphPath, readJson, readSkillDir, writeFiles } from '../fs';

export type ExportFormat = ExportTarget;
const FORMATS: ExportFormat[] = ['zip', 'skill', 'plugin', 'skills-repo'];

type Profile = 'universal' | 'claude-code';

export interface ExportArgs {
  dir: string;
  /** Archive path for zip / skill formats (default `<name>.zip` or `<name>.skill`). */
  zip?: string;
  /** Omit SKILL.graph.json from the zip (implied by every format except `zip`). */
  clean?: boolean;
  profile?: Profile;
  format?: ExportFormat;
  /** Folder to write for plugin / skills-repo formats (default `<name>-plugin` / `<name>-skills`). */
  outDir?: string;
  pluginName?: string;
  version?: string;
  author?: string;
}

/** Load the graph (or import SKILL.md) and compile it. */
export function loadAndCompile(
  dir: string,
  profile?: Profile,
): { file: SkillFile; compiled: CompileResult; entry: EntryNodeT } {
  const gp = graphPath(dir);
  const file = existsSync(gp) ? migrate(readJson(gp)) : decompile(readSkillDir(dir)).file;
  const compiled = compile(file.doc, { profile });
  const entry = file.doc.nodes.find((n) => n.kind === 'entry') as EntryNodeT;
  return { file, compiled, entry };
}

function zipScaffold(scaffold: Scaffold): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [p, content] of Object.entries(scaffold.files)) entries[p] = strToU8(content);
  for (const [p, b64] of Object.entries(scaffold.binaryFiles))
    entries[p] = Uint8Array.from(Buffer.from(b64, 'base64'));
  return zipSync(entries, { level: 6 });
}

/** Skill zip rooted at `<name>/`; `clean` omits SKILL.graph.json (e.g. for claude.ai upload). */
export function buildZip(
  dir: string,
  opts: { clean?: boolean; profile?: Profile } = {},
): { name: string; data: Uint8Array } {
  const { file, compiled, entry } = loadAndCompile(dir, opts.profile);
  const scaffold: Scaffold = { files: {}, binaryFiles: {} };
  for (const [rel, content] of Object.entries(compiled.files))
    scaffold.files[`${entry.name}/${rel}`] = content;
  for (const [rel, b64] of Object.entries(compiled.binaryFiles))
    scaffold.binaryFiles[`${entry.name}/${rel}`] = b64;
  if (!opts.clean)
    scaffold.files[`${entry.name}/SKILL.graph.json`] = `${JSON.stringify(file, null, 2)}\n`;
  return { name: entry.name, data: zipScaffold(scaffold) };
}

function buildScaffold(
  format: 'plugin' | 'skills-repo',
  dir: string,
  args: ExportArgs,
): { name: string; scaffold: Scaffold } {
  const { compiled, entry } = loadAndCompile(dir, args.profile);
  if (format === 'plugin') {
    const scaffold = pluginScaffold(compiled, entry, {
      pluginName: args.pluginName,
      version: args.version,
      author: args.author,
    });
    const pluginName = JSON.parse(scaffold.files['.claude-plugin/plugin.json'] as string).name;
    return { name: `${pluginName}-plugin`, scaffold };
  }
  return { name: `${entry.name}-skills`, scaffold: skillsRepoScaffold(compiled, entry) };
}

export function exportCommand(args: ExportArgs): number {
  const dir = resolve(args.dir);
  const format = args.format ?? 'zip';
  if (!FORMATS.includes(format)) {
    console.error(pc.red(`Unknown format "${format}". Use one of: ${FORMATS.join(', ')}`));
    return 2;
  }

  if (format === 'zip' || format === 'skill') {
    const clean = format === 'skill' ? true : Boolean(args.clean);
    const { name, data } = buildZip(dir, { clean, profile: args.profile });
    const ext = format === 'skill' ? '.skill' : '.zip';
    const target = resolve(args.zip ?? `${name}${ext}`);
    writeFileSync(target, data);
    console.log(pc.green(`Wrote ${target} (${data.length} bytes)`));
    if (format === 'skill') console.log(pc.dim('  Upload it in claude.ai Settings > Skills.'));
    return 0;
  }

  const { name, scaffold } = buildScaffold(format, dir, args);
  if (args.zip) {
    const rooted: Scaffold = { files: {}, binaryFiles: {} };
    for (const [p, c] of Object.entries(scaffold.files)) rooted.files[`${name}/${p}`] = c;
    for (const [p, c] of Object.entries(scaffold.binaryFiles))
      rooted.binaryFiles[`${name}/${p}`] = c;
    const data = zipScaffold(rooted);
    const target = resolve(args.zip);
    writeFileSync(target, data);
    console.log(pc.green(`Wrote ${target} (${data.length} bytes)`));
    return 0;
  }

  const out = resolve(args.outDir ?? name);
  const written = writeFiles(out, scaffold.files, scaffold.binaryFiles);
  console.log(pc.green(`Wrote ${written.length} file(s) to ${out}`));
  for (const rel of written) console.log(pc.dim(`  ${rel}`));
  if (format === 'plugin') {
    console.log(pc.dim(`  Try it: claude --plugin-dir ${out}`));
  } else {
    console.log(pc.dim('  Push the folder to a repo, then: npx skills add OWNER/REPO'));
  }
  return 0;
}

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Package the compiled skill as a zip, .skill, Claude Code plugin or skills repo')
    .argument('<dir>', 'skill folder')
    .option('-F, --format <format>', 'zip | skill | plugin | skills-repo (default: zip)')
    .option('-z, --zip <file>', 'archive path (default: <name>.zip or <name>.skill)')
    .option('-c, --clean', 'omit SKILL.graph.json from the zip (for claude.ai upload)')
    .option('-p, --profile <profile>', 'universal | claude-code')
    .option('-o, --out-dir <dir>', 'folder to write for plugin / skills-repo formats')
    .option('--plugin-name <name>', 'plugin name (default: the skill name)')
    .option('--version <semver>', 'plugin version (default: 0.1.0)')
    .option('--author <name>', 'plugin author')
    .action((dir: string, opts: Omit<ExportArgs, 'dir'>) =>
      process.exit(exportCommand({ dir, ...opts })),
    );
}
