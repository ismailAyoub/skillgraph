import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index';
import { decompile } from '../src/decompiler/index';
import { normalizeMd } from '../src/markdown/index';
import { fixtureDirs, loadSkillDir } from './helpers';

const FIXTURES = resolve(__dirname, '../../../fixtures');
const CORPUS = join(homedir(), '.claude', 'skills');

function roundTrip(dir: string) {
  const input = loadSkillDir(dir);
  const { file, report } = decompile(input);
  const compiled = compile(file.doc);
  return { input, file, report, compiled };
}

describe('round trip: compile(decompile(md)) === normalizeMd(md)', () => {
  for (const dir of fixtureDirs(FIXTURES)) {
    const name = dir.split('/').pop() as string;
    it(name, () => {
      const { input, report, compiled, file } = roundTrip(dir);
      expect(compiled.skillMd).toBe(normalizeMd(input.files['SKILL.md'] as string));
      // Every other text file survives byte-for-byte (modulo a guaranteed trailing newline).
      for (const [p, content] of Object.entries(input.files)) {
        if (p === 'SKILL.md') continue;
        const emitted = compiled.files[p];
        expect(emitted, `missing ${p}`).toBeDefined();
        expect(emitted).toBe(
          content.endsWith('\n') || content.length === 0 ? content : `${content}\n`,
        );
      }
      // Compiling the decompiled graph again is a fixed point.
      const again = decompile({
        files: compiled.files,
        binaryFiles: compiled.binaryFiles,
        dirName: name,
        deterministicIds: true,
      });
      expect(compile(again.file.doc).skillMd).toBe(compiled.skillMd);
      expect(report.coverage).toBeGreaterThan(0);
      expect(file.doc.nodes.length).toBeGreaterThan(1);
    });
  }
});

describe('round trip over the local skill corpus (~/.claude/skills)', () => {
  const dirs = existsSync(CORPUS)
    ? fixtureDirs(CORPUS).filter((d) => existsSync(join(d, 'SKILL.md')))
    : [];
  it.skipIf(dirs.length === 0)('every local skill round-trips', () => {
    const failures: string[] = [];
    for (const dir of dirs) {
      try {
        const { input, compiled } = roundTrip(dir);
        if (compiled.skillMd !== normalizeMd(input.files['SKILL.md'] as string))
          failures.push(dir.split('/').pop() as string);
      } catch (e) {
        failures.push(`${dir.split('/').pop()} (threw: ${(e as Error).message})`);
      }
    }
    expect(failures, `round-trip failures: ${failures.join(', ')}`).toEqual([]);
  });
});
