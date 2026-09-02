import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index';
import { decompile } from '../src/decompiler/index';
import { exportManifest, pluginScaffold, skillsRepoScaffold } from '../src/export/index';
import type { EntryNodeT } from '../src/schema/graph';
import { loadSkillDir } from './helpers';

const FIXTURE = resolve(__dirname, '../../../fixtures/idea-refine');

function load() {
  const { file } = decompile(loadSkillDir(FIXTURE));
  const compiled = compile(file.doc);
  const entry = file.doc.nodes.find((n) => n.kind === 'entry') as EntryNodeT;
  return { file, compiled, entry };
}

describe('pluginScaffold', () => {
  it('emits a plugin manifest, a self-pointing marketplace and every compiled file', () => {
    const { compiled, entry } = load();
    const { files, binaryFiles } = pluginScaffold(compiled, entry, {
      version: '1.2.3',
      author: 'Ada',
    });

    const plugin = JSON.parse(files['.claude-plugin/plugin.json'] as string);
    expect(plugin).toEqual({
      name: 'idea-refine',
      version: '1.2.3',
      description: expect.any(String),
      author: { name: 'Ada' },
    });
    expect(plugin.description.length).toBeGreaterThan(0);

    const marketplace = JSON.parse(files['.claude-plugin/marketplace.json'] as string);
    expect(marketplace.name).toBe('idea-refine-marketplace');
    expect(marketplace.owner).toEqual({ name: 'Ada' });
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].source).toBe('./');
    expect(marketplace.plugins[0].name).toBe('idea-refine');
    expect(marketplace.plugins[0].version).toBe('1.2.3');

    for (const rel of Object.keys(compiled.files)) {
      expect(files[`skills/idea-refine/${rel}`]).toBe(compiled.files[rel]);
    }
    for (const rel of Object.keys(compiled.binaryFiles)) {
      expect(binaryFiles[`skills/idea-refine/${rel}`]).toBe(compiled.binaryFiles[rel]);
    }
    expect(files['skills/idea-refine/SKILL.md']).toBe(compiled.skillMd);
    expect(files['README.md']).toContain('claude --plugin-dir .');
    expect(files['README.md']).toContain('/plugin install idea-refine@idea-refine-marketplace');
    // Nothing leaks outside the expected top-level entries.
    const tops = new Set(Object.keys(files).map((p) => p.split('/')[0]));
    expect([...tops].sort()).toEqual(['.claude-plugin', 'README.md', 'skills']);
  });

  it('honours pluginName / marketplaceName / description and omits author when absent', () => {
    const { compiled, entry } = load();
    const { files } = pluginScaffold(compiled, entry, {
      pluginName: 'My Tools',
      marketplaceName: 'acme',
      description: 'Custom text.',
    });
    const plugin = JSON.parse(files['.claude-plugin/plugin.json'] as string);
    expect(plugin.name).toBe('my-tools');
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.description).toBe('Custom text.');
    expect(plugin.author).toBeUndefined();
    const marketplace = JSON.parse(files['.claude-plugin/marketplace.json'] as string);
    expect(marketplace.name).toBe('acme');
    expect(marketplace.owner.name).toBe('my-tools');
    // The skill folder keeps the skill name, not the plugin name.
    expect(files['skills/idea-refine/SKILL.md']).toBeDefined();
  });
});

describe('skillsRepoScaffold', () => {
  it('places the skill under skills/<name>/ with a README', () => {
    const { compiled, entry } = load();
    const { files } = skillsRepoScaffold(compiled, entry);
    expect(files['skills/idea-refine/SKILL.md']).toBe(compiled.skillMd);
    for (const rel of Object.keys(compiled.files)) {
      expect(files[`skills/idea-refine/${rel}`]).toBe(compiled.files[rel]);
    }
    expect(files['README.md']).toContain('npx skills add');
    expect(Object.keys(files).filter((p) => !p.startsWith('skills/'))).toEqual(['README.md']);
  });
});

describe('exportManifest', () => {
  it('describes each target with a single root folder', () => {
    const { file, compiled, entry } = load();
    const graphJson = JSON.stringify(file);

    const zip = exportManifest(entry, compiled, 'zip', { graphJson });
    expect(zip.fileName).toBe('idea-refine.zip');
    expect(zip.root).toBe('idea-refine');
    expect(zip.includesGraph).toBe(true);
    expect(
      zip.files.some((f) => f.path === 'idea-refine/SKILL.graph.json' && f.kind === 'meta'),
    ).toBe(true);
    expect(zip.files.find((f) => f.path === 'idea-refine/SKILL.md')?.kind).toBe('skill');

    const skill = exportManifest(entry, compiled, 'skill');
    expect(skill.fileName).toBe('idea-refine.skill');
    expect(skill.includesGraph).toBe(false);
    expect(skill.files.some((f) => f.path.endsWith('SKILL.graph.json'))).toBe(false);
    expect(skill.files.map((f) => f.path).sort()).toEqual(
      compiled.report.files.map((f) => `idea-refine/${f}`).sort(),
    );

    const plugin = exportManifest(entry, compiled, 'plugin', { pluginName: 'ideas' });
    expect(plugin.root).toBe('ideas-plugin');
    expect(
      plugin.files.find((f) => f.path === 'ideas-plugin/.claude-plugin/plugin.json')?.kind,
    ).toBe('meta');
    expect(plugin.files.some((f) => f.path === 'ideas-plugin/skills/idea-refine/SKILL.md')).toBe(
      true,
    );

    const repo = exportManifest(entry, compiled, 'skills-repo');
    expect(repo.root).toBe('idea-refine-skills');
    expect(repo.files.find((f) => f.path === 'idea-refine-skills/README.md')?.kind).toBe('meta');

    for (const m of [zip, skill, plugin, repo]) {
      expect(m.skillName).toBe('idea-refine');
      expect(new Set(m.files.map((f) => f.path.split('/')[0]))).toEqual(new Set([m.root]));
      expect(m.totalBytes).toBe(m.files.reduce((n, f) => n + f.bytes, 0));
      expect(m.files.map((f) => f.path)).toEqual([...m.files.map((f) => f.path)].sort());
      for (const f of m.files) expect(f.bytes).toBeGreaterThan(0);
    }
  });
});
