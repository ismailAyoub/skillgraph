import { Command } from 'commander';
import { registerAiCommand } from './commands/ai';
import { compileCommand } from './commands/compile';
import { devCommand } from './commands/dev';
import { registerEvalCommand } from './commands/eval';
import { registerExportCommand } from './commands/export';
import { importCommand } from './commands/import';
import { initCommand } from './commands/init';
import { lintCommand } from './commands/lint';
import { registerMcpCommand } from './commands/mcp';
import { mermaidCommand } from './commands/mermaid';
import { registerPublishCommand } from './commands/publish';
import { serviceCommand } from './commands/service';

const program = new Command();
program
  .name('skillgraph')
  .description('Draw Agent Skills as graphs; compile them to SKILL.md.')
  .version('0.1.0');

program
  .command('compile')
  .argument('<dir>', 'skill folder containing SKILL.graph.json')
  .option('-o, --out <dir>', 'output folder (defaults to the skill folder)')
  .option('-p, --profile <profile>', 'universal | claude-code')
  .option('-m, --mermaid <mode>', 'none | file | inline')
  .option('-f, --force', 'overwrite hand-edited files')
  .option('-q, --quiet', 'no lint output')
  .action((dir, opts) => process.exit(compileCommand({ dir, ...opts })));

program
  .command('lint')
  .argument('<dir>', 'skill folder (uses SKILL.graph.json when present, else imports SKILL.md)')
  .option('--json', 'machine-readable output')
  .action((dir, opts) => process.exit(lintCommand({ dir, ...opts })));

program
  .command('import')
  .argument('<dir>', 'skill folder with a SKILL.md')
  .option('-o, --out <file>', 'where to write the graph (default: <dir>/SKILL.graph.json)')
  .option('-f, --force', 'overwrite an existing graph')
  .option('--json', 'print the fidelity report as JSON')
  .action((dir, opts) => process.exit(importCommand({ dir, ...opts })));

program
  .command('init')
  .argument('<name>', 'skill name (kebab-case)')
  .option('-d, --description <text>', 'description (what + when)')
  .option('--dir <dir>', 'folder to create (default: ./<name>)')
  .action((name, opts) => process.exit(initCommand({ name, ...opts })));

program
  .command('dev')
  .description('Run the local bridge so the web editor can open and save skills in a folder')
  .option('-d, --dir <dir>', 'skills folder (default: ~/.claude/skills)')
  .option('-p, --port <port>', 'port (default: 4321)', (v) => Number.parseInt(v, 10))
  .action(async (opts) => process.exit(await devCommand(opts)));

const service = program
  .command('service')
  .description(
    'Keep the bridge running in the background (macOS launchd): starts at login, no terminal',
  );
const withDevOptions = (c: Command) =>
  c
    .option('-d, --dir <dir>', 'skills folder (default: ~/.claude/skills)')
    .option('-p, --port <port>', 'port (default: 4321)', (v) => Number.parseInt(v, 10));
withDevOptions(service.command('install').description('Install and start the service')).action(
  async (opts) => process.exit(await serviceCommand('install', opts)),
);
service
  .command('uninstall')
  .description('Stop and remove the service')
  .action(async () => process.exit(await serviceCommand('uninstall')));
withDevOptions(
  service.command('status').description('Is the service loaded and the bridge answering?'),
).action(async (opts) => process.exit(await serviceCommand('status', opts)));

program
  .command('mermaid')
  .argument('<dir>', 'skill folder')
  .action((dir) => process.exit(mermaidCommand({ dir })));

registerExportCommand(program);
registerPublishCommand(program);
registerMcpCommand(program);
registerEvalCommand(program);
registerAiCommand(program);

program.parseAsync(process.argv);
