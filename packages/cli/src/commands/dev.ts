import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AI_ERROR_STATUS,
  type AiFeatureBody,
  createAi,
  dispatchAiFeature,
  isAiError,
  isAiFeature,
} from '@skillgraph/ai';
import { createClaudeCliBackend } from '@skillgraph/ai/claude-cli';
import { compile, contentHash, decompile, migrate, type SkillFile } from '@skillgraph/core';
import pc from 'picocolors';
import { aggregateTraceFiles, readTraces } from '../eval/trace';
import { GRAPH_FILE, graphPath, readJson, readSkillDir, writeFiles, writeJson } from '../fs';

const VERSION = '0.1.0';

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function safeName(name: string): string | null {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : null;
}

interface SkillEntry {
  name: string;
  hasGraph: boolean;
  hasSkillMd: boolean;
  description: string;
  updatedAt: number;
}

function listSkills(dir: string): SkillEntry[] {
  if (!existsSync(dir)) return [];
  const out: SkillEntry[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    const skillMd = join(full, 'SKILL.md');
    const hasSkillMd = existsSync(skillMd);
    const hasGraph = existsSync(join(full, GRAPH_FILE));
    if (!hasSkillMd && !hasGraph) continue;
    let description = '';
    if (hasSkillMd) {
      const m = readFileSync(skillMd, 'utf8').match(/^description:\s*(.+)$/m);
      description = m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    }
    const updatedAt = Math.max(statSync(full).mtimeMs, hasSkillMd ? statSync(skillMd).mtimeMs : 0);
    out.push({ name, hasGraph, hasSkillMd, description, updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Local bridge: lets the web editor list, open and save skills in a folder (default ~/.claude/skills). */
export function devCommand(args: { dir?: string; port?: number; host?: string }): Promise<number> {
  const dir = resolve(args.dir ?? join(homedir(), '.claude', 'skills'));
  const port = args.port ?? 4321;
  const host = args.host ?? '127.0.0.1';
  mkdirSync(dir, { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      if (req.method === 'OPTIONS') {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/api/health')
        return json(res, 200, { ok: true, dir, version: VERSION, ai: 'claude-cli' });

      // AI features backed by the local Claude Code CLI (or the API when a key header is sent).
      const ai = url.pathname.match(/^\/api\/ai\/([a-z-]+)$/);
      if (ai) {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        const feature = ai[1] as string;
        if (!isAiFeature(feature))
          return json(res, 404, {
            ok: false,
            error: `Unknown AI feature "${feature}"`,
            code: 'not_found',
          });
        const key = (req.headers['x-anthropic-key'] as string | undefined)?.trim();
        const modelHeader = (req.headers['x-anthropic-model'] as string | undefined)?.trim();
        const model = modelHeader || undefined;
        let body: AiFeatureBody;
        try {
          body = JSON.parse(await readBody(req)) as AiFeatureBody;
        } catch {
          return json(res, 400, {
            ok: false,
            error: 'Request body must be JSON',
            code: 'bad_request',
          });
        }
        try {
          const aiClient = key
            ? createAi(model ? { apiKey: key, model } : { apiKey: key })
            : createAi({ backend: createClaudeCliBackend(model ? { model } : {}) });
          const result = await dispatchAiFeature(aiClient, feature, body);
          return json(res, 200, { ok: true, result });
        } catch (e) {
          if (isAiError(e))
            return json(res, AI_ERROR_STATUS[e.code] ?? 500, {
              ok: false,
              error: e.message,
              code: e.code,
            });
          return json(res, 502, { ok: false, error: (e as Error).message, code: 'api' });
        }
      }
      if (url.pathname === '/api/skills' && req.method === 'GET')
        return json(res, 200, listSkills(dir));

      const m = url.pathname.match(/^\/api\/skills\/([^/]+)(\/import|\/traces)?$/);
      if (!m) return json(res, 404, { error: 'not found' });
      const name = safeName(m[1] as string);
      if (!name) return json(res, 400, { error: 'invalid skill name' });
      const skillDir = join(dir, name);

      if (m[2] === '/traces') {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
        if (!existsSync(skillDir)) return json(res, 404, { error: `no skill folder ${name}` });
        const traces = readTraces(skillDir);
        return json(res, 200, { traces, heatmap: aggregateTraceFiles(traces) });
      }

      if (req.method === 'GET') {
        if (!existsSync(skillDir)) return json(res, 404, { error: `no skill folder ${name}` });
        const input = readSkillDir(skillDir);
        const gp = graphPath(skillDir);
        let graph: SkillFile | undefined;
        let coverage: number | undefined;
        if (existsSync(gp)) {
          graph = migrate(readJson(gp));
        } else {
          const r = decompile(input);
          graph = r.file;
          coverage = r.report.coverage;
        }
        // Baseline hashes of what is on disk right now, for drift detection on save.
        const hashes: Record<string, string> = {};
        for (const [rel, content] of Object.entries(input.files))
          hashes[rel] = contentHash(content);
        return json(res, 200, {
          name,
          graph,
          coverage,
          diskHashes: hashes,
          source: existsSync(gp) ? 'graph' : 'skill.md',
        });
      }

      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as {
          file: unknown;
          force?: boolean;
          diskHashes?: Record<string, string>;
        };
        const file = migrate(body.file);
        const result = compile(file.doc);
        const entryName = (file.doc.nodes.find((n) => n.kind === 'entry') as { name: string }).name;
        if (entryName !== name)
          return json(res, 400, { error: `graph name ${entryName} does not match folder ${name}` });
        // Drift: files changed on disk since the client loaded them.
        if (!body.force && body.diskHashes && existsSync(skillDir)) {
          const drifted: string[] = [];
          for (const [rel, hash] of Object.entries(body.diskHashes)) {
            const full = join(skillDir, rel);
            if (existsSync(full) && contentHash(readFileSync(full, 'utf8')) !== hash)
              drifted.push(rel);
          }
          if (drifted.length) return json(res, 409, { error: 'drift', drifted });
        }
        const written = writeFiles(skillDir, result.files, result.binaryFiles);
        const hashes: Record<string, string> = {};
        for (const [rel, content] of Object.entries(result.files))
          hashes[rel] = contentHash(content);
        const saved = {
          ...file,
          compiled: { profile: result.report.profile, at: new Date().toISOString(), files: hashes },
        };
        writeJson(graphPath(skillDir), saved);
        console.log(pc.green(`saved ${name}: ${written.length} file(s)`));
        return json(res, 200, { ok: true, written, diskHashes: hashes });
      }

      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });

  return new Promise((resolveExit) => {
    server.listen(port, host, () => {
      console.log(pc.bold(`skillgraph dev bridge`));
      console.log(`  folder  ${dir}`);
      console.log(`  api     http://${host}:${port}/api/skills`);
      console.log(
        `  ai      http://${host}:${port}/api/ai/<feature> (local claude -p; your login)`,
      );
      console.log(
        pc.dim('  Open the SkillGraph editor and it will list these skills under "Local skills".'),
      );
    });
    server.on('error', (e) => {
      console.error(pc.red(e.message));
      resolveExit(1);
    });
  });
}
