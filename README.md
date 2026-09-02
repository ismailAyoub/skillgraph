# SkillGraph

See the skill. A good Agent Skill is a procedure graph (phases, steps, branches, "read this reference when...", "run this script", guardrails, an output template, a verification list) flattened into prose, and once it is prose you cannot see its shape, spot the dead branch, or tell why the description under-triggers. SkillGraph makes the graph the source of truth: draw the skill on a canvas, compile it deterministically into a spec-compliant `SKILL.md` plus `references/`, `scripts/` and `assets/`, lint it against the Agent Skills spec and Anthropic's best practices, and import any existing skill back into a graph without losing a line.

## What it is, what it is not

- A design-time compiler for the open [Agent Skills](https://agentskills.io/specification) format (`SKILL.md` with YAML frontmatter and a Markdown body, plus support files), used by Claude Code, Claude.ai, Codex, Cursor, Gemini CLI, Copilot and others.
- `SKILL.graph.json` lives inside the skill folder and is canonical; `SKILL.md` and the support files are build artifacts. Same graph, same bytes, every time. Canvas positions live in a separate `layout` half so they never change the output.
- Two target profiles: `universal` (only the six spec frontmatter keys) and `claude-code` (Claude Code extensions such as `argument-hint`, `context`, `allowed-tools` derived from scripts).
- Not a runtime workflow engine (not n8n or Langflow). Nothing executes on the canvas; the agent executes the compiled Markdown. SkillGraph never runs imported scripts or injected commands.
- Not a form generator. Nodes compile to human-shaped prose (`1. **Restate the idea** as a crisp "How Might We" statement. This forces clarity...`), and a `raw_markdown` node keeps anything the compiler does not model.

## Repository layout

pnpm workspaces plus turborepo, TypeScript strict, biome, vitest. Node 22 or newer.

| Path | Package | Contents |
|---|---|---|
| `packages/core` | `@skillgraph/core` | Zod schema (`schema/graph.ts`), `GraphPatch` apply/invert (`patch/`), compiler (`compiler/`), decompiler (`decompiler/`), linter (`lint/`), Markdown normalizer, token estimator. Pure TypeScript, runs in Node and the browser. |
| `packages/cli` | `skillgraph` | `commander` CLI over core: `init`, `import`, `compile`, `lint`, `export`, `mermaid`. |
| `apps/web` | `@skillgraph/web` | Next.js editor (React Flow canvas, CodeMirror inspector, live preview). Scaffold only today; see the roadmap. |
| `fixtures/` | | Vendored real-world skills used as round-trip test inputs (`idea-refine`, `web-design-guidelines`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `skill-creator`; licenses in `fixtures/NOTICE.md`). |
| `docs/graph-spec.md` | | The graph specification: file format, every node and edge kind, compile rules, overrides, decompiler recognizers, fidelity report, lint rules. |

## Quick start

```bash
pnpm install
pnpm test          # unit, golden, patch and round-trip tests (turbo -> vitest)
pnpm build         # builds packages/core and packages/cli (dist/)
pnpm lint          # biome
pnpm typecheck
```

The CLI is not published yet. Run it from the workspace, either through the built binary or with `tsx`:

```bash
node packages/cli/bin/skillgraph.js --help          # after pnpm build
pnpm --filter skillgraph dev -- --help              # no build needed
```

### CLI

```text
skillgraph init <name> [-d, --description <text>] [--dir <dir>]
    Create ./<name> with SKILL.graph.json (entry + one phase + one step) and the compiled SKILL.md.

skillgraph import <dir> [-o, --out <file>] [-f, --force] [--json]
    Decompile an existing SKILL.md folder into <dir>/SKILL.graph.json and print the fidelity report
    (coverage, raw blocks kept verbatim, non-relative file mentions). Refuses to overwrite an existing graph without --force.

skillgraph compile <dir> [-o, --out <dir>] [-p, --profile <universal|claude-code>] [-m, --mermaid <none|file|inline>] [-f, --force] [-q, --quiet]
    Compile SKILL.graph.json into SKILL.md and the support files, record file hashes in the graph, then lint.
    Refuses to overwrite hand-edited files (hash drift) without --force. Exit 2: no graph; exit 3: drift.

skillgraph lint <dir> [--json]
    Lint the graph (or, without one, the imported SKILL.md). Exit 1 when there are errors.

skillgraph export <dir> [-z, --zip <file>] [-c, --clean] [-p, --profile <profile>]
    Zip the compiled skill as <name>/...; --clean omits SKILL.graph.json (for claude.ai upload).

skillgraph mermaid <dir>
    Print a `flowchart TD` of the skill to stdout.
```

Typical loop for an existing skill:

```bash
skillgraph import ~/.claude/skills/idea-refine        # writes SKILL.graph.json next to SKILL.md
skillgraph lint ~/.claude/skills/idea-refine
skillgraph compile ~/.claude/skills/idea-refine       # re-emits SKILL.md byte-for-byte from the graph
skillgraph export ~/.claude/skills/idea-refine --clean
```

## The round-trip guarantee

Importing a skill and compiling it back reproduces the original, normalized only by the Markdown serializer:

```
compile(decompile(md)).skillMd === normalizeMd(md)
```

Every other text file in the folder survives byte for byte, and compiling the decompiled graph again is a fixed point. `pnpm test` checks this over `fixtures/*` and, when present, over every skill in `~/.claude/skills`. Unrecognized prose is kept in `raw_markdown` nodes, so nothing is dropped; the fidelity report says what was recognized, what was guessed, and what stayed raw. Compiled files carry content hashes in `SKILL.graph.json`, so hand edits to `SKILL.md` are detected and never silently overwritten.

## Roadmap

M0 (scaffold) and M1 (core schema, compiler, decompiler, linter, CLI) are what exists today.

| Milestone | Scope |
|---|---|
| M2 Editor MVP | React Flow canvas with nested phase/loop groups, palette, inspector, elk auto-layout, compile in a worker with live preview, budget meter and lint panel, undo/redo via inverse patches, `skillgraph dev` local bridge to `~/.claude/skills` with IndexedDB fallback, drag-drop import, zip export, Vercel deploy. No AI. |
| M3 Import and sync | Full recognizer set, fidelity report and drift UI ("re-import vs overwrite"), MCP server (`graph.get`, `graph.apply_patch`, `graph.compile`, `graph.lint`, `graph.import`, `skill.export`) plus a meta-skill so Claude Code can build graphs with the same `GraphPatch` contract. |
| M4 AI assist | `packages/ai`: interview to graph, node copilot, critique pass, description composer, transcript to skill, docs to references, AI decompile fallback for raw chunks. BYO Anthropic API key; AI patches are proposals until accepted. |
| M5 Evals | Trigger evals and description optimizer via `claude -p`, task evals with and without the skill, grader, skill-creator compatible `benchmark.json`, execution-trace overlay and coverage heatmap on the canvas. |
| M6 Distribution and hosted | Plugin and marketplace scaffold, Skills API upload, GitHub export, Codex/Cursor/Gemini profiles, template gallery, hosted accounts with cloud save and share links. |

## License

MIT for the SkillGraph packages. Vendored fixtures keep their own licenses (see `fixtures/NOTICE.md`).


## Web editor

`apps/web` is the visual editor: a React Flow canvas with a node palette, an inspector per node kind, a live compiled preview (rendered and raw SKILL.md, emitted files, lint findings, Mermaid), undo/redo, auto-layout and zip export. Skills are stored in the browser (IndexedDB) until you export them or link them to a folder.

```bash
pnpm --filter @skillgraph/web dev   # http://localhost:3210
pnpm --filter @skillgraph/web e2e   # Playwright smoke tests (needs `playwright install chromium` once)
```

### Local bridge (edit `~/.claude/skills` directly)

Run the bridge in a terminal and the editor's "Local skills" panel lists the folder, opens any skill (importing SKILL.md when no graph exists) and writes it back with drift protection: a save is refused when a file changed on disk since you opened it, unless you confirm the overwrite.

```bash
pnpm --filter skillgraph dev dev --dir ~/.claude/skills --port 4321
```

The bridge is a small HTTP API (`/api/health`, `/api/skills`, `/api/skills/:name` GET and PUT) that only listens on 127.0.0.1.
