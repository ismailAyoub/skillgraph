import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerAiCommand } from '../src/commands/ai';

/**
 * `registerAiCommand` is wired into src/index.ts by the orchestrator, so the group is tested
 * against a fresh program rather than by spawning `tsx src/index.ts ai --help`.
 */
function aiGroup(): Command {
  const program = new Command();
  program.name('skillgraph').exitOverride();
  registerAiCommand(program);
  const ai = program.commands.find((c) => c.name() === 'ai');
  if (!ai) throw new Error('registerAiCommand did not add an `ai` command');
  return ai;
}

function optionsOf(cmd: Command): string[] {
  return cmd.options.flatMap((o) => [o.short, o.long].filter((f): f is string => Boolean(f)));
}

describe('skillgraph ai', () => {
  it('registers every subcommand', () => {
    expect(
      aiGroup()
        .commands.map((c) => c.name())
        .sort(),
    ).toEqual([
      'copilot',
      'critique',
      'describe',
      'from-transcript',
      'import-fallback',
      'interview',
      'queries',
    ]);
  });

  it('lists the subcommands in `ai --help`', () => {
    const help = aiGroup().helpInformation();
    for (const name of [
      'critique',
      'describe',
      'queries',
      'copilot',
      'interview',
      'from-transcript',
      'import-fallback',
    ]) {
      expect(help).toContain(name);
    }
    expect(help).toContain('AI assistance');
  });

  it('gives every subcommand the shared key, model and json flags', () => {
    for (const cmd of aiGroup().commands) {
      expect(optionsOf(cmd)).toEqual(expect.arrayContaining(['--key', '--model', '--json']));
    }
  });

  it('exposes the per-subcommand flags', () => {
    const byName = new Map(aiGroup().commands.map((c) => [c.name(), optionsOf(c)]));
    expect(byName.get('critique')).toEqual(expect.arrayContaining(['--apply', '--pick']));
    expect(byName.get('describe')).toEqual(
      expect.arrayContaining(['--apply', '--pick', '-o', '--out']),
    );
    expect(byName.get('queries')).toEqual(expect.arrayContaining(['--count', '-o', '--out']));
    expect(byName.get('copilot')).toEqual(
      expect.arrayContaining(['--node', '--intent', '--instruction', '--apply']),
    );
    expect(byName.get('interview')).toEqual(expect.arrayContaining(['--apply']));
    expect(byName.get('from-transcript')).toEqual(expect.arrayContaining(['--apply']));
    expect(byName.get('import-fallback')).toEqual(expect.arrayContaining(['--node', '--apply']));
  });

  it('takes a skill folder argument, and a transcript file for from-transcript', () => {
    const byName = new Map(aiGroup().commands.map((c) => [c.name(), c]));
    for (const [, cmd] of byName) {
      expect(cmd.registeredArguments[0]?.name()).toBe('dir');
    }
    expect(byName.get('from-transcript')?.registeredArguments.map((a) => a.name())).toEqual([
      'dir',
      'file',
    ]);
  });
});
