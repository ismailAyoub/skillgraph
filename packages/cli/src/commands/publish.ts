import { resolve } from 'node:path';
import Anthropic, { toFile, type Uploadable } from '@anthropic-ai/sdk';
import { lint } from '@skillgraph/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { printDiagnostics } from '../report';
import { loadAndCompile } from './export';

export interface PublishArgs {
  dir: string;
  /** Anthropic API key; defaults to ANTHROPIC_API_KEY. */
  key?: string;
  /** Skills API display name; defaults to the skill title or name. */
  displayName?: string;
  /** Upload as a new version of an existing skill id instead of creating a skill. */
  versionOf?: string;
  /** List the files that would be uploaded and exit without touching the network. */
  dryRun?: boolean;
  /** Publish even when lint reports errors. */
  force?: boolean;
}

/** Minimal client surface so tests can inject a fake. */
export interface SkillsClient {
  skills: {
    create(body: { files: Uploadable[]; display_name?: string | null }): Promise<{
      id: string;
      latest_version_id: string;
      display_name: string;
    }>;
    versions: {
      create(
        skillId: string,
        body: { files: Uploadable[] },
      ): Promise<{ id: string; skill_id: string }>;
    };
  };
}

function humanize(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => (w[0] ?? '').toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Compile with the universal profile (claude.ai / the Skills API only accept spec keys), refuse on
 * lint errors, then upload every compiled file under `<name>/` via the Anthropic Skills API.
 */
export async function publishCommand(
  args: PublishArgs,
  clientFactory: (apiKey?: string) => SkillsClient = (apiKey) => new Anthropic({ apiKey }),
): Promise<number> {
  const dir = resolve(args.dir);
  const { file, compiled, entry } = loadAndCompile(dir, 'universal');
  const name = entry.name;

  const result = lint(file.doc, { compiled, dirName: dir.split('/').pop() });
  if (result.errors > 0 || result.warnings > 0) printDiagnostics(result);
  if (result.errors > 0 && !args.force) {
    console.error(pc.red(`Refusing to publish ${name}: ${result.errors} lint error(s).`));
    console.error(pc.dim('Fix them or pass --force.'));
    return 1;
  }

  const paths = compiled.report.files;
  console.log(pc.bold(`${name} (${paths.length} files, universal profile)`));
  for (const rel of paths) {
    const size =
      compiled.files[rel] !== undefined
        ? Buffer.byteLength(compiled.files[rel] as string, 'utf8')
        : Buffer.from(compiled.binaryFiles[rel] ?? '', 'base64').length;
    console.log(pc.dim(`  ${name}/${rel} (${size} bytes)`));
  }
  if (args.dryRun) {
    console.log(pc.green('Dry run: nothing uploaded.'));
    return 0;
  }

  const apiKey = args.key ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(pc.red('No API key. Pass --key or set ANTHROPIC_API_KEY.'));
    return 2;
  }

  const files: Uploadable[] = [];
  for (const rel of paths) {
    const text = compiled.files[rel];
    const buf =
      text !== undefined
        ? Buffer.from(text, 'utf8')
        : Buffer.from(compiled.binaryFiles[rel] ?? '', 'base64');
    files.push(await toFile(buf, `${name}/${rel}`));
  }

  const client = clientFactory(apiKey);
  try {
    if (args.versionOf) {
      const version = await client.skills.versions.create(args.versionOf, { files });
      console.log(pc.green(`Published new version of skill ${version.skill_id}`));
      console.log(`  skill id:   ${version.skill_id}`);
      console.log(`  version id: ${version.id}`);
      return 0;
    }
    const skill = await client.skills.create({
      files,
      display_name: args.displayName ?? entry.title ?? humanize(name),
    });
    console.log(pc.green(`Published skill "${skill.display_name}"`));
    console.log(`  skill id:   ${skill.id}`);
    console.log(`  version id: ${skill.latest_version_id}`);
    console.log(pc.dim(`  Next: skillgraph publish ${args.dir} --version-of ${skill.id}`));
    return 0;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error(pc.red('Authentication failed: check the API key.'));
    } else if (err instanceof Anthropic.RateLimitError) {
      console.error(pc.red('Rate limited by the API; try again shortly.'));
    } else if (err instanceof Anthropic.APIError) {
      console.error(pc.red(`API error ${err.status ?? ''}: ${err.message}`));
    } else {
      console.error(pc.red(`Publish failed: ${(err as Error).message}`));
    }
    return 1;
  }
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Upload the compiled skill to the Anthropic Skills API (universal profile)')
    .argument('<dir>', 'skill folder')
    .option('--key <key>', 'Anthropic API key (default: ANTHROPIC_API_KEY)')
    .option('--display-name <name>', 'display name for the new skill')
    .option('--version-of <skillId>', 'publish as a new version of an existing skill')
    .option('--dry-run', 'list the files that would be uploaded and exit')
    .option('--force', 'publish even when lint reports errors')
    .action(async (dir: string, opts: Omit<PublishArgs, 'dir'>) =>
      process.exit(await publishCommand({ dir, ...opts })),
    );
}
