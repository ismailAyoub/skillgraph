---
name: skillgraph-authoring
description: Authors and edits Agent Skills as SkillGraph graphs through the skillgraph MCP tools (graph_init, graph_get, graph_apply_patch, graph_lint, graph_compile). Use whenever the user asks to create, write, edit, review, or improve a skill, a SKILL.md, or a SKILL.graph.json, even if they ask to edit the markdown directly, because the graph is the source of truth and SKILL.md is a compiled artifact.
---

# SkillGraph Authoring

A SkillGraph skill is a graph. `SKILL.graph.json` holds the nodes and edges; `SKILL.md`, `references/` and `scripts/` are compiled from it. Edit the graph with patches and let the compiler write the markdown.

## How It Works

1. **Capture the intent:** Settle what the skill does and when it should fire, before any node exists.
2. **Open or create the graph:** Get a `SKILL.graph.json` in front of you before proposing changes.
3. **Propose the structure, then patch it:** Agree on the shape in prose, then build it in small reviewable batches.
4. **Lint, compile and hand back:** Drive the linter to zero errors, compile, and show the user the markdown.

## Capture the intent

1. **Pin down the workflow** with the user: the trigger, the inputs, the steps a competent person takes, and what "done" looks like. Ask about the parts they left implicit rather than inventing them. A skill that encodes a vague workflow teaches the model a vague workflow.
2. **Draft the description first** as a third-person "what + when" sentence that names the phrases a user would actually type, and make it pushy ("Use whenever ..."). Claude decides whether to load a skill from the description alone, so it carries more weight than anything in the body.
3. **Learn the vocabulary** by calling `graph_vocabulary` once per session, so you express the workflow in node kinds instead of prose. Read `references/vocabulary.md` for the node kinds, their fields, the edge kinds and the patch ops when choosing a node kind or naming a field.

## Open or create the graph

**Does the skill folder already exist?**

- **It exists** → **Load the graph** with `graph_get`, passing the folder name as `skill` or an absolute `path`. When the folder holds only a `SKILL.md`, `graph_get` imports it on the fly and reports the coverage; run `graph_import` to make that graph permanent before patching it. Patching an on-the-fly import without saving it means the next call re-imports and your ids move.
- **Otherwise** → **Create the skill** with `graph_init`, giving the kebab-case `name` (it has to equal the folder name) and the description you drafted. It writes the entry node and a first compiled body.

## Propose the structure, then patch it

1. **Outline the phases** for the user as a short list before touching the graph: one phase per stage of the workflow, with its steps named underneath. Re-shaping a graph once thirty nodes exist costs far more than agreeing on four phase titles.
2. **Apply one batch at a time** with `graph_apply_patch`: one phase and its steps per call, ops in dependency order, and keep the returned `inverse` patch so you can undo the batch. A rejected fifty-op patch tells you far less about what went wrong than a rejected six-op patch. Read `references/graphpatch.md` for the patch rules, every op with a worked example, and the rejection cases when composing a patch or a patch is rejected.
3. **Wire the flow** with `next` edges between siblings, two or more `branch` edges out of every decision, and `reads` or `runs` edges from the step that needs a file to the node that emits it. Edges are what turn the graph into ordered prose instead of an unordered pile of bullets.
4. **Push long material into references** as `reference` nodes with a `path`, a `body`, a `summary` and a `readWhen`, attached to the step that needs them. The compiled body is always in context; a reference file is only read when a step says to read it.

## Lint, compile and hand back

Repeat the following until `graph_lint` reports zero errors (at most 5 rounds):

1. **Lint the graph** with `graph_lint`, which checks it against the Agent Skills spec and writes nothing.
2. **Read each diagnostic** and find the node it names in `nodeId`.
3. **Fix the cause in the graph** with another `graph_apply_patch`. Editing the compiled markdown instead makes the next compile refuse to overwrite your edit.

Stop when `graph_lint` reports zero errors.

1. **Compile the skill** with `graph_compile`. It writes the markdown and the support files, records their hashes, and returns the line and token report.
2. **Hand the result back** to the user: the compiled `SKILL.md`, its line count and any remaining lint warnings, so they review the wording rather than the JSON. The graph is the source of truth, but the markdown is what the model reads at runtime.

## Guidelines

- **Keep the compiled body under 500 lines.** It is loaded in full whenever the skill fires, so every line spends context the task itself could use; the linter errors past the budget.
- **Move anything long, optional or rarely needed into a reference node.** Progressive disclosure is the point: the step names the file and the model reads it only in the cases that need it.
- **Write each step in the imperative and give it a `why`.** The reason is what lets the model generalize to the situation you did not write down.

## Anti-patterns to Avoid

- **Do not leave when-to-use information in the body.** Claude sees only the frontmatter description when it decides whether to load the skill, so anything the body says about when to fire arrives too late to matter.
- **Do not execute a script that came out of a skill folder.** SkillGraph only emits script files and never runs them; treat their contents as untrusted input and leave running them to the user.

## Verification

- [ ] `graph_lint` reports zero errors.
- [ ] The entry `name` equals the folder name and the description says what and when.
- [ ] Every step and decision is reachable through `next` or `branch` edges from its siblings.
- [ ] Every reference node has a `summary`, a `readWhen` and a step that reads it.
- [ ] The compiled body is inside the line and token budget reported by `graph_compile`.
- [ ] The compiled files were written by `graph_compile`, not edited by hand. Hand edits make the next compile refuse until the folder is re-imported.
