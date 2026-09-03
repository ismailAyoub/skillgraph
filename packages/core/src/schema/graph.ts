import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

export const ProfileSchema = z.enum(['universal', 'claude-code']);
export type Profile = z.infer<typeof ProfileSchema>;

export const NODE_KINDS = [
  'entry',
  'phase',
  'step',
  'decision',
  'loop',
  'ask_user',
  'reference',
  'catalog',
  'script',
  'asset',
  'output_format',
  'guardrail',
  'example',
  'checklist',
  'delegate',
  'skill_call',
  'inject',
  'raw_markdown',
  'note',
] as const;
export const NodeKindSchema = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** Kinds that participate in the execution flow of a container. */
export const FLOW_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'phase',
  'step',
  'decision',
  'loop',
  'ask_user',
  'delegate',
  'skill_call',
  'inject',
  'raw_markdown',
  'output_format',
  'catalog',
  'checklist',
  'example',
  'guardrail',
]);
/** Kinds that can contain children (via `parentId`). */
export const CONTAINER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(['phase', 'loop']);
/** Kinds that emit a file into the skill folder. */
export const FILE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'reference',
  'script',
  'asset',
]);

const Provenance = z.enum(['user', 'import', 'ai']);

const NodeBase = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable().default(null),
  order: z.number().int().default(0),
  title: z.string().optional(),
  slug: z.string().optional(),
  provenance: Provenance.default('user'),
  /** Replace any compiler-generated sentence by key (see compiler docs for keys). */
  overrides: z.record(z.string(), z.string()).optional(),
});

/** Claude Code frontmatter extensions. Known keys are typed; unknown keys pass through verbatim. */
export const ClaudeCodeFields = z
  .object({
    argumentHint: z.string().optional(),
    arguments: z.array(z.string()).optional(),
    whenToUse: z.string().optional(),
    disableModelInvocation: z.boolean().optional(),
    userInvocable: z.boolean().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    context: z.string().optional(),
    agent: z.string().optional(),
    background: z.boolean().optional(),
    hidden: z.boolean().optional(),
    disallowedTools: z.array(z.string()).optional(),
    maxTurns: z.number().int().optional(),
    memory: z.string().optional(),
    isolation: z.string().optional(),
    skills: z.array(z.string()).optional(),
    hooks: z.unknown().optional(),
    paths: z.array(z.string()).optional(),
    shell: z.string().optional(),
  })
  .passthrough();
export type ClaudeCodeFieldsT = z.infer<typeof ClaudeCodeFields>;

export const BudgetSchema = z.object({
  lines: z.number().int().positive().default(500),
  tokens: z.number().int().positive().default(5000),
  autoSpill: z.boolean().default(false),
});

export const EntryNode = NodeBase.extend({
  kind: z.literal('entry'),
  name: z.string(),
  description: z.string(),
  /** Markdown paragraphs that follow the H1. */
  summary: z.string().optional(),
  triggers: z.array(z.string()).default([]),
  negativeTriggers: z.array(z.string()).default([]),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  allowedTools: z.array(z.string()).default([]),
  /** Verbatim `allowed-tools` string from an import; used as-is when no tools are derived. */
  allowedToolsRaw: z.string().optional(),
  /** Claude Code profile: add `Bash(${CLAUDE_SKILL_DIR}/scripts/x *)` for every script node. */
  autoAllowScripts: z.boolean().optional(),
  claudeCode: ClaudeCodeFields.optional(),
  /** Original frontmatter key order (imports); compiler falls back to a fixed order. */
  frontmatterOrder: z.array(z.string()).optional(),
  overview: z.enum(['auto', 'none']).default('none'),
  usage: z.string().optional(),
  referenceIndex: z.enum(['unmentioned', 'all', 'none']).default('unmentioned'),
  budget: BudgetSchema.optional(),
});

export const PhaseNode = NodeBase.extend({
  kind: z.literal('phase'),
  title: z.string(),
  summary: z.string().optional(),
  intro: z.string().optional(),
  stepStyle: z.enum(['numbered', 'bulleted', 'prose']).default('numbered'),
  /** Explicit heading depth (imports); defaults to nesting depth + 1. */
  headingDepth: z.number().int().min(1).max(6).optional(),
});

export const StepNode = NodeBase.extend({
  kind: z.literal('step'),
  /** Markdown. May contain several paragraphs and nested lists. */
  instruction: z.string().default(''),
  why: z.string().optional(),
  detail: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  mentionTools: z.boolean().optional(),
  /**
   * Render as paragraphs instead of a list item, whatever the phase's `stepStyle`. Set by
   * `unpackNode` on steps that came from prose, so a phase can mix paragraphs and a numbered
   * list and still compile back to its original text. `false` opts out of a prose phase.
   */
  prose: z.boolean().optional(),
  /** List fidelity (imports): loose item, loose list, marker style and start number of the run this step opens. */
  spread: z.boolean().optional(),
  listSpread: z.boolean().optional(),
  listStyle: z.enum(['numbered', 'bulleted']).optional(),
  listStart: z.number().int().optional(),
});

export const DecisionNode = NodeBase.extend({
  kind: z.literal('decision'),
  question: z.string().default(''),
  intro: z.string().optional(),
});

export const LoopNode = NodeBase.extend({
  kind: z.literal('loop'),
  until: z.string().default(''),
  maxIterations: z.number().int().positive().optional(),
  intro: z.string().optional(),
  why: z.string().optional(),
});

export const AskUserNode = NodeBase.extend({
  kind: z.literal('ask_user'),
  question: z.string().default(''),
  options: z.array(z.string()).optional(),
  blocking: z.boolean().default(true),
  why: z.string().optional(),
});

export const ReferenceNode = NodeBase.extend({
  kind: z.literal('reference'),
  /** Relative path inside the skill folder, e.g. `references/forms.md`. */
  path: z.string(),
  source: z.enum(['inline', 'url', 'external']).default('inline'),
  body: z.string().optional(),
  url: z.string().optional(),
  summary: z.string().optional(),
  readWhen: z.string().optional(),
  inline: z.enum(['auto', 'always', 'never']).default('never'),
  categoryId: z.string().optional(),
});

export const CatalogCategory = z.object({
  id: z.string(),
  name: z.string(),
  impact: z.string().optional(),
  prefix: z.string(),
  description: z.string().optional(),
});

export const CatalogNode = NodeBase.extend({
  kind: z.literal('catalog'),
  /** Verbatim table cells (markdown), preserved on import. */
  table: z
    .object({
      header: z.array(z.string()),
      rows: z.array(z.array(z.string())),
      align: z.array(z.enum(['left', 'right', 'center']).nullable()).optional(),
    })
    .optional(),
  categories: z.array(CatalogCategory).default([]),
  quickReference: z.enum(['auto', 'none']).default('none'),
  intro: z.string().optional(),
});

export const ScriptNode = NodeBase.extend({
  kind: z.literal('script'),
  path: z.string(),
  language: z.string().optional(),
  code: z.string().default(''),
  args: z.array(z.string()).optional(),
  runWhen: z.string().optional(),
  outputs: z.string().optional(),
  usage: z.string().optional(),
});

export const AssetNode = NodeBase.extend({
  kind: z.literal('asset'),
  path: z.string(),
  content: z.string().optional(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  usedFor: z.string().optional(),
});

export const OutputFormatNode = NodeBase.extend({
  kind: z.literal('output_format'),
  template: z.string().default(''),
  format: z.string().optional(),
  strictness: z.enum(['exact', 'guide']).optional(),
  destination: z.string().optional(),
  intro: z.string().optional(),
});

export const GuardrailNode = NodeBase.extend({
  kind: z.literal('guardrail'),
  polarity: z.enum(['do', 'dont']).default('dont'),
  /** Bold lead sentence, e.g. "Don't generate 20+ ideas." */
  text: z.string().default(''),
  why: z.string().optional(),
  spread: z.boolean().optional(),
  listSpread: z.boolean().optional(),
});

export const ExampleNode = NodeBase.extend({
  kind: z.literal('example'),
  label: z.string().optional(),
  input: z.string().default(''),
  output: z.string().default(''),
  commentary: z.string().optional(),
});

export const ChecklistItem = z.object({
  text: z.string(),
  why: z.string().optional(),
  checked: z.boolean().optional(),
});

export const ChecklistNode = NodeBase.extend({
  kind: z.literal('checklist'),
  variant: z.enum(['verification', 'red-flags', 'custom']).default('custom'),
  style: z.enum(['task', 'bullet']).default('task'),
  items: z.array(ChecklistItem).default([]),
  spread: z.boolean().optional(),
});

export const DelegateNode = NodeBase.extend({
  kind: z.literal('delegate'),
  agentType: z.string().optional(),
  task: z.string().default(''),
  parallel: z.boolean().optional(),
  returns: z.string().optional(),
});

export const SkillCallNode = NodeBase.extend({
  kind: z.literal('skill_call'),
  skill: z.string().default(''),
  args: z.string().optional(),
  when: z.string().optional(),
});

export const InjectNode = NodeBase.extend({
  kind: z.literal('inject'),
  command: z.string().default(''),
  label: z.string().optional(),
  multiline: z.boolean().optional(),
});

export const RawMarkdownNode = NodeBase.extend({
  kind: z.literal('raw_markdown'),
  body: z.string().default(''),
});

export const NoteNode = NodeBase.extend({
  kind: z.literal('note'),
  body: z.string().default(''),
});

export const KnownNode = z.discriminatedUnion('kind', [
  EntryNode,
  PhaseNode,
  StepNode,
  DecisionNode,
  LoopNode,
  AskUserNode,
  ReferenceNode,
  CatalogNode,
  ScriptNode,
  AssetNode,
  OutputFormatNode,
  GuardrailNode,
  ExampleNode,
  ChecklistNode,
  DelegateNode,
  SkillCallNode,
  InjectNode,
  RawMarkdownNode,
  NoteNode,
]);

/** Forward-compatible catch-all: preserved verbatim, flagged by lint. */
export const UnknownNode = NodeBase.extend({ kind: z.string() }).passthrough();

export const NodeSchema = z.union([KnownNode, UnknownNode]);

export const EDGE_KINDS = ['next', 'branch', 'reads', 'runs', 'attaches'] as const;
export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const EdgeSchema = z.object({
  id: z.string().min(1),
  kind: EdgeKindSchema,
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
  order: z.number().optional(),
  /** The host text already mentions this file; compiler must not append a sentence. */
  mentioned: z.boolean().optional(),
});

export const SkillDocSchema = z.object({
  profile: ProfileSchema.default('claude-code'),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export const LayoutSchema = z.object({
  nodes: z
    .record(
      z.string(),
      z.object({
        x: z.number(),
        y: z.number(),
        w: z.number().optional(),
        h: z.number().optional(),
        collapsed: z.boolean().optional(),
      }),
    )
    .default({}),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .default({ x: 0, y: 0, zoom: 1 }),
});

export const CompiledInfoSchema = z.object({
  profile: ProfileSchema,
  at: z.string(),
  files: z.record(z.string(), z.string()),
});

export const SkillFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  doc: SkillDocSchema,
  layout: LayoutSchema.default({ nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } }),
  compiled: CompiledInfoSchema.optional(),
});

export type EntryNodeT = z.infer<typeof EntryNode>;
export type PhaseNodeT = z.infer<typeof PhaseNode>;
export type StepNodeT = z.infer<typeof StepNode>;
export type DecisionNodeT = z.infer<typeof DecisionNode>;
export type LoopNodeT = z.infer<typeof LoopNode>;
export type AskUserNodeT = z.infer<typeof AskUserNode>;
export type ReferenceNodeT = z.infer<typeof ReferenceNode>;
export type CatalogNodeT = z.infer<typeof CatalogNode>;
export type ScriptNodeT = z.infer<typeof ScriptNode>;
export type AssetNodeT = z.infer<typeof AssetNode>;
export type OutputFormatNodeT = z.infer<typeof OutputFormatNode>;
export type GuardrailNodeT = z.infer<typeof GuardrailNode>;
export type ExampleNodeT = z.infer<typeof ExampleNode>;
export type ChecklistNodeT = z.infer<typeof ChecklistNode>;
export type DelegateNodeT = z.infer<typeof DelegateNode>;
export type SkillCallNodeT = z.infer<typeof SkillCallNode>;
export type InjectNodeT = z.infer<typeof InjectNode>;
export type RawMarkdownNodeT = z.infer<typeof RawMarkdownNode>;
export type NoteNodeT = z.infer<typeof NoteNode>;
export type KnownNodeT = z.infer<typeof KnownNode>;
export type UnknownNodeT = z.infer<typeof UnknownNode>;
export type SkillNode = KnownNodeT | UnknownNodeT;
export type SkillEdge = z.infer<typeof EdgeSchema>;
export type SkillDoc = z.infer<typeof SkillDocSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type SkillFile = z.infer<typeof SkillFileSchema>;
export type CompiledInfo = z.infer<typeof CompiledInfoSchema>;

export function isKnownNode(node: SkillNode): node is KnownNodeT {
  return (NODE_KINDS as readonly string[]).includes(node.kind);
}

/** Input types (before defaults are applied) for building docs in code. */
export type SkillNodeInput = z.input<typeof KnownNode>;
export type SkillEdgeInput = z.input<typeof EdgeSchema>;
export type SkillDocInput = z.input<typeof SkillDocSchema>;
export type SkillFileInput = z.input<typeof SkillFileSchema>;

export function parseDoc(input: unknown): SkillDoc {
  return SkillDocSchema.parse(input);
}

export function parseSkillFile(input: unknown): SkillFile {
  return SkillFileSchema.parse(input);
}

export function emptyDoc(
  name: string,
  description: string,
  profile: Profile = 'claude-code',
): SkillDoc {
  return SkillDocSchema.parse({
    profile,
    nodes: [{ id: 'entry_root', kind: 'entry', name, description, order: 0 }],
    edges: [],
  });
}

export function emptySkillFile(name: string, description: string): SkillFile {
  return SkillFileSchema.parse({ schemaVersion: SCHEMA_VERSION, doc: emptyDoc(name, description) });
}
