/**
 * `skillgraph service`: keep the local bridge running in the background with launchd (macOS), so it
 * starts at login and there is no terminal to keep open. The web editor then finds it at
 * http://127.0.0.1:4321 and uses the Claude Code login on this machine for AI.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findClaudeBin } from '@skillgraph/ai/claude-cli';
import pc from 'picocolors';

export const SERVICE_LABEL = 'com.skillgraph.bridge';
const DEFAULT_PORT = 4321;

export interface ServiceSpec {
  label: string;
  /** argv: the executable first, then its arguments. */
  program: string[];
  cwd: string;
  env: Record<string, string>;
  logPath: string;
}

export interface ServiceOptions {
  dir?: string;
  port?: number;
}

type ProcLike = Pick<NodeJS.Process, 'execPath' | 'execArgv' | 'argv' | 'cwd'>;

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A launchd property list that starts the bridge at login and restarts it if it stops. */
export function buildPlist(spec: ServiceSpec): string {
  const args = spec.program.map((a) => `      <string>${xml(a)}</string>`).join('\n');
  const env = Object.entries(spec.env)
    .map(([k, v]) => `      <key>${xml(k)}</key>\n      <string>${xml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(spec.label)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(spec.cwd)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xml(spec.logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(spec.logPath)}</string>
  </dict>
</plist>
`;
}

/**
 * The command that runs `skillgraph dev` exactly the way this process was started: the same node,
 * the same loader flags (tsx from a checkout, none from a build) and the same CLI entry.
 */
export function currentInvocation(
  opts: ServiceOptions,
  proc: ProcLike = process,
): { program: string[]; cwd: string } {
  const entry = resolve(proc.argv[1] ?? '');
  const program = [proc.execPath, ...proc.execArgv, entry, 'dev'];
  if (opts.dir) program.push('--dir', resolve(opts.dir));
  if (opts.port) program.push('--port', String(opts.port));
  return { program, cwd: proc.cwd() };
}

/** launchd starts agents with a bare PATH, so the claude binary is pinned at install time. */
export function buildSpec(opts: ServiceOptions, env: NodeJS.ProcessEnv = process.env): ServiceSpec {
  const { program, cwd } = currentInvocation(opts);
  const vars: Record<string, string> = { PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin' };
  if (env.HOME) vars.HOME = env.HOME;
  const claude = findClaudeBin(env);
  if (claude) vars.SKILLGRAPH_CLAUDE_BIN = claude;
  return {
    label: SERVICE_LABEL,
    program,
    cwd,
    env: vars,
    logPath: join(homedir(), 'Library', 'Logs', 'skillgraph', 'bridge.log'),
  };
}

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function domain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

/** Is our own agent loaded (so a health answer on the port is ours, not a stray `skillgraph dev`)? */
async function isService(): Promise<boolean> {
  return launchctl('print', `${domain()}/${SERVICE_LABEL}`).ok;
}

function launchctl(...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

interface Health {
  ok: boolean;
  dir: string;
  version: string;
  ai?: string | null;
  claude?: {
    bin: string | null;
    loggedIn: boolean;
    account: string | null;
    subscription: string | null;
  };
}

async function health(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

async function waitHealthy(port: number, attempts = 10): Promise<Health | null> {
  for (let i = 0; i < attempts; i++) {
    const h = await health(port);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function printHealth(h: Health | null): void {
  if (!h) {
    console.log(`  bridge  ${pc.red('not answering')}`);
    return;
  }
  console.log(`  bridge  ${pc.green('ok')} · ${h.dir}`);
  const c = h.claude;
  if (!c) {
    console.log(
      `  ai      ${h.ai === 'claude-cli' ? pc.green('ready') : pc.yellow('unavailable')}`,
    );
  } else if (!c.bin) {
    console.log(`  claude  ${pc.yellow('not installed (no `claude` on PATH)')}`);
  } else if (!c.loggedIn) {
    console.log(
      `  claude  ${pc.yellow('not logged in: run `claude auth login`, paste the code it shows')}`,
    );
  } else {
    const who = [c.account, c.subscription].filter(Boolean).join(' · ');
    console.log(`  claude  ${pc.green(`logged in${who ? ` (${who})` : ''}`)}`);
  }
}

export async function serviceCommand(
  action: 'install' | 'uninstall' | 'status',
  opts: ServiceOptions = {},
): Promise<number> {
  if (process.platform !== 'darwin') {
    console.error(pc.red('`skillgraph service` uses launchd and only works on macOS.'));
    console.error('Elsewhere, run `skillgraph dev` from a systemd user unit or a scheduled task.');
    return 1;
  }
  const plist = plistPath();
  const port = opts.port ?? DEFAULT_PORT;

  if (action === 'install') {
    // KeepAlive would restart-loop a bridge that cannot bind; refuse to install over another one.
    const already = await health(port);
    if (already && !(await isService())) {
      console.error(
        pc.red(
          `something already answers on http://127.0.0.1:${port} (serving ${already.dir}). Stop that \`skillgraph dev\` first, or pass --port.`,
        ),
      );
      return 1;
    }
    const spec = buildSpec(opts);
    if (!spec.env.SKILLGRAPH_CLAUDE_BIN)
      console.log(
        pc.yellow(
          'warning: no `claude` CLI on PATH. The bridge will serve skills, but AI needs Claude Code installed and logged in (run `claude` once); then reinstall the service.',
        ),
      );
    mkdirSync(dirname(spec.logPath), { recursive: true });
    mkdirSync(dirname(plist), { recursive: true });
    if (existsSync(plist)) launchctl('bootout', `${domain()}/${SERVICE_LABEL}`);
    writeFileSync(plist, buildPlist(spec));
    const r = launchctl('bootstrap', domain(), plist);
    if (!r.ok) {
      console.error(pc.red(`launchctl bootstrap failed: ${r.out || 'unknown error'}`));
      return 1;
    }
    console.log(pc.bold(`installed ${SERVICE_LABEL}`));
    console.log(`  plist   ${plist}`);
    console.log(`  log     ${spec.logPath}`);
    console.log(`  url     http://127.0.0.1:${port}`);
    const h = await waitHealthy(port);
    printHealth(h);
    console.log(
      pc.dim(
        '  Starts at login and restarts if it stops. Remove with `skillgraph service uninstall`.',
      ),
    );
    return h ? 0 : 1;
  }

  if (action === 'uninstall') {
    const r = launchctl('bootout', `${domain()}/${SERVICE_LABEL}`);
    if (!r.ok && !existsSync(plist)) {
      console.log(`${SERVICE_LABEL}: not installed`);
      return 0;
    }
    if (existsSync(plist)) rmSync(plist);
    console.log(pc.green(`removed ${SERVICE_LABEL}`));
    return 0;
  }

  const r = launchctl('print', `${domain()}/${SERVICE_LABEL}`);
  if (!r.ok) {
    console.log(`${SERVICE_LABEL}: ${pc.yellow('not installed')}`);
    console.log(pc.dim('  Install with `skillgraph service install`.'));
    return 1;
  }
  const pid = r.out.match(/^\s*pid = (\d+)/m)?.[1];
  const state = r.out.match(/^\s*state = (\w+)/m)?.[1] ?? 'loaded';
  console.log(`${SERVICE_LABEL}: ${state}${pid ? ` (pid ${pid})` : ''}`);
  const h = await health(port);
  printHealth(h);
  return h ? 0 : 1;
}
