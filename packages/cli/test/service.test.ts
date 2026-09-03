import { describe, expect, it } from 'vitest';
import { buildPlist, currentInvocation, SERVICE_LABEL } from '../src/commands/service';

describe('service', () => {
  it('reproduces the current node invocation, loader flags included, plus the dev options', () => {
    const fake = {
      execPath: '/opt/node/bin/node',
      execArgv: ['--import', 'file:///x/tsx/loader.mjs'],
      argv: ['/opt/node/bin/node', '/repo/packages/cli/src/index.ts', 'service', 'install'],
      cwd: () => '/repo/packages/cli',
    };
    const { program, cwd } = currentInvocation({ dir: '/me/.claude/skills', port: 4444 }, fake);
    expect(program).toEqual([
      '/opt/node/bin/node',
      '--import',
      'file:///x/tsx/loader.mjs',
      '/repo/packages/cli/src/index.ts',
      'dev',
      '--dir',
      '/me/.claude/skills',
      '--port',
      '4444',
    ]);
    expect(cwd).toBe('/repo/packages/cli');
  });

  it('omits options that were not given', () => {
    const fake = {
      execPath: '/bin/node',
      execArgv: [],
      argv: ['/bin/node', '/repo/dist/index.js'],
      cwd: () => '/repo',
    };
    expect(currentInvocation({}, fake).program).toEqual([
      '/bin/node',
      '/repo/dist/index.js',
      'dev',
    ]);
  });

  it('writes a launchd plist that keeps the bridge alive and escapes XML', () => {
    const plist = buildPlist({
      label: SERVICE_LABEL,
      program: ['/bin/node', '/repo/dist/index.js', 'dev', '--dir', '/me/a&b'],
      cwd: '/repo',
      env: { PATH: '/x:/y', SKILLGRAPH_CLAUDE_BIN: '/x/claude' },
      logPath: '/me/Library/Logs/skillgraph/bridge.log',
    });
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain('<string>/me/a&amp;b</string>');
    expect(plist).toContain('<key>RunAtLoad</key>\n    <true/>');
    expect(plist).toContain('<key>KeepAlive</key>\n    <true/>');
    expect(plist).toContain('<key>WorkingDirectory</key>\n    <string>/repo</string>');
    expect(plist).toContain('<key>SKILLGRAPH_CLAUDE_BIN</key>\n      <string>/x/claude</string>');
    expect(plist).toContain('<string>/me/Library/Logs/skillgraph/bridge.log</string>');
    // Arguments keep their order.
    expect(plist.indexOf('/bin/node')).toBeLessThan(plist.indexOf('/repo/dist/index.js'));
    expect(plist.indexOf('/repo/dist/index.js')).toBeLessThan(
      plist.indexOf('<string>dev</string>'),
    );
  });
});
