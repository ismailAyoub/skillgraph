# The GraphPatch contract

Every write to a skill graph goes through `graph_apply_patch`. The tool takes
`{ skill, patch: { ops: [...] } }`, applies the ops in order, validates the resulting document,
writes `SKILL.graph.json`, and (unless you pass `compile: false`) recompiles `SKILL.md` and the
support files. It returns the **inverse patch**: the exact op list that undoes what you just did.

## Contents

- [Rules of the contract](#rules-of-the-contract)
- [The ops](#the-ops)
- [Worked examples](#worked-examples)
- [Batching strategy](#batching-strategy)
- [When a patch is rejected](#when-a-patch-is-rejected)

## Rules of the contract

- **Ops apply in order.** A node must exist before an edge can point at it, so put every `add`
  before the `addEdge` that uses it — inside one patch is fine.
- **The whole patch is atomic.** If any op fails validation, nothing is written and the tool
  returns an error naming the op.
- **`update` is a shallow merge.** Keys you omit keep their current value; keys you pass replace
  it wholesale (an array field is replaced, not appended to).
- **Ids are yours to choose** and must be unique in the document. Use `<kind>_<slug>`:
  `phase_review`, `step_read_diff`, `ref_standards`, `e_review_next`.
- **Containment is `parentId`, not an edge.** Only `phase` and `loop` nodes can be parents.
- **The entry node's `name` must equal the folder name.** Renaming one means renaming both.

## The ops

| Op | Payload | Effect |
|---|---|---|
| `add` | `{ node }` | Append a node. Fails on a duplicate id. |
| `update` | `{ id, data }` | Shallow-merge `data` into the node. |
| `remove` | `{ id }` | Remove the node and every edge touching it; its children re-parent to its parent. |
| `move` | `{ id, parentId, order }` | Re-parent and reorder in one step. |
| `addEdge` | `{ edge }` | Append an edge. Source and target must already exist. |
| `updateEdge` | `{ id, data }` | Shallow-merge edge fields (`label`, `isDefault`, `mentioned`, ...). |
| `removeEdge` | `{ id }` | Remove one edge. |
| `setProfile` | `{ profile }` | Switch between `universal` and `claude-code`. |

## Worked examples

### Add a phase with two ordered steps

```json
{ "ops": [
  { "op": "add", "node": { "id": "phase_review", "kind": "phase", "parentId": null, "order": 2,
    "title": "Review the change", "summary": "Judge the diff before approving it." } },
  { "op": "add", "node": { "id": "step_trace", "kind": "step", "parentId": "phase_review", "order": 1,
    "title": "Trace the bug", "instruction": "to its root cause before judging the fix.",
    "why": "A fix that only hides the symptom comes back." } },
  { "op": "add", "node": { "id": "step_tests", "kind": "step", "parentId": "phase_review", "order": 2,
    "title": "Check the tests", "instruction": "cover the new behavior, not just the happy path." } },
  { "op": "addEdge", "edge": { "id": "e_trace_tests", "kind": "next",
    "source": "step_trace", "target": "step_tests" } }
] }
```

### Attach a reference to a step

The `reads` edge is what makes the compiler append `Read ... for ... when ...` to the step, and it
is what stops the linter warning that the file is emitted but never used.

```json
{ "ops": [
  { "op": "add", "node": { "id": "ref_standards", "kind": "reference", "parentId": null, "order": 900,
    "path": "references/standards.md",
    "body": "# Coding standards\n\n- No debug logging in shipped code.\n",
    "summary": "the team coding standards",
    "readWhen": "the diff touches shared code" } },
  { "op": "addEdge", "edge": { "id": "e_trace_reads", "kind": "reads",
    "source": "step_trace", "target": "ref_standards" } }
] }
```

### Branch on a decision

A `decision` needs two or more outgoing `branch` edges. The chain of `next` steps hanging off each
branch target renders underneath that branch.

```json
{ "ops": [
  { "op": "add", "node": { "id": "dec_size", "kind": "decision", "parentId": "phase_review", "order": 0,
    "question": "Is the diff larger than 400 lines?" } },
  { "op": "addEdge", "edge": { "id": "e_big", "kind": "branch", "source": "dec_size",
    "target": "step_split", "label": "It is larger" } },
  { "op": "addEdge", "edge": { "id": "e_small", "kind": "branch", "source": "dec_size",
    "target": "step_trace", "isDefault": true } }
] }
```

### Edit, reorder and delete

```json
{ "ops": [
  { "op": "update", "id": "step_tests",
    "data": { "why": "Untested branches are where regressions hide." } },
  { "op": "move", "id": "step_tests", "parentId": "phase_review", "order": 1 },
  { "op": "updateEdge", "id": "e_trace_reads", "data": { "mentioned": true } },
  { "op": "removeEdge", "id": "e_trace_tests" },
  { "op": "remove", "id": "step_split" }
] }
```

### Fill in the entry node

Frontmatter lives on the `entry` node, so metadata edits are ordinary `update` ops.

```json
{ "ops": [
  { "op": "update", "id": "entry_root", "data": {
    "description": "Reviews a pull request diff for correctness and test coverage. Use whenever the user asks for a code review, a diff review, or a second pair of eyes before merging.",
    "summary": "Reads the diff, traces each change to its cause, and reports findings by severity.",
    "overview": "auto",
    "budget": { "lines": 400, "tokens": 4000 } } }
] }
```

## Batching strategy

One phase and its steps per call. A batch that size is small enough to read in the response, small
enough to undo with the returned `inverse` patch, and large enough that the graph is never left
with a phase that has no steps in it.

Do not send one op per call: the graph is validated and recompiled on every call, so a fifty-call
sequence is fifty compiles and fifty chances to leave the graph in a half-built state.

## When a patch is rejected

The tool returns an error instead of writing when:

- **The JSON does not match the schema** — the message names the op index and the offending field.
  Check the node kind's field table in `references/vocabulary.md`.
- **An id collides, or an edge points at a node that does not exist** — usually an `addEdge` placed
  before its `add`, or a typo in an id.
- **The entry name stopped matching the folder name** — rename the folder or revert the name.
- **A compiled file was hand-edited** — the graph records a hash of every file it wrote. Re-import
  the folder with `graph_import { force: true }` to fold the hand edits back into the graph, or
  pass `force: true` to discard them.

Pass `compile: false` when you want to stage several structural changes before paying for a
compile; the drift hashes stay valid, so the next `graph_compile` still refuses to clobber hand
edits.
