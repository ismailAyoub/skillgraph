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
| `packages/ai` | `@skillgraph/ai` | AI features over the Anthropic API; every result is a validated `GraphPatch` proposal. Browser and Node. |
| `apps/web` | `@skillgraph/web` | Next.js editor: React Flow canvas, inspector, live preview, lint panel, AI tab, heatmap overlay, export menu. |
| `skills/skillgraph-authoring` | | Meta-skill for Claude Code, authored as a graph and compiled by SkillGraph. |
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
pnpm --filter skillgraph exec tsx src/index.ts --help   # no build needed
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

skillgraph publish | mcp | ai <subcommand> | eval <subcommand>
    See the sections below.
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

## Status

| Milestone | State |
|---|---|
| M0 Scaffold, M1 Core + CLI | Done. Byte-for-byte round trip over the fixtures and 31 local skills. |
| M2 Editor MVP | Done. React Flow canvas, inspector, live preview, lint panel, undo/redo, local bridge, zip export, Vercel deploy. |
| M3 Import and sync | Done. Fidelity report, drift protection with a "re-import vs overwrite" modal, MCP server plus the `skillgraph-authoring` meta-skill. |
| M4 AI assist | Done. `@skillgraph/ai`: critique, description composer, trigger-query generator, node copilot, interview to graph, transcript to skill, docs to references, import fallback. Web AI tab and `skillgraph ai`. BYO Anthropic key; every AI result is a proposal until you apply it. |
| M5 Evals | Done. `skillgraph eval`: trigger evals and description optimizer via `claude -p`, task evals with and without the skill, grader, skill-creator compatible `benchmark.json`, execution traces and a coverage heatmap on the canvas. |
| M6 Distribution | Done except hosted accounts. Export as zip, `.skill`, Claude Code plugin (with marketplace manifest) or `skills/` repo; `skillgraph publish` uploads to the Anthropic Skills API; template gallery with nine genres. Hosted accounts with cloud save and share links are not built; the app stays local-first. Codex, Cursor and Gemini consume the `universal` profile, so they have no separate profile. |

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

### AI tab (bring your own key)

Open Settings in the editor header, paste an Anthropic API key and pick a model. The key stays in this browser's localStorage and is sent only to this app's `/api/ai/*` route handlers, one request at a time; the server never stores or logs it. The AI tab in the right-hand panel then offers:

- **Critique**: findings pinned to nodes, each with an optional patch you can apply one by one or all at once.
- **Describe**: description candidates with rationale plus 20 trigger queries (should-trigger and near-miss negatives) ready for `skillgraph eval triggers`.
- **Copilot**: rewrite the selected node (imperative voice, add a why, split steps, draft a reference or script, tighten, or a custom instruction).
- **Interview**: one question at a time in skill-creator's order (what, when, output format, tests); each answer becomes a patch you can undo.
- **Import**: paste a Claude Code transcript to extract a skill, or recover `raw_markdown` nodes left over from an import.

Every AI result is a `GraphPatch` proposal validated against the graph before you see it; applying it goes through the normal undo history. Nothing runs scripts or `!` commands.

### Heatmap

After `skillgraph eval run --trace` has written traces under `evals/traces/`, open the skill through the local bridge and toggle Heatmap: nodes are tinted by how often the recorded runs visited them. Never-visited nodes are the first candidates to cut.

## AI assist from the CLI

`skillgraph ai` needs `ANTHROPIC_API_KEY` (or `--key`). Every subcommand prints its proposal; `--apply` writes it to `SKILL.graph.json` and recompiles.

```text
skillgraph ai critique <dir> [--json] [--apply]
skillgraph ai describe <dir> [--json] [--pick <n>]          # candidates + evals/trigger-queries.json
skillgraph ai queries <dir> [-o file] [--count 20]
skillgraph ai copilot <dir> --node <id> --intent <rewrite-imperative|add-why|split-steps|draft-reference|draft-script|tighten|custom> [--instruction <text>] [--apply]
skillgraph ai interview <dir>                                # interactive; /quit to stop
skillgraph ai from-transcript <dir> <file> [--apply]
skillgraph ai import-fallback <dir> [--apply]
```

## Evals

`skillgraph eval` runs the local `claude` CLI in a throwaway project that contains only the compiled skill, so results reflect what Claude Code actually does. File shapes match Anthropic's skill-creator (`evals/evals.json`, `grading.json`, `benchmark.json`), so its viewer works on the output.

```text
skillgraph eval queries <dir> [--count 20]                   # AI-generated trigger queries
skillgraph eval triggers <dir> [--queries f] [--runs 3] [--concurrency 4] [--description text]
skillgraph eval optimize <dir> [--max-iterations 5] [--runs 3] [--apply]   # 60/40 train/test split
skillgraph eval run <dir> [--evals f] [--runs 1] [--no-baseline] [--trace] [--ai-align]
skillgraph eval heatmap <dir> [--json]
```

A trigger run counts a query as triggered when the transcript contains a `Skill` tool call naming the skill; majority vote over `--runs`. Runs that fail (expired `claude` login, timeout) are reported as errors, never as "no trigger". Task evals write `evals/runs/<timestamp>/eval-<id>/{with_skill,without_skill}/run-<n>/` with `transcript.md`, `outputs/`, `metrics.json`, `timing.json` and `grading.json`, then `benchmark.json` and `benchmark.md` at the run root.

## MCP server and the meta-skill

`skillgraph mcp [--dir ~/.claude/skills]` serves the graph over stdio so Claude Code can build skills with the same `GraphPatch` contract the editor uses: `graph_get`, `graph_apply_patch`, `graph_compile`, `graph_lint`, `graph_import`, `graph_init`, `skill_export`, `graph_vocabulary`, plus the `skillgraph://vocabulary` resource. Writes go through the same drift protection as `compile`. The repo's `.mcp.json` points Claude Code at the workspace copy; for an installed CLI use:

```json
{ "mcpServers": { "skillgraph": { "command": "npx", "args": ["-y", "skillgraph", "mcp"] } } }
```

`skills/skillgraph-authoring/` is the companion skill that teaches Claude Code the node vocabulary and the patch workflow. It is authored as a graph and compiled by SkillGraph itself; copy the folder into `~/.claude/skills/` to use it.

## Distribution

```text
skillgraph export <dir> --format zip          # skill folder + SKILL.graph.json
skillgraph export <dir> --format skill        # clean universal package for claude.ai
skillgraph export <dir> --format plugin --out-dir ./my-plugin [--plugin-name n] [--version v] [--author a]
skillgraph export <dir> --format skills-repo --out-dir ./my-skills     # for `npx skills add`
skillgraph publish <dir> [--display-name n] [--version-of <skillId>] [--dry-run] [--force]
```

The plugin layout carries `.claude-plugin/plugin.json` and a one-plugin `marketplace.json`, so the folder works with `claude --plugin-dir` and as a marketplace source. `publish` compiles with the universal profile, refuses on lint errors unless `--force`, and uses the Anthropic Skills API (`ANTHROPIC_API_KEY` or `--key`). The editor's Export menu offers the same four formats.

## Development notes

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm --filter @skillgraph/web e2e` are what CI runs (`.github/workflows/ci.yml`).
- Run the unbuilt CLI with `pnpm --filter skillgraph exec tsx src/index.ts <command> ...`. The `pnpm ... dev -- <command>` form forwards a literal `--`, which makes commander read flags as positional arguments.
- AI features are tested against recorded responses only; nothing in the test suite talks to the network or spawns the real `claude` binary (`SKILLGRAPH_CLAUDE_BIN` points the eval runner at a fake).

## License

MIT for the SkillGraph packages. Vendored fixtures keep their own licenses (see `fixtures/NOTICE.md`).
