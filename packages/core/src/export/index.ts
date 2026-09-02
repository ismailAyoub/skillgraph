import type { CompileResult } from '../compiler/context';
import type { EntryNodeT } from '../schema/graph';

/**
 * Distribution scaffolds. Pure functions over a compile result: no filesystem, no Node imports,
 * so the same code builds folders on the CLI and zips in the browser.
 */

export type ExportTarget = 'zip' | 'skill' | 'plugin' | 'skills-repo';

export interface Scaffold {
  /** Text files keyed by path relative to the scaffold root. */
  files: Record<string, string>;
  /** Binary files as base64, keyed by path relative to the scaffold root. */
  binaryFiles: Record<string, string>;
}

export interface PluginScaffoldOptions {
  /** Plugin name (kebab-case). Defaults to the skill name. */
  pluginName?: string;
  /** Semver string written to plugin.json. Defaults to 0.1.0. */
  version?: string;
  /** Author name for plugin.json `author.name` and marketplace.json `owner.name`. */
  author?: string;
  /** Plugin description. Defaults to the skill description. */
  description?: string;
  /** Marketplace name (kebab-case). Defaults to `<pluginName>-marketplace`. */
  marketplaceName?: string;
}

/** Shape of `.claude-plugin/plugin.json` (Claude Code plugin manifest). */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: { name: string };
}

/** Shape of `.claude-plugin/marketplace.json` (single-plugin marketplace pointing at `./`). */
export interface MarketplaceManifest {
  name: string;
  owner: { name: string };
  plugins: { name: string; source: string; description: string; version?: string }[];
}

export interface ExportManifestEntry {
  /** Path inside the archive or folder, including the root dir when one applies. */
  path: string;
  binary: boolean;
  bytes: number;
  /** Compiled skill output (SKILL.md, references, scripts, assets) versus packaging metadata. */
  kind: 'skill' | 'meta';
}

export interface ExportManifest {
  target: ExportTarget;
  skillName: string;
  /** Suggested download or folder name, e.g. `idea-refine.zip`, `idea-refine.skill`, `idea-refine-plugin`. */
  fileName: string;
  /** Archive or folder layout: a single top-level folder wraps everything. */
  root: string;
  includesGraph: boolean;
  files: ExportManifestEntry[];
  totalBytes: number;
}

const DEFAULT_VERSION = '0.1.0';
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function kebab(s: string): string {
  const out = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return KEBAB_RE.test(out) ? out : out || 'skill';
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function firstSentence(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : trimmed).trim();
}

/** Copy every compiled file under `prefix/` (no trailing slash on the prefix). */
function placeUnder(compiled: CompileResult, prefix: string): Scaffold {
  const files: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};
  for (const [rel, content] of Object.entries(compiled.files)) files[`${prefix}/${rel}`] = content;
  for (const [rel, b64] of Object.entries(compiled.binaryFiles))
    binaryFiles[`${prefix}/${rel}`] = b64;
  return { files, binaryFiles };
}

function fileTree(compiled: CompileResult): string {
  return compiled.report.files.map((f) => `- \`${f}\``).join('\n');
}

/**
 * Claude Code plugin layout. The folder is both a plugin (`.claude-plugin/plugin.json` +
 * `skills/<name>/`) and a one-plugin marketplace (`.claude-plugin/marketplace.json` whose single
 * entry has `source: "./"`), so it can be tested with `claude --plugin-dir <dir>` and installed with
 * `/plugin marketplace add <owner>/<repo>` followed by `/plugin install <name>@<marketplace>`.
 */
export function pluginScaffold(
  compiled: CompileResult,
  entry: EntryNodeT,
  opts: PluginScaffoldOptions = {},
): Scaffold {
  const skillName = entry.name;
  const pluginName = kebab(opts.pluginName ?? skillName);
  const version = opts.version?.trim() || DEFAULT_VERSION;
  const description = (opts.description ?? firstSentence(entry.description)).trim();
  const author = opts.author?.trim();
  const marketplaceName = kebab(opts.marketplaceName ?? `${pluginName}-marketplace`);

  const plugin: PluginManifest = { name: pluginName, version, description };
  if (author) plugin.author = { name: author };

  const marketplace: MarketplaceManifest = {
    name: marketplaceName,
    owner: { name: author || pluginName },
    plugins: [{ name: pluginName, source: './', description, version }],
  };

  const { files, binaryFiles } = placeUnder(compiled, `skills/${skillName}`);
  files['.claude-plugin/plugin.json'] = json(plugin);
  files['.claude-plugin/marketplace.json'] = json(marketplace);
  files['README.md'] = pluginReadme({
    pluginName,
    skillName,
    marketplaceName,
    description,
    version,
    compiled,
  });
  return { files, binaryFiles };
}

function pluginReadme(input: {
  pluginName: string;
  skillName: string;
  marketplaceName: string;
  description: string;
  version: string;
  compiled: CompileResult;
}): string {
  const { pluginName, skillName, marketplaceName, description, version, compiled } = input;
  return `# ${pluginName}

${description}

A [Claude Code plugin](https://code.claude.com/docs/en/plugins) that ships the \`${skillName}\` skill (invoked as \`/${pluginName}:${skillName}\`). The folder is also a one-plugin marketplace, so it can be installed straight from a git repository.

## Try it locally

\`\`\`bash
claude --plugin-dir .
\`\`\`

Then run \`/${pluginName}:${skillName}\` or let Claude trigger it from the description.

## Install from a repository

Push this folder to a repository (for example \`OWNER/REPO\`), then in Claude Code:

\`\`\`text
/plugin marketplace add OWNER/REPO
/plugin install ${pluginName}@${marketplaceName}
\`\`\`

Bump \`version\` in \`.claude-plugin/plugin.json\` (currently \`${version}\`) so installed copies pick up updates.

## Layout

- \`.claude-plugin/plugin.json\` - plugin manifest
- \`.claude-plugin/marketplace.json\` - single-plugin marketplace pointing at \`./\`
- \`skills/${skillName}/\` - the compiled skill:
${fileTree(compiled)
  .split('\n')
  .map((l) => `  ${l}`)
  .join('\n')}

Generated by [SkillGraph](https://github.com/ismailAyoub/skillgraph). Edit \`SKILL.graph.json\` and recompile rather than editing the compiled files by hand.
`;
}

/**
 * Layout for a skills repository: `skills/<name>/SKILL.md` plus a README, so the repo works with
 * `npx skills add <owner>/<repo>` and with any agent that reads a `skills/` folder.
 */
export function skillsRepoScaffold(compiled: CompileResult, entry: EntryNodeT): Scaffold {
  const skillName = entry.name;
  const { files, binaryFiles } = placeUnder(compiled, `skills/${skillName}`);
  files['README.md'] = `# ${skillName}

${firstSentence(entry.description)}

This repository holds the \`${skillName}\` [Agent Skill](https://agentskills.io) in the \`skills/\` layout that skill installers expect.

## Install

\`\`\`bash
npx skills add OWNER/REPO
\`\`\`

Or copy \`skills/${skillName}/\` into your agent's skills folder (for example \`~/.claude/skills/${skillName}\`).

## Layout

- \`skills/${skillName}/\`:
${fileTree(compiled)
  .split('\n')
  .map((l) => `  ${l}`)
  .join('\n')}

Generated by SkillGraph. Edit \`SKILL.graph.json\` and recompile rather than editing the compiled files by hand.
`;
  return { files, binaryFiles };
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function base64Bytes(b64: string): number {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function isMetaPath(target: ExportTarget, path: string): boolean {
  if (path.endsWith('/SKILL.graph.json')) return true;
  if (target === 'plugin' || target === 'skills-repo') {
    const rel = path.slice(path.indexOf('/') + 1);
    return rel === 'README.md' || rel.startsWith('.claude-plugin/');
  }
  return false;
}

/**
 * Describe what an export would contain without building it. `graphJson` is the serialized
 * SKILL.graph.json to include for the `zip` target (omitted for every other target).
 */
export function exportManifest(
  entry: EntryNodeT,
  compiled: CompileResult,
  target: ExportTarget,
  opts: PluginScaffoldOptions & { graphJson?: string } = {},
): ExportManifest {
  const skillName = entry.name;
  let root: string;
  let fileName: string;
  let scaffold: Scaffold;
  let includesGraph = false;

  switch (target) {
    case 'zip': {
      root = skillName;
      fileName = `${skillName}.zip`;
      scaffold = placeUnder(compiled, root);
      if (opts.graphJson !== undefined) {
        scaffold.files[`${root}/SKILL.graph.json`] = opts.graphJson;
        includesGraph = true;
      }
      break;
    }
    case 'skill': {
      root = skillName;
      fileName = `${skillName}.skill`;
      scaffold = placeUnder(compiled, root);
      break;
    }
    case 'plugin': {
      const pluginName = kebab(opts.pluginName ?? skillName);
      root = `${pluginName}-plugin`;
      fileName = root;
      const inner = pluginScaffold(compiled, entry, opts);
      scaffold = prefixScaffold(inner, root);
      break;
    }
    case 'skills-repo': {
      root = `${skillName}-skills`;
      fileName = root;
      scaffold = prefixScaffold(skillsRepoScaffold(compiled, entry), root);
      break;
    }
  }

  const files: ExportManifestEntry[] = [];
  for (const [path, content] of Object.entries(scaffold.files)) {
    files.push({
      path,
      binary: false,
      bytes: utf8Bytes(content),
      kind: isMetaPath(target, path) ? 'meta' : 'skill',
    });
  }
  for (const [path, b64] of Object.entries(scaffold.binaryFiles)) {
    files.push({ path, binary: true, bytes: base64Bytes(b64), kind: 'skill' });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  return { target, skillName, fileName, root, includesGraph, files, totalBytes };
}

/** Re-root a scaffold under `root/`. */
export function prefixScaffold(scaffold: Scaffold, root: string): Scaffold {
  const files: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};
  for (const [p, c] of Object.entries(scaffold.files)) files[`${root}/${p}`] = c;
  for (const [p, c] of Object.entries(scaffold.binaryFiles)) binaryFiles[`${root}/${p}`] = c;
  return { files, binaryFiles };
}
