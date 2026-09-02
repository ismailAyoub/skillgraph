import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compileCommand } from '../src/commands/compile';
import { buildZip } from '../src/commands/export';
import { importCommand } from '../src/commands/import';
import { readSkillDir, writeFiles } from '../src/fs';

const FIXTURE = resolve(__dirname, '../../../fixtures/web-design-guidelines');

describe('cli', () => {
  it('reads a skill folder and zips a compiled skill', () => {
    const input = readSkillDir(FIXTURE);
    expect(Object.keys(input.files)).toContain('SKILL.md');
    const { name, data } = buildZip(FIXTURE, { clean: true });
    expect(name).toBe('web-design-guidelines');
    const entries = unzipSync(data);
    expect(Object.keys(entries)).toContain('web-design-guidelines/SKILL.md');
    expect(Object.keys(entries).some((k) => k.endsWith('SKILL.graph.json'))).toBe(false);
  });

  it('import then compile is allowed, and drift is refused afterwards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skillgraph-'));
    const input = readSkillDir(FIXTURE);
    writeFiles(dir, input.files);
    expect(importCommand({ dir, json: true })).toBe(0);
    expect(compileCommand({ dir, quiet: true })).toBe(0);
    const md = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    expect(md).toContain('name: web-design-guidelines');
    writeFileSync(join(dir, 'SKILL.md'), `${md}\n<!-- hand edit -->\n`);
    expect(compileCommand({ dir, quiet: true })).toBe(3);
    expect(compileCommand({ dir, quiet: true, force: true })).toBe(0);
  });
});
