import {
  compile,
  decompile,
  type EntryNodeT,
  migrate,
  type PluginScaffoldOptions,
  pluginScaffold,
  type Scaffold,
  type SkillFile,
  skillsRepoScaffold,
} from '@skillgraph/core';
import { strToU8, unzipSync, zipSync } from 'fflate';

const TEXT_EXT =
  /\.(md|markdown|txt|mdx|sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|json|yaml|yml|html|css|csv|toml|xml|svg|mmd)$/i;

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ImportedSkill {
  file: SkillFile;
  coverage?: number;
  source: 'graph' | 'skill.md';
}

/** Turn dropped/selected files into a SkillFile. Accepts a zip, a folder selection, or a single SKILL.md. */
export async function importFiles(files: File[]): Promise<ImportedSkill> {
  const text: Record<string, string> = {};
  const binary: Record<string, string> = {};
  let dirName: string | undefined;

  const addEntry = (path: string, bytes: Uint8Array) => {
    const name = path.split('/').pop() ?? path;
    if (name.startsWith('.') || path.includes('__MACOSX') || path.includes('/.')) return;
    if (TEXT_EXT.test(name) || name === 'LICENSE') text[path] = new TextDecoder().decode(bytes);
    else binary[path] = bytesToBase64(bytes);
  };

  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.(zip|skill)$/i.test(f.name)) {
      const entries = unzipSync(bytes);
      for (const [p, data] of Object.entries(entries)) {
        if (p.endsWith('/')) continue;
        addEntry(p, data);
      }
    } else {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      addEntry(rel, bytes);
    }
  }

  // Strip a common root folder (zip or folder selection) so SKILL.md sits at the root.
  const paths = [...Object.keys(text), ...Object.keys(binary)];
  const skillMdPath = paths.find((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'));
  if (!skillMdPath) throw new Error('No SKILL.md found in the selection');
  const prefix = skillMdPath.slice(0, skillMdPath.length - 'SKILL.md'.length);
  if (prefix) dirName = prefix.split('/').filter(Boolean).pop();
  const strip = (obj: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [p, v] of Object.entries(obj))
      if (p.startsWith(prefix)) out[p.slice(prefix.length)] = v;
    return out;
  };
  const textFiles = strip(text);
  const binaryFiles = strip(binary);

  const graphJson = textFiles['SKILL.graph.json'];
  if (graphJson) {
    delete textFiles['SKILL.graph.json'];
    const file = migrate(JSON.parse(graphJson));
    return { file, source: 'graph' };
  }
  const { file, report } = decompile({ files: textFiles, binaryFiles, dirName });
  return { file, coverage: report.coverage, source: 'skill.md' };
}

type Profile = 'universal' | 'claude-code';

function entryOf(file: SkillFile): EntryNodeT {
  return file.doc.nodes.find((n) => n.kind === 'entry') as EntryNodeT;
}

/** Zip a scaffold under a single `root/` folder. */
function zipScaffold(root: string, scaffold: Scaffold): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, content] of Object.entries(scaffold.files))
    entries[`${root}/${rel}`] = strToU8(content);
  for (const [rel, b64] of Object.entries(scaffold.binaryFiles))
    entries[`${root}/${rel}`] = base64ToBytes(b64);
  return zipSync(entries, { level: 6 });
}

/**
 * Zip a compiled skill (folder-rooted) for download. `clean` (or `includeGraph: false`) omits
 * SKILL.graph.json, which is what claude.ai and the Skills API expect.
 */
export function buildZip(
  file: SkillFile,
  opts: { includeGraph?: boolean; clean?: boolean; profile?: Profile } = {},
): { name: string; data: Uint8Array } {
  const result = compile(file.doc, { profile: opts.profile });
  const entry = entryOf(file);
  const scaffold: Scaffold = { files: { ...result.files }, binaryFiles: { ...result.binaryFiles } };
  const includeGraph = opts.clean ? false : opts.includeGraph !== false;
  if (includeGraph) scaffold.files['SKILL.graph.json'] = `${JSON.stringify(file, null, 2)}\n`;
  return { name: entry.name, data: zipScaffold(entry.name, scaffold) };
}

/** Zip a Claude Code plugin (also a one-plugin marketplace) rooted at `<pluginName>-plugin/`. */
export function buildPluginZip(
  file: SkillFile,
  opts: PluginScaffoldOptions & { profile?: Profile } = {},
): { name: string; data: Uint8Array } {
  const { profile, ...scaffoldOpts } = opts;
  const result = compile(file.doc, { profile });
  const entry = entryOf(file);
  const scaffold = pluginScaffold(result, entry, scaffoldOpts);
  const pluginName: string = JSON.parse(
    scaffold.files['.claude-plugin/plugin.json'] as string,
  ).name;
  const root = `${pluginName}-plugin`;
  return { name: root, data: zipScaffold(root, scaffold) };
}

/** Zip a `skills/<name>/` repository layout (for `npx skills add`) rooted at `<name>-skills/`. */
export function buildSkillsRepoZip(
  file: SkillFile,
  opts: { profile?: Profile } = {},
): { name: string; data: Uint8Array } {
  const result = compile(file.doc, { profile: opts.profile });
  const entry = entryOf(file);
  const root = `${entry.name}-skills`;
  return { name: root, data: zipScaffold(root, skillsRepoScaffold(result, entry)) };
}

export function download(
  name: string,
  data: Uint8Array | string,
  type = 'application/octet-stream',
): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
