import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Command } from 'commander';
import { createSkillgraphMcpServer } from '../mcp/server';

export interface McpArgs {
  dir?: string;
}

/**
 * Serve SkillGraph over stdio for MCP clients (Claude Code, claude.ai, Cursor, ...).
 * stdout carries the protocol, so every log line goes to stderr. Resolves when the client disconnects.
 */
export async function mcpCommand(args: McpArgs): Promise<number> {
  const dir = resolve(args.dir ?? join(homedir(), '.claude', 'skills'));
  mkdirSync(dir, { recursive: true });
  const server = createSkillgraphMcpServer({ dir });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`skillgraph mcp: serving ${dir} over stdio`);
  return new Promise((resolveExit) => {
    transport.onclose = () => resolveExit(0);
    process.stdin.on('end', () => resolveExit(0));
  });
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the SkillGraph MCP server over stdio (graph_get, graph_apply_patch, ...)')
    .option('-d, --dir <skillsDir>', 'skills folder (default: ~/.claude/skills)')
    .action(async (opts: McpArgs) => process.exit(await mcpCommand(opts)));
}
