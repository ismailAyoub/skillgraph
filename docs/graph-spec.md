# SkillGraph graph specification

Describes `@skillgraph/core` 0.1.0, schema version 1. The code under `packages/core/src` is authoritative; this document mirrors what it does today. Behaviour that is planned but not implemented is marked "roadmap".

SkillGraph treats an Agent Skill as a graph. `SKILL.graph.json` is the source of truth; `SKILL.md` and the files next to it are build artifacts produced by a deterministic compiler (`compile(doc) -> { files, skillMd, report }`). A decompiler imports existing skills into graphs, and a linter checks both the graph and the compiled output against the Agent Skills spec (agentskills.io/specification) and Anthropic's best practices. Nothing executes on the canvas: SkillGraph is a design-time compiler, not a runtime workflow engine.

## 1. File format: `SKILL.graph.json`

Lives inside the skill folder next to `SKILL.md`. Agents ignore it; `skillgraph export --clean` strips it.

```json
{
  "schemaVersion": 1,
  "doc": {
    "profile": "claude-code",
    "nodes": [ { "id": "entry_root", "kind": "entry", "order": 0, "name": "reviewing-prs", "description": "..." } ],
    "edges": [ { "id": "e_n1", "kind": "next", "source": "step_a", "target": "step_b" } ]
  },
  "layout": { "nodes": { "step_a": { "x": 120, "y": 80, "w": 240, "h": 96, "collapsed": false } }, "viewport": { "x": 0, "y": 0, "zoom": 1 } },
  "compiled": { "profile": "claude-code", "at": "2026-09-01T12:00:00.000Z", "files": { "SKILL.md": "5c2a9f1e8b3d4c7a", "scripts/lint.sh": "0f1e2d3c4b5a6978" } }
}
```

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | `migrate()` fills a missing version, runs the ordered `MIGRATIONS` chain (empty at v1) and validates with Zod. |
| `doc.profile` | `universal` or `claude-code` | Default `claude-code`. The compile option `profile` overrides it per run. |
| `doc.nodes` | `Node[]` | Semantic content. `sortDoc()` sorts by (`parentId`, `order`, `id`) before saving so diffs are stable. |
| `doc.edges` | `Edge[]` | Sorted by `id` on save. |
| `layout.nodes[id]` | `{x, y, w?, h?, collapsed?}` | Canvas geometry. Never read by the compiler, so a layout-only change produces no output diff. |
| `layout.viewport` | `{x, y, zoom}` | Default `{0, 0, 1}`. |
| `compiled` | `{profile, at, files}` | Written by `init`, `import` and in-place `compile`. `files` maps every emitted text path to `contentHash()` (FNV-1a, 16 hex chars). `compile` refuses to overwrite a file whose hash no longer matches unless `--force`. |

Ids: `newId(kind)` yields `<kind>_<8 base36 chars>` (for example `step_k3j9x0aa`); tests and deterministic imports use `sequentialIds()` (`step_0001`). Any non-empty unique string is valid.

## 2. Profiles

| Behaviour | `universal` | `claude-code` |
|---|---|---|
| Frontmatter | Only the six spec keys. Every `claudeCode` field is dropped with `profile/dropped-fields` (warning). | Spec keys, then Claude Code keys in a fixed order, then passthrough keys. |
| `allowed-tools` separator | space | `, ` |
| `entry.autoAllowScripts` | ignored | adds `Bash(${CLAUDE_SKILL_DIR}/<script path> *)` per script |
| `ask_user` sentence | `Ask the user and wait for their answer before continuing.` (non-blocking: `Ask the user.`) | `Use the AskUserQuestion tool to gather this input, and do not proceed until you have the answer.` (non-blocking: stops after `input.`) |
| `delegate` sentence | `Delegate to a separate agent if available; otherwise do it inline: <task>` | `Spawn a <agentType> subagent with this task: <task>` |
| `skill_call` sentence | ``Apply the `<skill>` skill when <when>.`` | ``Invoke `/<skill> <args>` when <when>.`` |
| `reference` with `source: url` | `Fetch <url> ...` | `Fetch <url> with WebFetch ...` |
| `inject` | `profile/inject-requires-claude-code` (error); node omitted | emitted |
| Lint severities | `spec/unknown-frontmatter`, `spec/description-angle-brackets`, `spec/metadata-string-map` are errors; `profile/substitution-literal` and `spec/allowed-tools-format` active | those three are info or warning; `profile/script-not-preapproved` and `profile/ask-user-in-background-fork` active |

## 3. Node model

Fields shared by every node (`NodeBase`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | required | unique in the doc (`graph/duplicate-id`) |
| `kind` | string | required | one of the 19 kinds below; unknown kinds are kept verbatim and flagged by `graph/unknown-node-kind` |
| `parentId` | string or null | `null` | containment; only `phase` and `loop` may be parents (`graph/missing-parent` if the id is unknown) |
| `order` | int | `0` | semantic position among siblings; ties broken by `id` |
| `title` | string | | bold lead or heading text depending on kind |
| `slug` | string | | file-name base for file kinds without an explicit path |
| `provenance` | `user`, `import`, `ai` | `user` | several lints skip `import` nodes |
| `overrides` | `Record<string, string>` | | replaces compiler-generated sentences by key (section 13) |

| Category | Kinds | Meaning |
|---|---|---|
| Flow (`FLOW_KINDS`) | phase, step, decision, loop, ask_user, delegate, skill_call, inject, raw_markdown, output_format, catalog, checklist, example, guardrail | ordered inside their container and rendered in sequence |
| Container (`CONTAINER_KINDS`) | phase, loop | own children through `parentId` |
| File (`FILE_KINDS`) | reference, script, asset | emit a file; appear in the body only through `reads`/`runs` edges, decision pointers or the reference index |
| Other | entry (singleton), note | entry renders frontmatter, H1 and the synthesized sections; note is canvas-only and never compiled |

Root-section kinds (`output_format`, `example`, `guardrail`, `checklist`, `catalog`) with `parentId: null` are not rendered in flow order; they are diverted into synthesized sections (section 8). Inside a phase or loop they render in place. List-item kinds (`step`, `ask_user`, `delegate`, `skill_call`, `inject`) render as items of the surrounding list; everything else renders as blocks.

## 4. Node kinds

Fields listed are in addition to `NodeBase`. Snippets show the Markdown the compiler emits; section 15 shows a complete document.

### entry

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | required | frontmatter `name`; must equal the folder name |
| `description` | string | required | frontmatter `description` |
| `summary` | markdown | | paragraphs after the H1 |
| `triggers` | string[] | `[]` | structured; lint checks each appears in the description |
| `negativeTriggers` | string[] | `[]` | appended to the description as `Do not use for a, b.` |
| `license`, `compatibility` | string | | frontmatter |
| `metadata` | record | | frontmatter; omitted when empty |
| `allowedTools` | string[] | `[]` | frontmatter `allowed-tools` |
| `allowedToolsRaw` | string | | verbatim imported value; emitted as-is when nothing is derived |
| `autoAllowScripts` | boolean | | claude-code: derive a `Bash(...)` entry per script |
| `claudeCode` | object | | typed keys below plus passthrough |
| `frontmatterOrder` | string[] | | imported key order, emitted first |
| `overview` | `auto`, `none` | `none` | `auto` synthesizes `## How It Works` from root phases |
| `usage` | markdown | | rendered under `## Usage` |
| `referenceIndex` | `unmentioned`, `all`, `none` | `unmentioned` | section 9 |
| `budget` | `{lines, tokens, autoSpill}` | `{500, 5000, false}` | `autoSpill` is reserved; spilling is roadmap |

`claudeCode` typed keys and their YAML names: `argumentHint` (`argument-hint`), `arguments`, `whenToUse` (`when_to_use`), `disableModelInvocation` (`disable-model-invocation`), `userInvocable` (`user-invocable`), `model`, `effort`, `context`, `agent`, `background`, `hidden`, `disallowedTools` (`disallowed-tools`), `maxTurns` (`max-turns`), `memory`, `isolation`, `skills`, `hooks`, `paths`, `shell`. Unknown keys pass through verbatim (info lint).

```markdown
---
name: reviewing-prs
description: <description> Do not use for <negativeTriggers joined by ", ">.
argument-hint: <pr-number>
---

# <title>

<summary>

## How It Works

1. **<phase title>:** <phase summary>
```

### phase

| Field | Type | Default | Notes |
|---|---|---|---|
| `title` | string | required | heading text |
| `summary` | markdown | | used by `## How It Works` |
| `intro` | markdown | | paragraphs under the heading |
| `stepStyle` | `numbered`, `bulleted`, `prose` | `numbered` | list style for child steps; `prose` renders steps as paragraphs |
| `headingDepth` | 1-6 | | import fidelity; default is nesting depth + 1 (root phase = H2) |

Compiles to a heading, the intro paragraphs, then the children in sequence order.

### step

| Field | Type | Default | Notes |
|---|---|---|---|
| `instruction` | markdown | `''` | may contain several paragraphs and lists |
| `why` | markdown | | trailing prose on the first paragraph |
| `detail` | string[] | | nested bullets |
| `tools` | string[] | | hints; emitted only with `mentionTools` |
| `mentionTools` | boolean | | appends `Use <tools joined by ", ">.` |
| `prose` | boolean | | render as paragraphs instead of a list item, whatever the phase's `stepStyle`; `false` opts out of a prose phase. Set by `unpackNode` on steps that came from paragraphs, so one phase can hold prose and a numbered list and still compile back to its original text |
| `spread`, `listSpread`, `listStyle`, `listStart` | fidelity | | loose item, loose list, `numbered`/`bulleted`, start number of the list this step opens |

Rendering: `title` becomes a bold lead prepended to the first paragraph (a space is inserted unless the instruction starts with `.,:;!?)]`), then `why`, then the tools sentence, then one sentence per un-mentioned `reads`/`runs` edge, then `detail` bullets, then a `bash` fence per run script that has `usage`, then attached guardrails and examples.

```markdown
1. **Restate the idea** as a crisp "How Might We" statement. This forces clarity on what is being solved. Read `references/frameworks.md` for ideation frameworks when the idea is vague. Run `scripts/score.sh` to rank the candidates.
   - first detail bullet
```

### decision

`question` (markdown, default `''`) and `intro`. Branches come from `branch` edges; rendering rules are in section 7.

### loop

| Field | Type | Default | Notes |
|---|---|---|---|
| `until` | string | `''` | stop condition; empty falls back to `the goal is met` and warns `graph/loop-needs-until` |
| `maxIterations` | int | | `(at most N rounds)` |
| `intro`, `why` | markdown | | before the opener / after the stop sentence |

A loop is a container without a heading: `Repeat the following until <until> (at most N rounds):`, the children as a numbered list, then `Stop when <until>. <why>`. A `next` edge from a later child back to an earlier one (by `order`) is the loop back-edge and is ignored for ordering.

### ask_user

`question` (markdown, default `''`), `options` (string[]), `blocking` (default `true`), `why`. The profile sentence (override `ask_user:tool`) plus `why` is appended to the question; with `options` the options become a bullet list and the sentence becomes a paragraph after it. `reads`/`runs` sentences and attached blocks follow.

```markdown
1. **Confirm scope** Ask whether nitpicks are welcome. Use the AskUserQuestion tool to gather this input, and do not proceed until you have the answer.
```

### reference

| Field | Type | Default | Notes |
|---|---|---|---|
| `path` | string | required | relative, forward slashes, e.g. `references/forms.md`; empty string means auto-assign |
| `source` | `inline`, `url`, `external` | `inline` | `inline`: body is emitted as the file; `url`: fetched at run time, no file; `external`: referenced but no file emitted |
| `body` | markdown | | file content |
| `url` | string | | for `source: url` |
| `summary` | string | | `for <summary>` / reference index text |
| `readWhen` | string | | `when <readWhen>` |
| `inline` | `auto`, `always`, `never` | `never` | `always`, or `auto` with a body of 12 lines or fewer, inlines the body into SKILL.md instead of a file |
| `categoryId` | string | | catalog membership |

Sentence appended to the host of a `reads` edge:

```markdown
Read `references/standards.md` for the team coding standards when the diff touches shared code.
Fetch https://example.com/guide with WebFetch before each review; it contains the current rules.
```

### catalog

| Field | Type | Default | Notes |
|---|---|---|---|
| `table` | `{header, rows, align?}` | | verbatim table cells (imports); wins over `categories` |
| `categories` | `{id, name, impact?, prefix, description?}[]` | `[]` | generates the priority table |
| `quickReference` | `auto`, `none` | `none` | one sub-heading per category listing member references |
| `intro` | markdown | | |

Members of a category are references with `categoryId === id`, or without `categoryId` whose file name starts with `prefix`. At root the heading is `title`, else override `section:catalog`, else `Rule Categories by Priority`.

```markdown
## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
| --- | --- | --- | --- |
| 1 | Query Performance | CRITICAL | `query-` |

### 1. Query Performance (CRITICAL)

- `query-missing-indexes` - Add indexes for columns used in WHERE and JOIN.
```

### script

| Field | Type | Default | Notes |
|---|---|---|---|
| `path` | string | required | e.g. `scripts/lint.sh`; empty means auto-assign by `language` |
| `language` | string | | drives the auto extension: python `.py`, javascript `.js`, typescript `.ts`, ruby `.rb`, bash/sh/empty `.sh`, else `.<language>` |
| `code` | string | `''` | file content (trailing newline ensured; CLI sets mode 755) |
| `args` | string[] | | appended to the path in the sentence |
| `runWhen` | string | | `to <runWhen>` |
| `outputs` | string | | stored only; not rendered |
| `usage` | string | | emitted as a `bash` fence under the host |

````markdown
1. **Read the diff** with `gh pr diff`. Run `scripts/lint.sh --fix` to check formatting before commenting.

   ```bash
   scripts/lint.sh --fix <pr>
   ```
````

### asset

`path` (required), `content`, `encoding` (`utf8` default, or `base64` for a binary file), `usedFor`. Sentence via a `reads` edge: ``Use `assets/report.md` for the final report.``

### output_format

`template` (default `''`), `format` (fence language), `strictness` (`exact` or `guide`), `destination`, `intro`.

````markdown
## Output

<intro>

Use this exact template:

```markdown
## Summary
## Blocking
```

Save the result to `review.md` after the user confirms.
````

`guide` emits `Use this structure as a guide:`; no strictness emits no sentence; no destination emits no save sentence.

### guardrail

`polarity` (`do` or `dont`, default `dont`), `text` (bold lead, default `''`), `why`, plus fidelity `spread` and `listSpread`. Root: `do` items go under `## Guidelines`, `dont` items under `## Anti-patterns to Avoid`, as `- **<text>** <why>`. Inside a container: consecutive guardrails form one bulleted list in place. Attached to a step or ask_user: a paragraph `**<text>** <why>` inside the host item.

### example

`label`, `input` and `output` (default `''`), `commentary`. Renders `**Example <label>:**` (or `**Example:**`), `Input: <input>`, `Output: <output>`, then the commentary; multi-line input or output becomes `Input:` followed by an unlabelled fenced block. Root examples go under `## Examples`; attached ones render inside the host item.

### checklist

`variant` (`verification`, `red-flags`, `custom`; default `custom`), `style` (`task` default, or `bullet`), `items[{text, why?, checked?}]`, fidelity `spread`. Renders `- [ ] <text> <why>` (`[x]` when checked) or `- <text> <why>` for `bullet`. Root heading: `title`, else override `section:checklist`, else `Verification` / `Red Flags` / `Checklist` by variant.

### delegate

`agentType`, `task` (default `''`), `parallel`, `returns`. The article is `a` or `an` by the first letter of `agentType`; without one the sentence says `a subagent`. `parallel` appends `Run independent subagents in parallel.`; `returns` appends `It should return <returns>.`

```markdown
1. **Survey the code** Spawn an Explore subagent with this task: list every call site. It should return file paths and line numbers.
```

### skill_call

`skill` (default `''`), `args`, `when`. Renders ``Invoke `/commit --amend` when the fix is ready.`` (universal: ``Apply the `commit` skill when the fix is ready.``).

### inject

`command` (default `''`), `label`, `multiline`. Claude Code only. Rendered as an item of the surrounding list: ``PR diff: !`gh pr diff` ``; `multiline` emits the label as a paragraph and the command in a fence with info string `!`.

### raw_markdown

`body` (markdown, default `''`) is re-parsed and emitted with the frozen serializer options. Escape hatch; the decompiler uses it for prose it cannot recognize.

### note

`body` only. Canvas annotation; skipped by the compiler and by the Mermaid export.

## 5. Edges

```json
{ "id": "e1", "kind": "branch", "source": "dec_kind", "target": "step_bug", "label": "A bug fix?", "isDefault": false, "order": 1, "mentioned": false }
```

| Kind | Source to target | Semantics |
|---|---|---|
| `next` | flow node to flow node in the same container | sequence; drives the topological order; decision chains follow it; inside a loop an edge to a lower `order` is the back-edge |
| `branch` | decision to flow node | one labelled branch; label falls back to `Otherwise` (`isDefault`) or `Option N` |
| `reads` | flow node to reference or asset | appends the Read/Fetch/Use sentence to the host; marks the target as mentioned |
| `runs` | flow node to script | appends the Run sentence and the usage fence; marks the target as mentioned |
| `attaches` | guardrail or example to step or ask_user | renders the source inside the host item |

Edges from one node are processed in (`order`, `id`) order; this fixes branch order and the order of appended sentences.

`mentioned: true` means the host text already names the file. The compiler then emits no sentence and no usage fence, but the target still counts as mentioned for the reference index and the `graph/orphan-*` lints. The decompiler sets it on every edge it derives from a file mention.

Containment is `parentId`, not an edge. Edges that cross containers never affect ordering; a `branch` whose target is outside the container renders as a pointer (section 7). `attaches` is honoured only when the target is a step or ask_user; the attached node is still a flow node of its own container and is rendered there as well.

## 6. Ordering

For each container (root, every phase, every loop) `sequence()` does:

1. Take the flow children (kinds in `FLOW_KINDS`), pre-sorted by (`order`, `id`).
2. Build a DAG from `next` and `branch` edges whose source and target are both children of this container (self-edges ignored). Inside a loop, edges whose target has a lower `order` than the source are back-edges and are skipped.
3. Run a Kahn topological sort. Whenever several nodes are ready, the lowest (`order`, `id`) goes first.
4. Nodes left over (a cycle outside a loop) are appended in (`order`, `id`) order, each with `graph/cycle-outside-loop` (error).
5. Expand decisions into branches (section 7). Nodes consumed by a branch chain are not rendered again.

Nodes without any flow edges are ordered by `order` alone; `graph/unreachable-node` (info) flags them when siblings do have edges.

## 7. Decisions

```markdown
<intro>

**What kind of change is it?**

- **A bug fix?** → **Trace the bug** to its root cause before judging the fix.
- **A feature?** →
  1. **Check tests** cover the new behavior.
  2. Look for missing error handling.
```

The join node is the first node (in topological order) reachable through `next` edges from two or more branches. A chain follows `next` from the branch target while the node is in the same container, not consumed, not the join, reachable from only this branch, and not a phase, loop or decision; a node with more than one incoming edge ends the chain after the first node.

| Branch shape | Rendered as |
|---|---|
| target is a reference, script or asset | `see [references/x.md](references/x.md)` |
| target is a phase, loop, decision or a node outside the container | `go to "<title or question>"` |
| empty chain | `continue.` |
| one node whose item is a single paragraph | inline after the arrow |
| one node with extra blocks, or two to three nodes | nested ordered list under the bullet |
| more than three nodes | `see "If <label>" below`, plus a deferred `If <label>` heading (container depth + 1, so `####` inside a root phase) with the ordered list, appended after the container body |

Chain nodes should be list-item kinds; any other kind in a chain renders as its title (or kind name) only. Fewer than two branches raises `graph/decision-branches` (error); a branch to a missing node raises `graph/dangling-edge`.

## 8. Document layout

Root `SKILL.md`, in order:

1. YAML frontmatter (section 11).
2. `# <entry.title>` when set.
3. `entry.summary`.
4. `## How It Works` when `overview: auto` and at least one root phase exists: one ordered item per root phase in (`order`, `id`), `**Title:** summary` (no colon without a summary).
5. `## Usage` when `entry.usage` is set.
6. The root flow in sequence order: phases as `##`, loops, list runs, decisions, raw markdown. Root-section kinds are diverted.
7. Synthesized sections in this fixed order: one `## <catalog>` per catalog, `## Output`, `## Examples`, `## Guidelines`, `## Anti-patterns to Avoid`, one `## <checklist>` per checklist. A section is omitted when it has no nodes.
8. `## Reference files` (section 9).
9. One `## <title or path>` per inlined reference, followed by its body.
10. `## Workflow diagram` with a `mermaid` fence when compiled with `mermaid: inline`.

Heading depth: root phases are H2 (or `headingDepth`), nested phases add one level; `body/heading-depth` warns at H5 and deeper.

List runs: consecutive list-item kinds form one list. The style is the step's `listStyle`, else the current run's style, else the phase `stepStyle` (`bulleted` gives `-`, otherwise `1.`). A step carrying `listStyle`, `listStart` or `listSpread` always starts a new list (import fidelity). A step renders as paragraphs when its own `prose` is true, else when the phase is `stepStyle: prose` and the step does not set `prose: false`; other list-item kinds still form lists. Decisions and block kinds close the current run.

Serializer (frozen, `STRINGIFY_OPTIONS`): bullet `-`, ordered marker `.`, incrementing list markers, emphasis and strong with `*`, fenced code, `listItemIndent: one`, rule `-`, no setext headings, LF line endings, single trailing newline. YAML uses `lineWidth: 0`, indent 2.

## 9. Reference index and inlined references

`entry.referenceIndex` controls `## Reference files`: `unmentioned` (default) lists references that no `reads` edge targets, `all` lists every reference, `none` emits no section. Inlined references and `source: url` references are never listed. Each item is `` `references/x.md` - <summary, else readWhen>``.

A reference is inlined (`isInlinedReference`) when `source` is `inline` and either `inline: always` or `inline: auto` with a body of at most 12 lines. It is rendered as a `##` section at the end of SKILL.md instead of a file. `style/inline-reference-too-long` warns above 40 lines.

## 10. Emitted files and paths

| Node | File | Content |
|---|---|---|
| reference (`source: inline`, not inlined) | `path` | body, trailing newline ensured |
| script | `path` | code, trailing newline ensured; CLI sets mode 755 under `scripts/` or for `.sh .py .rb .pl` |
| asset | `path` | content; `base64` goes to `binaryFiles` |
| compile option `mermaid: file` | `assets/workflow.mmd` | flowchart (section 14) |

Paths are normalized (backslashes to `/`, leading `./` and `/` stripped). Two nodes with the same path raise `body/duplicate-file-path`. A file node with an empty path gets `references/<slug>.md`, `scripts/<slug><ext>` or `assets/<slug>` where slug = `slugify(slug ?? title ?? id)`; collisions get `-2`, `-3`, and so on.

`CompileResult` is `{ files, binaryFiles, skillMd, report }` with `report = { profile, lines, tokens, budget, diagnostics, files, mentioned }`.

## 11. Frontmatter

Key order: `entry.frontmatterOrder` first (imports), then the spec keys `name, description, license, compatibility, metadata, allowed-tools`, then the Claude Code keys in the order listed under `entry`, then any remaining keys sorted. Universal drops every non-spec key with `profile/dropped-fields`.

`description` = trimmed `entry.description` + ` Do not use for <negativeTriggers joined by ", ">.` (override `description:negative`).

`allowed-tools` = `allowedTools` plus derived `Bash(...)` entries, deduplicated. When that list is empty the raw imported string is used; when the raw string exists and nothing was derived it is emitted verbatim; otherwise the list is joined with a space (universal) or `, ` (claude-code).

## 12. Budget and tokens

`entry.budget` defaults to 500 lines and 5000 tokens. Lint: `body/max-lines` is an error above the line budget and a warning at 80 percent of it; `body/token-budget` is a warning above the token budget. The estimator counts `ceil(len / 3.8)` per prose line, `ceil(len / 3.0)` inside fences, 2 per fence marker line and 1 per blank line. `autoSpill` and spilling references or examples into files are roadmap.

## 13. Overrides

`node.overrides[key]` replaces the generated sentence; the key must be on the node named below.

| Key | Node | Replaces (default) |
|---|---|---|
| `ask_user:tool` | ask_user | the profile sentence (`Use the AskUserQuestion tool ...` / `Ask the user ...`) |
| `delegate:sentence` | delegate | `Spawn a ... subagent with this task: ...` / `Delegate to a separate agent ...` |
| `skill_call:sentence` | skill_call | ``Invoke `/skill args` when ...`` / ``Apply the `skill` skill when ...`` |
| `loop:start` | loop | `Repeat the following until <until> (at most N rounds):` |
| `loop:stop` | loop | `Stop when <until>.` |
| `output:strictness` | output_format | `Use this exact template:` / `Use this structure as a guide:` |
| `output:destination` | output_format | the text after ``Save the result to `<destination>` `` (default ` after the user confirms.`) |
| `description:negative` | entry | `Do not use for <negativeTriggers>.` |
| `section:overview`, `section:usage`, `section:output`, `section:examples`, `section:guidelines`, `section:antipatterns`, `section:references`, `section:diagram` | entry | the headings `How It Works`, `Usage`, `Output`, `Examples`, `Guidelines`, `Anti-patterns to Avoid`, `Reference files`, `Workflow diagram` |
| `section:catalog` | catalog | `Rule Categories by Priority` (used when the node has no `title`) |
| `section:checklist` | checklist | `Verification` / `Red Flags` / `Checklist` (used when the node has no `title`) |
| `edge:<edgeId>` | the source node of a `reads`/`runs` edge | the whole Read/Fetch/Run/Use sentence |

## 14. Mermaid

`toMermaid(ctx)` emits a `flowchart TD`: phases and loops become `subgraph` blocks, entry and note nodes are skipped, decisions are `{}`, ask_user `[/ /]`, file nodes `[( )]`, everything else `[ ]`. Labels use `title`, else the first non-empty of `question`, `instruction`, `task`, `text`, `path`, `until`, `skill`, else the kind; quotes become `'`, newlines become spaces, 60 characters maximum. `next` edges are `-->`, `branch` edges `-->|"label"|`, `reads`/`runs` edges `-.->`. Compile with `mermaid: 'file'` for `assets/workflow.mmd`, `'inline'` for a `## Workflow diagram` section, or run `skillgraph mermaid <dir>`.

## 15. Worked example

The graph from `packages/core/test/compile.test.ts` (the `doc` half of a skill file):

```json
{
  "profile": "claude-code",
  "nodes": [
    { "id": "entry_root", "kind": "entry", "order": 0, "name": "reviewing-prs", "title": "Reviewing PRs", "summary": "Reviews pull requests for correctness and style.", "description": "Reviews pull requests for correctness and style. Use whenever the user asks for a code review, PR feedback, or mentions a diff.", "negativeTriggers": ["writing new features"], "overview": "auto", "claudeCode": { "argumentHint": "<pr-number>" } },
    { "id": "phase_gather", "kind": "phase", "order": 1, "title": "Gather context", "summary": "Load the diff and the standards." },
    { "id": "step_diff", "kind": "step", "parentId": "phase_gather", "order": 1, "title": "Read the diff", "instruction": "with `gh pr diff $0`.", "why": "Reviewing from memory misses edge cases." },
    { "id": "ref_standards", "kind": "reference", "order": 900, "path": "references/standards.md", "body": "# Standards\n\n- No console.log in production.\n", "summary": "the team coding standards", "readWhen": "the diff touches shared code" },
    { "id": "script_lint", "kind": "script", "order": 901, "path": "scripts/lint.sh", "code": "#!/bin/bash\nnpm run lint", "runWhen": "check formatting before commenting" },
    { "id": "phase_review", "kind": "phase", "order": 2, "title": "Review", "summary": "Decide what kind of change it is and review accordingly." },
    { "id": "dec_kind", "kind": "decision", "parentId": "phase_review", "order": 1, "question": "What kind of change is it?" },
    { "id": "step_bug", "kind": "step", "parentId": "phase_review", "order": 2, "title": "Trace the bug", "instruction": "to its root cause before judging the fix." },
    { "id": "step_feature", "kind": "step", "parentId": "phase_review", "order": 3, "title": "Check tests", "instruction": "cover the new behavior." },
    { "id": "step_feature2", "kind": "step", "parentId": "phase_review", "order": 4, "instruction": "Look for missing error handling." },
    { "id": "ask_scope", "kind": "ask_user", "parentId": "phase_review", "order": 5, "title": "Confirm scope", "question": "Ask whether nitpicks are welcome.", "blocking": true },
    { "id": "loop_fix", "kind": "loop", "parentId": "phase_review", "order": 6, "until": "no blocking issues remain", "maxIterations": 3 },
    { "id": "step_comment", "kind": "step", "parentId": "loop_fix", "order": 1, "title": "Comment", "instruction": "on the most severe issue." },
    { "id": "guard_tone", "kind": "guardrail", "order": 10, "polarity": "do", "text": "Be specific.", "why": "Vague feedback wastes a round trip." },
    { "id": "guard_nits", "kind": "guardrail", "order": 11, "polarity": "dont", "text": "Don't block on style.", "why": "Formatters exist." },
    { "id": "out_report", "kind": "output_format", "order": 12, "template": "## Summary\n## Blocking\n## Nits", "format": "markdown", "strictness": "exact" },
    { "id": "ex_1", "kind": "example", "order": 13, "label": "1", "input": "Fix null deref in parser", "output": "Blocking: the guard is on the wrong branch." },
    { "id": "check_done", "kind": "checklist", "order": 14, "variant": "verification", "items": [ { "text": "Every blocking issue cites a line." }, { "text": "Tests were run.", "why": "Green CI is the bar." } ] }
  ],
  "edges": [
    { "id": "e_reads", "kind": "reads", "source": "step_diff", "target": "ref_standards" },
    { "id": "e_runs", "kind": "runs", "source": "step_diff", "target": "script_lint" },
    { "id": "e_b1", "kind": "branch", "source": "dec_kind", "target": "step_bug", "label": "A bug fix?" },
    { "id": "e_b2", "kind": "branch", "source": "dec_kind", "target": "step_feature", "label": "A feature?" },
    { "id": "e_n1", "kind": "next", "source": "step_feature", "target": "step_feature2" },
    { "id": "e_n2", "kind": "next", "source": "step_bug", "target": "ask_scope" },
    { "id": "e_n3", "kind": "next", "source": "step_feature2", "target": "ask_scope" },
    { "id": "e_n4", "kind": "next", "source": "ask_scope", "target": "loop_fix" }
  ]
}
```

`compile(doc).skillMd` is exactly:

````markdown
---
name: reviewing-prs
description: Reviews pull requests for correctness and style. Use whenever the user asks for a code review, PR feedback, or mentions a diff. Do not use for writing new features.
argument-hint: <pr-number>
---

# Reviewing PRs

Reviews pull requests for correctness and style.

## How It Works

1. **Gather context:** Load the diff and the standards.
2. **Review:** Decide what kind of change it is and review accordingly.

## Gather context

1. **Read the diff** with `gh pr diff $0`. Reviewing from memory misses edge cases. Read `references/standards.md` for the team coding standards when the diff touches shared code. Run `scripts/lint.sh` to check formatting before commenting.

## Review

**What kind of change is it?**

- **A bug fix?** → **Trace the bug** to its root cause before judging the fix.
- **A feature?** →
  1. **Check tests** cover the new behavior.
  2. Look for missing error handling.

1. **Confirm scope** Ask whether nitpicks are welcome. Use the AskUserQuestion tool to gather this input, and do not proceed until you have the answer.

Repeat the following until no blocking issues remain (at most 3 rounds):

1. **Comment** on the most severe issue.

Stop when no blocking issues remain.

## Output

Use this exact template:

```markdown
## Summary
## Blocking
## Nits
```

## Examples

**Example 1:**

Input: Fix null deref in parser

Output: Blocking: the guard is on the wrong branch.

## Guidelines

- **Be specific.** Vague feedback wastes a round trip.

## Anti-patterns to Avoid

- **Don't block on style.** Formatters exist.

## Verification

- [ ] Every blocking issue cites a line.
- [ ] Tests were run. Green CI is the bar.
````

Other emitted files: `references/standards.md` (the reference body) and `scripts/lint.sh` (`#!/bin/bash\nnpm run lint\n`). `ask_scope` is the join of both branches, so it is rendered once after the decision. `ref_standards` is mentioned by a `reads` edge, so no `## Reference files` section appears. With `{ mermaid: 'file' }` the compiler also writes `assets/workflow.mmd` (a `subgraph` per phase, a nested one for the loop, `dec_kind{...}` for the decision, dotted edges from `step_diff` to the two file nodes). Under `{ profile: 'universal' }` the same graph drops `argument-hint` (with `profile/dropped-fields`) and renders the ask_user sentence as `Ask the user and wait for their answer before continuing.`

## 16. GraphPatch

`applyPatch(doc, patch)` is the single mutation contract for the editor, the CLI, import and (roadmap) AI and MCP. It is pure, validates the result with `SkillDocSchema`, and returns `{ doc, inverse }` where applying `inverse` restores the input (undo/redo).

| Op | Payload | Effect | Inverse |
|---|---|---|---|
| `add` | `{node}` | appends a node; duplicate id throws | `remove` |
| `update` | `{id, data}` | shallow-merges `data`; a key set to `undefined` is deleted | `update` with the previous values |
| `remove` | `{id}` | removes the node and every incident edge; children are re-parented to the removed node's parent, keeping their `order` | `restore` plus a `move` per child |
| `move` | `{id, parentId, order}` | re-parents and reorders | `move` back |
| `addEdge` | `{edge}` | appends an edge; source and target must exist, duplicate id throws | `removeEdge` |
| `updateEdge` | `{id, data}` | shallow-merges edge fields | `updateEdge` |
| `removeEdge` | `{id}` | removes the edge | `addEdge` |
| `setProfile` | `{profile}` | sets `doc.profile` | `setProfile` |
| `restore` | `{node, edges}` | re-adds a removed node with its edges (used by inverses) | `remove` |

```json
{ "ops": [
  { "op": "add", "node": { "id": "step_x", "kind": "step", "parentId": "phase_1", "order": 3, "title": "Verify", "instruction": "the fix locally." } },
  { "op": "addEdge", "edge": { "id": "e_x", "kind": "next", "source": "step_2", "target": "step_x" } }
] }
```

`sortDoc(doc)` orders nodes by (`parentId`, `order`, `id`) and edges by `id` for deterministic saves.

## 17. Decompiler

`decompile({ files, binaryFiles?, dirName?, deterministicIds? })` requires `files['SKILL.md']` and returns `{ file: SkillFile, report: FidelityReport }`. Every node gets `provenance: 'import'`; the doc profile is `claude-code`; the layout is empty.

| Signal | Produces | Confidence |
|---|---|---|
| YAML frontmatter | `entry`: `name` (else `dirName`, else `skill`), `description`, `license`, `compatibility`, `metadata`, `allowed-tools` to `allowedToolsRaw` (arrays joined with `, `), every other key to `claudeCode` (typed name when known, else verbatim), `frontmatterOrder`; `overview: none`, `referenceIndex: none` | 1 |
| leading H1, then paragraphs | `entry.title`, `entry.summary` | 1 |
| any heading | `phase` nested by depth, `headingDepth` = depth, `stepStyle: numbered` | 1 |
| list where every item is a task item with one paragraph | `checklist` (`style: task`); variant `verification` under `verif\|checklist\|check\|before shipping\|done when`, `red-flags` under `red flag`, else `custom` | 1 |
| any ordered list | one `step` per item: a leading `**bold**` becomes `title`, the rest `instruction`; items chained with `next` edges | 1 |
| simple bullet list under a `red flag` heading, not all bold-led | `checklist` (`red-flags`, `style: bullet`) | 1 |
| simple bullet list, every item bold-led, under `anti-pattern\|guideline\|principle\|rule\|do not\|don't\|avoid\|never\|always\|tone\|philosophy\|pitfall\|gotcha\|constraint\|red flag` | one `guardrail` per item; `dont` when the item starts with don't / do not / never / avoid / no / stop, else `do` | 1 |
| bullet list, every item bold-led, under `how it works\|process\|workflow\|steps\|phase\|procedure\|instructions\|approach\|usage` | steps with `listStyle: bulleted` | 0.7 (guessed) |
| fenced code under `output\|template\|report\|format\|structure\|deliverable` | `output_format` (`template`, `format` = fence language) | 0.8 (guessed) |
| table with a `Category` column and a `Prefix` column | `catalog` with the verbatim `table`; `categories` with `id = slugify(name)`, prefix without backticks, `impact` from an `impact\|priority\|severity` column that is not literally `Priority` | 1 |
| anything else | `raw_markdown`; consecutive unrecognized blocks in the same section merge into one node | raw |
| every other file (dotfiles and `SKILL.graph.json` excluded) | `script` (`scripts/` prefix or `.sh .bash .zsh .py .js .mjs .cjs .ts .rb .pl .ps1`), `reference` (`.md .markdown .txt .mdx`; `inline: never`; `categoryId` from the catalog prefix), else `asset` (`base64` when binary); `order` from 1000 upward | |

Mentions: tokens containing `.` or `/` inside inline code, fenced code, link URLs and plain text are stripped of surrounding quotes, backticks, parentheses and punctuation, then resolved against the file inventory, exactly or by suffix (`.../<path>`, recorded in `nonRelativeMentions`). The host is the structured node containing the mention, or the enclosing phase for raw blocks (the entry before the first heading). One edge per (host, file): `runs` for scripts, `reads` otherwise, always `mentioned: true`.

Fidelity fields preserved for byte-exact re-emission: `step.spread`, `step.listSpread`, `step.listStyle`, `step.listStart` (set on the first step of each list), `guardrail.spread`, `guardrail.listSpread`, `checklist.spread`, `phase.headingDepth`, `entry.frontmatterOrder`, `entry.allowedToolsRaw`, `catalog.table`, and `edge.mentioned`.

`FidelityReport`: `recognized` and `raw` (characters captured by structured nodes versus kept verbatim), `coverage = recognized / (recognized + raw)`, `items[{ section, kind: 'raw' | 'guessed', confidence, reason, nodeId }]`, `nonRelativeMentions`. `skillgraph import` prints the coverage percentage and the raw block count, or the whole report with `--json`. An AI fallback that proposes structure for raw chunks is roadmap.

## 18. Round trip

Guarantee, tested in `packages/core/test/roundtrip.test.ts` over `fixtures/*` and over every skill in `~/.claude/skills` when that folder exists:

```
compile(decompile(md)).skillMd === normalizeMd(md)
```

`normalizeMd` parses the document and re-serializes it with the frozen options, re-serializing the frontmatter through the same YAML printer the compiler uses. Every other text file survives byte for byte (a trailing newline is guaranteed), and compiling the decompiled graph is a fixed point: `compile(decompile(compile(decompile(md)))) === compile(decompile(md))`. The compiler is also idempotent (`compile(g) === compile(g)`) and layout-independent.

Drift detection: `compile` compares each file listed in `compiled.files` with its hash and refuses to overwrite hand-edited files (exit 3) unless `--force`; `import --force` re-derives the graph from the edited files instead.

## 19. Lint rules

`lint(doc, { dirName?, compiled? })` returns `{ diagnostics, errors, warnings, infos }` with `Diagnostic = { rule, severity, message, nodeId?, edgeId? }`. Compiler diagnostics are merged in. Severity is `error` for spec violations, `warning` or `info` for best practice. Where the profile matters it is noted.

| Rule | Severity | Checks |
|---|---|---|
| `spec/name-format` | error | `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 chars |
| `spec/name-matches-dir` | error | `name` equals the folder name (when `dirName` is given) |
| `spec/description-length` | error / info | compiled description empty or over 1024 chars; info when description plus `when_to_use` exceed 1536 |
| `spec/description-angle-brackets` | error (universal) / warning | `<` or `>` in the description; claude.ai packaging rejects it |
| `spec/compat-length` | error | `compatibility` over 500 chars |
| `spec/metadata-string-map` | error (universal) / warning | a `metadata` value that is not a string |
| `spec/unknown-frontmatter` | error (universal) / info | any `claudeCode` key under universal; an unknown passthrough key under claude-code |
| `spec/allowed-tools-format` | warning | universal: imported `allowed-tools` contains a comma |
| `body/max-lines` | error / warning | SKILL.md over the line budget; warning from 80 percent of it |
| `body/token-budget` | warning | estimated tokens over the budget |
| `body/file-ref-exists` | error | SKILL.md mentions a `references/ scripts/ assets/ rules/ templates/` path that is not emitted |
| `body/file-ref-relative` | error | `../` in SKILL.md, or backslash / drive-letter paths |
| `body/heading-depth` | warning | a heading at H5 or deeper |
| `body/duplicate-file-path` | error | two file nodes emit the same path (compiler) |
| `graph/duplicate-id` | error | duplicate node id (compiler) |
| `graph/multiple-entries` | error | more than one entry node (compiler) |
| `graph/missing-parent` | error | `parentId` points to an unknown node (compiler) |
| `graph/dangling-edge` | error | edge or branch to a missing node (compiler) |
| `graph/cycle-outside-loop` | error | `next`/`branch` cycle outside a loop container (compiler) |
| `graph/decision-branches` | error | a decision with fewer than two `branch` edges (compiler) |
| `graph/unknown-node-kind` | error | node kind not in the schema (compiler and lint) |
| `graph/unreachable-node` | info | a flow node with no `next`/`branch` edge in a container where siblings have them (skips phases and imported nodes) |
| `graph/orphan-reference` | warning | a reference that is not mentioned, not inlined, not indexed (`referenceIndex` is `none` and no catalog category) and not a URL |
| `graph/orphan-script` | warning | a script no `runs` edge targets |
| `graph/loop-needs-until` | warning | empty `until` |
| `graph/procedure-in-markdown` | warning | a procedure hiding inside one node's markdown, as `unpackShape` detects it (section 20): any `raw_markdown` holding prose, a list or a heading, a non-imported `step` embedding three or more sub-steps, an AI-written `reference` whose body is mostly a procedure. Imported references are not flagged: files on disk are progressive disclosure |
| `graph/reference-needs-read-when` | info | non-inlined, non-imported reference without `readWhen` |
| `graph/script-needs-run-when` | info | non-imported script without `runWhen` |
| `profile/inject-requires-claude-code` | error | `inject` node under universal (compiler; node omitted) |
| `profile/dropped-fields` | warning | Claude Code frontmatter dropped under universal (compiler) |
| `profile/substitution-literal` | warning | universal: `$ARGUMENTS`, `${CLAUDE_*}` or `$0..$9` in SKILL.md |
| `profile/ask-user-in-background-fork` | warning | claude-code: `ask_user` while `context: fork` and `background` is not `false` |
| `profile/script-not-preapproved` | info | claude-code: scripts exist, no `autoAllowScripts`, and no `Bash` in `allowed-tools` |
| `style/description-third-person` | warning | description starts with I, I'm, you, we or your |
| `style/description-has-when` | warning | no "use when / whenever / for", "when the user", "trigger", "applies when", "for tasks/requests/questions" or "should be used" |
| `style/description-has-triggers` | info | an `entry.triggers` phrase missing from the description |
| `style/description-pushy` | info | none of whenever, even if, make sure, always use, any time, regardless |
| `style/all-caps-must` | warning | more than two MUST / NEVER / ALWAYS in SKILL.md |
| `style/time-sensitive` | warning | before/after/until/as of/since plus a month or year, "the latest version", "currently the", "as of today" |
| `style/imperative-step` | info | a step starting with "you should", "the agent will", "it is important", "claude should", "the model should" |
| `style/step-has-why` | info | non-imported step with an instruction over 200 chars and no `why` |
| `style/inline-reference-too-long` | warning | inlined reference body over 40 lines |
| `disclosure/reference-needs-toc` | info | file reference over 300 lines without a contents / table of contents / index heading |

Roadmap (in the plan, not implemented): `body/file-ref-depth` (reference-to-reference chains), `evals/trigger-set-size`, `external/skills-ref` (`skills-ref validate` exit code).

## 20. Unpack

The canvas is the point of the tool, so a procedure must not hide inside one node's markdown: a `raw_markdown` body, a `references/*.md` that is really the workflow, or a step whose instruction embeds a numbered list. `packages/core/src/unpack` turns such a node into the nodes it should have been, deterministically (no model): the decompiler's recognizers, in a permissive mode where every list becomes nodes.

`measureMarkdown(text)` returns `{ blocks, paragraphs, items, stepItems, headings, share }`: top-level blocks and paragraphs, list items, items that read as steps (every item of an ordered list, or of a bullet list whose items all open with a bold lead; task lists do not count), headings, and the share of the text taken by step-like lists.

`unpackShape(node)` returns that shape when the node is worth unpacking, else `null`:

| Kind | Unpackable when |
|---|---|
| `raw_markdown` | any paragraph (each becomes a step with `prose: true`, so the text compiles back unchanged even when the same phase also holds a numbered list), two or more list items, or a heading. A lone code block or table stays raw |
| `reference` | `source: inline` and a body with three or more step-like items making up at least half of it |
| `step` | an instruction embedding three or more step-like items |

`unpackNode(doc, nodeId, { id? })` returns a `GraphPatch` (never applied for you). Inside the fragment: a heading becomes a `phase` nested by depth (leading prose becomes its `intro`; steps from one list are chained with `next` edges inside such a phase); an ordered list, or any bullet list, becomes one `step` per item (bold lead to `title`, `listStyle: bulleted` on the first step of a bullet list); a task list becomes a `checklist` (`verification` under a verify-like heading, `red-flags` under a red-flag heading); bold-led bullets under a rules-like heading become `guardrail`s; a paragraph becomes a `step` with `prose: true`; code, tables and quotes ride along with the step they follow, or stay in a small `raw_markdown` so nothing is lost. Provenance is inherited from the source node.

Placement depends on the kind:

| Kind | Where the nodes go | What happens to the node |
|---|---|---|
| `raw_markdown` | its own slot; later siblings shift; when the container uses `next` edges, the incoming and outgoing edges are rewired through the new nodes | removed |
| `step` | right after the step, as siblings; its outgoing `next` edge (or the container's use of edges) chains the host through the new steps | keeps its title and non-list text; removed when it held nothing but the list |
| `reference` | right after the step that `reads` it; with no reader, a new root phase named after the file (an enclosing H1 is used as that phase) | removed, with its `reads` edges |

Edges the removal would otherwise drop are carried to the first flow node of the run: the `reads` and `runs` edges naming the files the node used, the `attaches` edges of its guardrails and examples, and the incoming `branch` edge of a decision that reached it (label and `isDefault` preserved, and no `next` edge is then chained into the run as well). Incoming `reads`/`runs` are deliberately not carried, since those name the node as a file and the reference case dissolves that file on purpose.

`unpackNodes(doc, ids)` folds several unpacks into one patch. `unpackableNodes(doc)` lists every candidate.

Where it runs: `@skillgraph/ai` appends the unpack ops to every proposal it validates (`toProposalPatch(doc, patch, { unpack })`: interview and from-transcript dissolve raw markdown, procedural references and embedded sub-steps; copilot, critique and the decompile fallback dissolve raw markdown and embedded sub-steps but keep references); the editor's inspector offers "Unpack into nodes" on any unpackable node and the Import panel unpacks leftover raw markdown without a model; the MCP server exposes it as `graph_unpack`; `graph/procedure-in-markdown` flags what is left. A failed unpack inside `toProposalPatch` falls back to the plain validated patch rather than rejecting the model's turn, and both editor entry points report a rejected patch inline instead of replacing the editor with an error page.
