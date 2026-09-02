# SkillGraph vocabulary

A skill is a graph: one `entry` node, flow nodes ordered inside containers, file nodes that emit
support files, and edges that sequence, branch, read, run or attach. The compiler turns the graph
into a spec-compliant `SKILL.md` plus `references/`, `scripts/` and `assets/`.

## Fields every node has

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | required | unique; convention `<kind>_<slug>` (`step_read_diff`, `phase_review`) |
| `kind` | string | required | one of the 19 kinds below |
| `parentId` | string or null | `null` | containment; only `phase` and `loop` can be parents |
| `order` | int | `0` | position among siblings; ties broken by `id` |
| `title` | string | | bold lead (steps) or heading text (phases) |
| `provenance` | `user` `import` `ai` | `user` | who authored the node |
| `overrides` | record | | replace a generated sentence by key (see the spec, section 13) |

Categories: flow kinds (phase, step, decision, loop, ask_user, delegate, skill_call, inject,
raw_markdown, output_format, catalog, checklist, example, guardrail) render in sequence inside
their container; containers (phase, loop) own children through `parentId`; file kinds
(reference, script, asset) emit a file and appear in the body only through `reads`/`runs`
edges; `entry` is the singleton root and `note` is canvas-only.

Root-section kinds (`output_format`, `example`, `guardrail`, `checklist`, `catalog`) with
`parentId: null` are collected into synthesized sections (`## Output`, `## Examples`,
`## Guidelines`, `## Anti-patterns to Avoid`, `## Verification`). Inside a phase they render in
place. List-item kinds (`step`, `ask_user`, `delegate`, `skill_call`, `inject`) become items of
the surrounding list; everything else renders as a block.

## Node kinds

### entry (exactly one, `id` conventionally `entry_root`)
`name` (must equal the folder name), `description` (what + when; pushy, third person),
`title` (H1), `summary` (paragraphs after the H1), `triggers[]`, `negativeTriggers[]` (appended
as `Do not use for a, b.`), `license`, `compatibility`, `metadata`, `allowedTools[]`,
`autoAllowScripts`, `claudeCode` (`argumentHint`, `context`, `model`, `disableModelInvocation`,
`userInvocable`, ...), `overview` (`auto` synthesizes `## How It Works` from root phases; default
`none`), `usage` (markdown under `## Usage`), `referenceIndex` (`unmentioned` default, `all`,
`none`), `budget` (`{lines: 500, tokens: 5000}`).

### phase (container, renders a heading)
`title` (required), `summary` (used by How It Works), `intro` (paragraphs under the heading),
`stepStyle` (`numbered` default, `bulleted`, `prose`). Root phases are H2; nested phases add a level.

### step (list item)
`instruction` (markdown; the title is prepended in bold, so write it as the continuation:
title `Read the diff` + instruction `with \`gh pr diff\`.`), `why` (trailing rationale sentence),
`detail[]` (nested bullets), `tools[]` + `mentionTools` (appends `Use X, Y.`).

### decision (block)
`question`, `intro`. Needs two or more outgoing `branch` edges; each branch's chain of `next`
steps renders under the bullet. Branches to a phase or loop render as `go to "Title"`.

### loop (container, no heading)
`until` (stop condition; required in practice), `maxIterations`, `intro`, `why`. Renders
`Repeat the following until <until> (at most N rounds):` then the children as a list.

### ask_user (list item)
`question`, `options[]`, `blocking` (default true), `why`. Adds the profile's tool sentence
(`Use the AskUserQuestion tool ...`).

### reference (file)
`path` (`references/<name>.md`), `body` (file content), `summary` (`for <summary>`),
`readWhen` (`when <readWhen>`), `source` (`inline` default, `url` + `url`, `external`),
`inline` (`never` default; `always` or `auto` <= 12 lines inlines the body into SKILL.md),
`categoryId`. Attach to a step with a `reads` edge to get
`Read \`references/x.md\` for <summary> when <readWhen>.`

### script (file)
`path` (`scripts/<name>.sh`), `language`, `code`, `args[]`, `runWhen` (`to <runWhen>`),
`usage` (emitted as a bash fence), `outputs`. Attach with a `runs` edge. Never executed by SkillGraph.

### asset (file)
`path`, `content`, `encoding` (`utf8` or `base64`), `usedFor`. Attach with a `reads` edge.

### catalog (block or root section)
`categories[{id, name, impact, prefix, description}]` generates a priority table; `table` keeps a
verbatim table; `quickReference: auto` lists member references per category; `intro`.

### output_format (block or `## Output`)
`template`, `format` (fence language), `strictness` (`exact` or `guide`), `destination`, `intro`.

### guardrail (bullet, or attached paragraph)
`polarity` (`do` -> Guidelines, `dont` -> Anti-patterns; default `dont`), `text` (bold lead), `why`.

### example (block or `## Examples`)
`label`, `input`, `output`, `commentary`.

### checklist (root section or block)
`variant` (`verification`, `red-flags`, `custom`), `style` (`task` or `bullet`),
`items[{text, why?, checked?}]`, `title`.

### delegate (list item)
`agentType`, `task`, `parallel`, `returns`. Renders `Spawn an <agentType> subagent with this task: ...`.

### skill_call (list item)
`skill`, `args`, `when`. Renders `Invoke \`/skill args\` when <when>.`

### inject (list item, Claude Code profile only)
`command`, `label`, `multiline`. Renders `label: !\`command\``. Never executed by SkillGraph.

### raw_markdown (block)
`body`: verbatim markdown escape hatch. Prefer structured kinds; the linter and canvas cannot see inside.

### note (canvas only)
`body`. Skipped by the compiler.

## Edges

`{ id, kind, source, target, label?, isDefault?, order?, mentioned? }`

| Kind | Source -> target | Effect |
|---|---|---|
| `next` | flow node -> flow node, same container | sequence order; inside a loop an edge to a lower `order` is the back-edge |
| `branch` | decision -> flow node | one labelled branch (`label`; `isDefault` renders `Otherwise`) |
| `reads` | flow node -> reference or asset | appends the Read/Fetch/Use sentence to the host |
| `runs` | flow node -> script | appends the Run sentence and the usage fence |
| `attaches` | guardrail or example -> step or ask_user | renders the source inside the host item |

Containment is `parentId`, not an edge. Give every step in a phase a `next` edge to its
successor; siblings without edges are flagged `graph/unreachable-node` once any sibling has one.
`mentioned: true` means the host text already names the file, so no sentence is appended.

## GraphPatch

`graph_apply_patch` takes `{ ops: PatchOp[] }`; ops apply in order, the result is validated, and
the inverse patch is returned for undo.

| Op | Payload | Effect |
|---|---|---|
| `add` | `{ node }` | append a node (duplicate id fails) |
| `update` | `{ id, data }` | shallow-merge `data` into the node; omitted keys are kept |
| `remove` | `{ id }` | remove the node and its edges; children re-parent to its parent |
| `move` | `{ id, parentId, order }` | re-parent and reorder |
| `addEdge` | `{ edge }` | append an edge (source and target must exist) |
| `updateEdge` | `{ id, data }` | shallow-merge edge fields |
| `removeEdge` | `{ id }` | remove an edge |
| `setProfile` | `{ profile }` | `universal` or `claude-code` |

```json
{ "ops": [
  { "op": "add", "node": { "id": "phase_review", "kind": "phase", "parentId": null, "order": 2,
    "title": "Review", "summary": "Judge the change." } },
  { "op": "add", "node": { "id": "step_trace", "kind": "step", "parentId": "phase_review", "order": 1,
    "title": "Trace the bug", "instruction": "to its root cause before judging the fix.",
    "why": "A fix that hides the symptom will come back." } },
  { "op": "add", "node": { "id": "step_tests", "kind": "step", "parentId": "phase_review", "order": 2,
    "title": "Check tests", "instruction": "cover the new behavior." } },
  { "op": "addEdge", "edge": { "id": "e_trace_tests", "kind": "next", "source": "step_trace", "target": "step_tests" } },
  { "op": "add", "node": { "id": "ref_standards", "kind": "reference", "parentId": null, "order": 900,
    "path": "references/standards.md", "body": "# Standards\n\n- No console.log in production.\n",
    "summary": "the team coding standards", "readWhen": "the diff touches shared code" } },
  { "op": "addEdge", "edge": { "id": "e_trace_reads", "kind": "reads", "source": "step_trace", "target": "ref_standards" } }
] }
```

Compiled: `1. **Trace the bug** to its root cause before judging the fix. A fix that hides the
symptom will come back. Read \`references/standards.md\` for the team coding standards when the diff
touches shared code.`
