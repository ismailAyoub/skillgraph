# skillgraph-authoring

A skill that teaches Claude Code how to author Agent Skills through the SkillGraph MCP server.

It is dogfooded: `SKILL.graph.json` is the source, and `SKILL.md` plus everything under
`references/` are build artifacts. Edit the graph, never the markdown, then recompile:

```bash
pnpm --filter skillgraph dev -- compile skills/skillgraph-authoring
pnpm --filter skillgraph dev -- lint skills/skillgraph-authoring
```

`references/vocabulary.md` is generated from `packages/cli/src/mcp/vocabulary.ts` (the same text the
`graph_vocabulary` tool and the `skillgraph://vocabulary` resource serve), so change it there and
copy it into the reference node's `body`. A test in `packages/cli/test/mcp.test.ts` fails if the two
drift apart or if the checked-in compiled files stop matching the graph.

## Installing the skill

Copy or symlink this folder into a skills directory Claude Code reads, for example
`~/.claude/skills/skillgraph-authoring` or `.claude/skills/skillgraph-authoring` in a project.

## Connecting the MCP server

The skill only pays off when the `skillgraph` MCP server is connected, since every step it
prescribes is a tool call. Add this to `.mcp.json` in the project (or to `~/.claude.json`) to run
the published CLI:

```json
{
  "mcpServers": {
    "skillgraph": {
      "command": "npx",
      "args": ["-y", "skillgraph", "mcp"]
    }
  }
}
```

This repository already ships a `.mcp.json` at its root that points at the workspace copy instead,
so a session started here gets the server straight from `packages/cli` with no install step.

Pass `--dir <skillsDir>` after `mcp` to serve a folder other than `~/.claude/skills`; the `skill`
argument of every tool names a sub-folder of it, and an absolute `path` argument overrides it.

## Tools it uses

| Tool | Purpose |
|---|---|
| `graph_vocabulary` | Node kinds, edge kinds and the GraphPatch ops. |
| `graph_init` | Create a new skill folder with an entry node. |
| `graph_get` | Load a graph, or import an existing `SKILL.md` on the fly. |
| `graph_import` | Persist the decompiled graph of an existing skill. |
| `graph_apply_patch` | Apply a GraphPatch, write the graph, compile and lint. |
| `graph_lint` | Check the graph against the Agent Skills spec. |
| `graph_compile` | Write `SKILL.md` and the support files, and record their hashes. |
| `skill_export` | Zip the compiled skill for upload. |
