import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  applyPatch,
  compile,
  decompile,
  emptySkillFile,
  GraphPatch,
  type GraphPatchT,
  lint,
  type SkillFile,
  unpackableNodes,
  unpackNodes,
} from '@skillgraph/core';
import { z } from 'zod';
import { buildZip } from '../commands/export';
import { graphPath, readSkillDir, writeJson } from '../fs';
import {
  assertNoDrift,
  compileAndWrite,
  describeDoc,
  dirName,
  entryName,
  hashFiles,
  lintSummary,
  loadSkill,
  McpToolError,
  resolveSkillDir,
  SKILL_NAME_RE,
  writeGraph,
} from './store';
import { VOCABULARY_MD } from './vocabulary';

export const MCP_SERVER_VERSION = '0.1.0';
export const VOCABULARY_URI = 'skillgraph://vocabulary';

export interface McpServerOptions {
  /** Skills folder; `skill` arguments name sub-folders of it. */
  dir: string;
}

const ProfileArg = z
  .enum(['universal', 'claude-code'])
  .optional()
  .describe('Target profile; defaults to the graph profile.');

const skillRef = {
  skill: z
    .string()
    .optional()
    .describe('Skill folder name inside the skills directory (kebab-case).'),
  path: z.string().optional().describe('Absolute path to a skill folder (alternative to skill).'),
};

function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] };
}

function json(value: unknown, prefix?: string): CallToolResult {
  const body = JSON.stringify(value, null, 2);
  return text(prefix ? `${prefix}\n\n${body}` : body);
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Run a tool body; McpToolError and validation errors become `isError` results, never crashes. */
async function guarded(
  fn: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof McpToolError) return fail(e.message);
    if (e instanceof z.ZodError) return fail(`Invalid input:\n${z.prettifyError(e)}`);
    return fail((e as Error).message);
  }
}

/**
 * Pure factory: an MCP server exposing SkillGraph over any transport. All writes go through the
 * same drift protection as `skillgraph compile`; nothing in a skill folder is ever executed.
 */
export function createSkillgraphMcpServer(options: McpServerOptions): McpServer {
  const dir = resolve(options.dir);
  const server = new McpServer(
    { name: 'skillgraph', version: MCP_SERVER_VERSION },
    {
      instructions: [
        'SkillGraph edits Agent Skills as graphs (SKILL.graph.json is canonical; SKILL.md is compiled from it).',
        `Skills live in ${dir}; address one by folder name (skill) or absolute path.`,
        'Call graph_vocabulary once to learn the node kinds, edges and GraphPatch ops, then graph_get -> graph_apply_patch -> graph_lint -> graph_compile. When graph_lint reports graph/procedure-in-markdown, call graph_unpack to turn that markdown into step nodes.',
      ].join(' '),
    },
  );

  server.registerResource(
    'vocabulary',
    VOCABULARY_URI,
    {
      title: 'SkillGraph vocabulary',
      description: 'Node kinds, edge kinds and the GraphPatch op reference.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: VOCABULARY_MD }],
    }),
  );

  server.registerTool(
    'graph_vocabulary',
    {
      title: 'SkillGraph vocabulary',
      description:
        'Return the node/edge vocabulary and the GraphPatch op reference as markdown. Read it before composing patches.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => text(VOCABULARY_MD),
  );

  server.registerTool(
    'graph_get',
    {
      title: 'Get a skill graph',
      description:
        'Load SKILL.graph.json for a skill (or import SKILL.md on the fly when no graph exists; nothing is written). Returns a compact node listing and the full SkillFile JSON.',
      inputSchema: skillRef,
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        const loaded = loadSkill(skillDir);
        const header = [
          `# ${dirName(skillDir)} (source: ${loaded.source}${
            loaded.coverage !== undefined
              ? `, import coverage ${Math.round(loaded.coverage * 100)}%`
              : ''
          })`,
          '',
          describeDoc(loaded.file.doc),
        ].join('\n');
        return json(loaded.file, header);
      }),
  );

  server.registerTool(
    'graph_apply_patch',
    {
      title: 'Apply a GraphPatch',
      description:
        'Apply a GraphPatch ({ ops: [...] }, see graph_vocabulary) to a skill graph and write SKILL.graph.json. With compile (default true) it also compiles SKILL.md and the support files and lints. Refuses when compiled files were hand-edited unless force is true.',
      inputSchema: {
        ...skillRef,
        patch: z
          .object({ ops: z.array(z.record(z.string(), z.unknown())) })
          .describe('GraphPatch: { ops: [{ op: "add", node }, { op: "addEdge", edge }, ...] }'),
        compile: z
          .boolean()
          .optional()
          .describe('Compile and write files after applying (default true).'),
        force: z.boolean().optional().describe('Overwrite hand-edited compiled files.'),
      },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        const loaded = loadSkill(skillDir);
        const parsed = GraphPatch.safeParse(args.patch);
        if (!parsed.success) return fail(`Invalid GraphPatch:\n${z.prettifyError(parsed.error)}`);
        let applied: ReturnType<typeof applyPatch>;
        try {
          applied = applyPatch(loaded.file.doc, parsed.data);
        } catch (e) {
          return fail(`Patch rejected: ${(e as Error).message}`);
        }
        if (args.skill && entryName(applied.doc) !== args.skill)
          return fail(
            `Entry name "${entryName(applied.doc)}" must equal the folder name "${args.skill}".`,
          );
        assertNoDrift(skillDir, loaded.file, args.force);
        const next: SkillFile = { ...loaded.file, doc: applied.doc };
        const shouldCompile = args.compile ?? true;
        if (!shouldCompile) {
          writeGraph(skillDir, next);
          const l = lint(next.doc, { dirName: dirName(skillDir) });
          return json({
            ok: true,
            compiled: false,
            nodeCount: next.doc.nodes.length,
            edgeCount: next.doc.edges.length,
            inverse: applied.inverse,
            lint: lintSummary(l),
          });
        }
        const w = compileAndWrite(skillDir, next);
        return json({
          ok: true,
          compiled: true,
          nodeCount: w.file.doc.nodes.length,
          edgeCount: w.file.doc.edges.length,
          written: w.written,
          lines: w.result.report.lines,
          tokens: w.result.report.tokens,
          inverse: applied.inverse,
          lint: lintSummary(w.lint),
        });
      }),
  );

  server.registerTool(
    'graph_compile',
    {
      title: 'Compile a skill',
      description:
        'Compile SKILL.graph.json into SKILL.md and the support files, record file hashes, and lint. Refuses when compiled files were hand-edited unless force is true.',
      inputSchema: {
        ...skillRef,
        profile: ProfileArg,
        force: z.boolean().optional().describe('Overwrite hand-edited compiled files.'),
      },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        if (!existsSync(graphPath(skillDir)))
          throw new McpToolError(
            `No SKILL.graph.json in ${skillDir}. Call graph_import first (or graph_apply_patch, which imports on the fly).`,
          );
        const loaded = loadSkill(skillDir);
        assertNoDrift(skillDir, loaded.file, args.force);
        const w = compileAndWrite(skillDir, loaded.file, { profile: args.profile });
        return json({
          ok: true,
          written: w.written,
          report: {
            profile: w.result.report.profile,
            lines: w.result.report.lines,
            tokens: w.result.report.tokens,
            budget: w.result.report.budget,
            files: w.result.report.files,
          },
          lint: lintSummary(w.lint),
        });
      }),
  );

  server.registerTool(
    'graph_unpack',
    {
      title: 'Unpack markdown into nodes',
      description:
        'Turn procedures hiding inside markdown into nodes, deterministically: a raw_markdown body, a reference that is really the workflow, or a step with an embedded numbered list becomes phase/step/checklist/guardrail nodes so the graph shows every step. Without nodeIds every unpackable node is unpacked. Writes SKILL.graph.json and, with compile (default true), the compiled files.',
      inputSchema: {
        ...skillRef,
        nodeIds: z
          .array(z.string())
          .optional()
          .describe(
            'Nodes to unpack (default: every node graph_lint flags as procedure-in-markdown).',
          ),
        compile: z
          .boolean()
          .optional()
          .describe('Compile and write files after applying (default true).'),
        force: z.boolean().optional().describe('Overwrite hand-edited compiled files.'),
      },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        const loaded = loadSkill(skillDir);
        const ids = args.nodeIds ?? unpackableNodes(loaded.file.doc).map((u) => u.node.id);
        if (ids.length === 0) return json({ ok: true, unpacked: [], note: 'Nothing to unpack.' });
        let patch: GraphPatchT;
        try {
          patch = unpackNodes(loaded.file.doc, ids);
        } catch (e) {
          return fail(`Unpack rejected: ${(e as Error).message}`);
        }
        const applied = applyPatch(loaded.file.doc, patch);
        assertNoDrift(skillDir, loaded.file, args.force);
        const next: SkillFile = { ...loaded.file, doc: applied.doc };
        if (!(args.compile ?? true)) {
          writeGraph(skillDir, next);
          const l = lint(next.doc, { dirName: dirName(skillDir) });
          return json({
            ok: true,
            compiled: false,
            unpacked: ids,
            nodeCount: next.doc.nodes.length,
            inverse: applied.inverse,
            lint: lintSummary(l),
          });
        }
        const w = compileAndWrite(skillDir, next);
        return json({
          ok: true,
          compiled: true,
          unpacked: ids,
          nodeCount: w.file.doc.nodes.length,
          written: w.written,
          lines: w.result.report.lines,
          inverse: applied.inverse,
          lint: lintSummary(w.lint),
        });
      }),
  );

  server.registerTool(
    'graph_lint',
    {
      title: 'Lint a skill',
      description:
        'Lint the graph (or the imported SKILL.md when no graph exists) against the Agent Skills spec and best practices. Nothing is written.',
      inputSchema: skillRef,
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        const loaded = loadSkill(skillDir);
        const compiled = compile(loaded.file.doc);
        const l = lint(loaded.file.doc, { compiled, dirName: dirName(skillDir) });
        return json({ source: loaded.source, lines: compiled.report.lines, ...lintSummary(l) });
      }),
  );

  server.registerTool(
    'graph_import',
    {
      title: 'Import SKILL.md into a graph',
      description:
        'Decompile an existing SKILL.md folder into SKILL.graph.json and return the fidelity report. Refuses to overwrite an existing graph unless force is true.',
      inputSchema: {
        ...skillRef,
        force: z.boolean().optional().describe('Overwrite an existing SKILL.graph.json.'),
      },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        if (!existsSync(join(skillDir, 'SKILL.md')))
          throw new McpToolError(`No SKILL.md in ${skillDir}.`);
        const gp = graphPath(skillDir);
        if (existsSync(gp) && !args.force)
          throw new McpToolError(`${gp} exists. Pass force: true to overwrite it.`);
        const input = readSkillDir(skillDir);
        const { file, report } = decompile(input);
        const compiled = compile(file.doc);
        // Record what is on disk now so the next compile only refuses if files change after this import.
        const hashes = hashFiles(compiled.files);
        for (const rel of Object.keys(hashes))
          if (input.files[rel] !== undefined)
            hashes[rel] = hashFiles({ [rel]: input.files[rel] })[rel] as string;
        writeJson(gp, {
          ...file,
          compiled: {
            profile: compiled.report.profile,
            at: new Date().toISOString(),
            files: hashes,
          },
        });
        return json({
          ok: true,
          graph: gp,
          nodeCount: file.doc.nodes.length,
          edgeCount: file.doc.edges.length,
          coverage: report.coverage,
          rawBlocks: report.items.filter((i) => i.kind === 'raw').length,
          report,
        });
      }),
  );

  server.registerTool(
    'graph_init',
    {
      title: 'Create a new skill',
      description:
        'Create <dir>/<name> with an empty graph (entry node only) and the compiled SKILL.md. Follow up with graph_apply_patch to add phases and steps.',
      inputSchema: {
        name: z.string().describe('Skill name: lowercase letters, digits and single hyphens.'),
        description: z
          .string()
          .describe(
            'What the skill does and when to use it, third person, pushy ("Use whenever…").',
          ),
        title: z.string().optional().describe('H1 title (defaults to the name).'),
        path: z
          .string()
          .optional()
          .describe('Absolute folder to create instead of <skills dir>/<name>.'),
      },
    },
    async (args) =>
      guarded(() => {
        if (!SKILL_NAME_RE.test(args.name) || args.name.length > 64)
          throw new McpToolError(
            `Invalid skill name "${args.name}": use 1-64 lowercase letters, digits and single hyphens.`,
          );
        const skillDir = resolveSkillDir(dir, { skill: args.name, path: args.path });
        if (existsSync(graphPath(skillDir)))
          throw new McpToolError(`${skillDir} already has a SKILL.graph.json.`);
        if (existsSync(join(skillDir, 'SKILL.md')))
          throw new McpToolError(`${skillDir} already has a SKILL.md; use graph_import instead.`);
        mkdirSync(skillDir, { recursive: true });
        const file = emptySkillFile(args.name, args.description);
        (file.doc.nodes[0] as { title?: string }).title = args.title ?? args.name;
        const w = compileAndWrite(skillDir, file);
        return json({
          ok: true,
          dir: skillDir,
          written: w.written,
          entryId: file.doc.nodes[0]?.id,
          lint: lintSummary(w.lint),
        });
      }),
  );

  server.registerTool(
    'skill_export',
    {
      title: 'Export a skill as a zip',
      description:
        'Zip the compiled skill as <name>/... . clean omits SKILL.graph.json (for claude.ai upload). Writes to out (absolute path) or <skill folder>/../<name>.zip.',
      inputSchema: {
        ...skillRef,
        out: z.string().optional().describe('Absolute zip path.'),
        clean: z.boolean().optional().describe('Omit SKILL.graph.json from the zip.'),
        profile: ProfileArg,
      },
    },
    async (args) =>
      guarded(() => {
        const skillDir = resolveSkillDir(dir, args);
        loadSkill(skillDir);
        const { name, data } = buildZip(skillDir, { clean: args.clean, profile: args.profile });
        const target = args.out ? resolve(args.out) : join(skillDir, '..', `${name}.zip`);
        writeFileSync(target, data);
        return json({ ok: true, zip: target, bytes: data.length, clean: args.clean ?? false });
      }),
  );

  return server;
}
