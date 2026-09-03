import type {
  Code,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableRow,
} from 'mdast';
import { mdBlocks, mdInline, plainText, stringifyMarkdown, toYaml } from '../markdown/index';
import type {
  AskUserNodeT,
  CatalogNodeT,
  ChecklistNodeT,
  DecisionNodeT,
  DelegateNodeT,
  ExampleNodeT,
  GuardrailNodeT,
  InjectNodeT,
  LoopNodeT,
  OutputFormatNodeT,
  PhaseNodeT,
  ReferenceNodeT,
  ScriptNodeT,
  SkillCallNodeT,
  SkillDoc,
  SkillEdge,
  SkillNode,
  StepNodeT,
} from '../schema/graph';
import { isKnownNode } from '../schema/graph';
import { countLines, estimateTokens } from '../tokens/index';
import { type CompileOptions, type CompileResult, Ctx } from './context';
import { buildFrontmatter } from './frontmatter';
import { toMermaid } from './mermaid';

export type { CompileOptions, CompileReport, CompileResult, Diagnostic, Severity } from './context';
export { Ctx, normalizePath } from './context';
export {
  CLAUDE_CODE_KEYS,
  compiledDescription,
  FIELD_TO_YAML,
  SPEC_KEYS,
  YAML_TO_FIELD,
} from './frontmatter';
export { toMermaid } from './mermaid';

// ---------- mdast constructors ----------

const txt = (value: string): PhrasingContent => ({ type: 'text', value });
const strong = (children: PhrasingContent[]): PhrasingContent => ({ type: 'strong', children });
const code = (value: string): PhrasingContent => ({ type: 'inlineCode', value });
const para = (children: PhrasingContent[]): Paragraph => ({ type: 'paragraph', children });
const heading = (depth: number, children: PhrasingContent[]): Heading => ({
  type: 'heading',
  depth: Math.min(6, Math.max(1, depth)) as Heading['depth'],
  children,
});
const listItem = (
  children: RootContent[],
  spread = false,
  checked: boolean | null = null,
): ListItem => ({
  type: 'listItem',
  spread,
  checked,
  children: children as ListItem['children'],
});
const list = (ordered: boolean, items: ListItem[], spread = false, start?: number): List => ({
  type: 'list',
  ordered,
  start: ordered ? (start ?? 1) : null,
  spread,
  children: items,
});
const codeBlock = (lang: string | undefined, value: string): Code => ({
  type: 'code',
  lang: lang || null,
  meta: null,
  value,
});

const LIST_ITEM_KINDS = new Set(['step', 'ask_user', 'delegate', 'skill_call', 'inject']);
const ROOT_SECTION_KINDS = new Set([
  'output_format',
  'example',
  'guardrail',
  'checklist',
  'catalog',
]);

function startsWithPunct(s: string): boolean {
  return /^[.,:;!?)\]]/.test(s);
}

/** Prepend a bold lead to the first paragraph of a block list (creating one when needed). */
function withLead(blocks: RootContent[], lead: PhrasingContent[]): RootContent[] {
  const first = blocks[0];
  if (first && first.type === 'paragraph') {
    const rest = first.children;
    const needsSpace = rest.length > 0 && !startsWithPunct(plainText(rest));
    first.children = [...lead, ...(needsSpace ? [txt(' ')] : []), ...rest];
    return blocks;
  }
  return [para(lead), ...blocks];
}

function appendInline(blocks: RootContent[], extra: PhrasingContent[]): RootContent[] {
  const first = blocks[0];
  if (first && first.type === 'paragraph') {
    first.children = [...first.children, ...extra];
    return blocks;
  }
  return [para(extra), ...blocks];
}

// ---------- ordering ----------

export type Branch = { edge: SkillEdge; label: string; chain: SkillNode[]; pointer?: SkillNode };
export type FlowItem =
  | { type: 'node'; node: SkillNode }
  | { type: 'decision'; node: DecisionNodeT; branches: Branch[] };

function byOrder(a: SkillNode, b: SkillNode): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ordered flow items of a container, with decisions expanded into branches. */
export function sequence(ctx: Ctx, parentId: string | null): FlowItem[] {
  const kids = ctx.flowChildren(parentId);
  const ids = new Set(kids.map((k) => k.id));
  const container = parentId ? ctx.node(parentId) : undefined;
  const isLoop = container?.kind === 'loop';
  const orderOf = new Map(kids.map((k) => [k.id, k.order]));

  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const k of kids) {
    indeg.set(k.id, 0);
    succ.set(k.id, []);
  }
  for (const k of kids) {
    for (const e of ctx.edgesFrom(k.id)) {
      if (e.kind !== 'next' && e.kind !== 'branch') continue;
      if (!ids.has(e.target) || e.target === k.id) continue;
      if (isLoop && (orderOf.get(e.target) ?? 0) < (orderOf.get(k.id) ?? 0)) continue; // loop back-edge
      succ.get(k.id)?.push(e.target);
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    }
  }
  const ready = kids.filter((k) => indeg.get(k.id) === 0).sort(byOrder);
  const topo: SkillNode[] = [];
  const seen = new Set<string>();
  while (ready.length > 0) {
    const n = ready.shift() as SkillNode;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    topo.push(n);
    for (const t of succ.get(n.id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if (indeg.get(t) === 0) {
        ready.push(ctx.node(t) as SkillNode);
        ready.sort(byOrder);
      }
    }
  }
  if (topo.length < kids.length) {
    for (const k of kids) {
      if (!seen.has(k.id)) {
        ctx.diag(
          'graph/cycle-outside-loop',
          'error',
          'Flow edges form a cycle outside a loop',
          k.id,
        );
        topo.push(k);
        seen.add(k.id);
      }
    }
  }

  const topoIndex = new Map(topo.map((n, i) => [n.id, i]));
  const consumed = new Set<string>();
  const items: FlowItem[] = [];

  const reachable = (start: string): Set<string> => {
    const out = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop() as string;
      if (out.has(id) || !ids.has(id)) continue;
      out.add(id);
      for (const e of ctx.edgesFrom(id, 'next')) stack.push(e.target);
    }
    return out;
  };

  for (const n of topo) {
    if (consumed.has(n.id)) continue;
    if (n.kind !== 'decision') {
      items.push({ type: 'node', node: n });
      continue;
    }
    const branchEdges = ctx.edgesFrom(n.id, 'branch');
    const counts = new Map<string, number>();
    for (const e of branchEdges)
      for (const id of reachable(e.target)) counts.set(id, (counts.get(id) ?? 0) + 1);
    let join: string | undefined;
    for (const [id, c] of counts) {
      if (c >= 2 && (join === undefined || (topoIndex.get(id) ?? 0) < (topoIndex.get(join) ?? 0)))
        join = id;
    }
    const branches: Branch[] = branchEdges.map((e, i) => {
      const label = e.label ?? (e.isDefault ? 'Otherwise' : `Option ${i + 1}`);
      const target = ctx.node(e.target);
      if (!target) {
        ctx.diag(
          'graph/dangling-edge',
          'error',
          `Branch ${label} points to a missing node`,
          n.id,
          e.id,
        );
        return { edge: e, label, chain: [] };
      }
      if (
        !ids.has(target.id) ||
        target.kind === 'phase' ||
        target.kind === 'loop' ||
        !isKnownNode(target)
      ) {
        return { edge: e, label, chain: [], pointer: target };
      }
      const chain: SkillNode[] = [];
      let cur: SkillNode | undefined = target;
      while (
        cur &&
        ids.has(cur.id) &&
        !consumed.has(cur.id) &&
        cur.id !== join &&
        (counts.get(cur.id) ?? 0) === 1
      ) {
        if (cur.kind === 'phase' || cur.kind === 'loop' || cur.kind === 'decision') break;
        const incoming = ctx
          .edgesTo(cur.id)
          .filter((x) => (x.kind === 'next' || x.kind === 'branch') && ids.has(x.source));
        if (chain.length > 0 && incoming.length > 1) break;
        chain.push(cur);
        consumed.add(cur.id);
        const nexts: SkillEdge[] = ctx.edgesFrom(cur.id, 'next').filter((x) => ids.has(x.target));
        const nextTarget = nexts.length === 1 ? (nexts[0] as SkillEdge).target : undefined;
        cur = nextTarget ? ctx.node(nextTarget) : undefined;
      }
      return { edge: e, label, chain, pointer: chain.length === 0 ? target : undefined };
    });
    if (branches.length < 2) {
      ctx.diag('graph/decision-branches', 'error', 'A decision needs at least two branches', n.id);
    }
    items.push({ type: 'decision', node: n as DecisionNodeT, branches });
  }
  return items;
}

// ---------- rendering ----------

interface RenderState {
  /** Deferred blocks (branch sub-sections) appended after the container body. */
  tail: RootContent[];
  /** Root-only: nodes diverted into synthesized standard sections. */
  diverted?: SkillNode[];
}

function refSentence(
  ctx: Ctx,
  edge: SkillEdge,
  host: SkillNode,
  target: SkillNode,
): PhrasingContent[] {
  const override = host.overrides?.[`edge:${edge.id}`];
  if (override !== undefined) return mdInline(override);
  if (target.kind === 'reference') {
    const r = target as ReferenceNodeT;
    if (r.source === 'url' && r.url) {
      const verb =
        ctx.profile === 'claude-code' ? `Fetch ${r.url} with WebFetch` : `Fetch ${r.url}`;
      const when = r.readWhen ? ` ${r.readWhen}` : '';
      const why = r.summary ? `; it contains ${r.summary}` : '';
      return mdInline(`${verb}${when}${why}.`);
    }
    const path = ctx.filePaths.get(target.id) ?? r.path;
    const out: PhrasingContent[] = [txt('Read '), code(path)];
    if (r.summary) out.push(txt(` for ${r.summary}`));
    if (r.readWhen) out.push(txt(` when ${r.readWhen}`));
    out.push(txt('.'));
    return out;
  }
  if (target.kind === 'script') {
    const s = target as ScriptNodeT;
    const path = ctx.filePaths.get(target.id) ?? s.path;
    const args = s.args && s.args.length > 0 ? ` ${s.args.join(' ')}` : '';
    const out: PhrasingContent[] = [txt('Run '), code(`${path}${args}`)];
    if (s.runWhen) out.push(txt(` to ${s.runWhen}`));
    out.push(txt('.'));
    return out;
  }
  if (target.kind === 'asset') {
    const path = ctx.filePaths.get(target.id) ?? (target as { path: string }).path;
    const used = (target as { usedFor?: string }).usedFor;
    const out: PhrasingContent[] = [txt('Use '), code(path)];
    if (used) out.push(txt(` for ${used}`));
    out.push(txt('.'));
    return out;
  }
  return [];
}

function fileSentences(ctx: Ctx, host: SkillNode): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const edges = [...ctx.edgesFrom(host.id, 'reads'), ...ctx.edgesFrom(host.id, 'runs')];
  for (const e of edges) {
    if (e.mentioned) continue;
    const target = ctx.node(e.target);
    if (!target) continue;
    const s = refSentence(ctx, e, host, target);
    if (s.length) out.push(txt(' '), ...s);
  }
  return out;
}

function scriptUsage(ctx: Ctx, host: SkillNode): RootContent[] {
  const out: RootContent[] = [];
  for (const e of ctx.edgesFrom(host.id, 'runs')) {
    const t = ctx.node(e.target);
    if (t?.kind === 'script' && (t as ScriptNodeT).usage && !e.mentioned) {
      out.push(codeBlock('bash', (t as ScriptNodeT).usage as string));
    }
  }
  return out;
}

function attachedBlocks(ctx: Ctx, host: SkillNode, depth: number): RootContent[] {
  const out: RootContent[] = [];
  for (const e of ctx.edgesTo(host.id, 'attaches')) {
    const src = ctx.node(e.source);
    if (!src) continue;
    if (src.kind === 'guardrail') out.push(...renderGuardrailParagraph(src as GuardrailNodeT));
    else if (src.kind === 'example') out.push(...renderExample(src as ExampleNodeT, depth));
  }
  return out;
}

function renderGuardrailParagraph(g: GuardrailNodeT): RootContent[] {
  const lead = g.text ? [strong(mdInline(g.text))] : [];
  const blocks = g.why ? mdBlocks(g.why) : [];
  return lead.length ? withLead(blocks, lead) : blocks;
}

function renderGuardrailItem(g: GuardrailNodeT): ListItem {
  return listItem(renderGuardrailParagraph(g), g.spread ?? false);
}

function renderStepBlocks(ctx: Ctx, n: StepNodeT, depth: number): RootContent[] {
  let blocks = mdBlocks(n.instruction);
  if (n.title) blocks = withLead(blocks, [strong(mdInline(n.title))]);
  if (n.why) blocks = appendInline(blocks, [txt(' '), ...mdInline(n.why)]);
  if (n.mentionTools && n.tools && n.tools.length > 0) {
    blocks = appendInline(blocks, [txt(` Use ${n.tools.join(', ')}.`)]);
  }
  const files = fileSentences(ctx, n);
  if (files.length) blocks = appendInline(blocks, files);
  if (n.detail && n.detail.length > 0) {
    blocks.push(
      list(
        false,
        n.detail.map((d) => listItem([para(mdInline(d))])),
      ),
    );
  }
  blocks.push(...scriptUsage(ctx, n));
  blocks.push(...attachedBlocks(ctx, n, depth));
  if (blocks.length === 0) blocks.push(para([txt('')]));
  return blocks;
}

function renderAskUserBlocks(ctx: Ctx, n: AskUserNodeT): RootContent[] {
  let blocks = mdBlocks(n.question);
  if (n.title) blocks = withLead(blocks, [strong(mdInline(n.title))]);
  if (n.options && n.options.length > 0) {
    blocks.push(
      list(
        false,
        n.options.map((o) => listItem([para(mdInline(o))])),
      ),
    );
  }
  const fallback =
    ctx.profile === 'claude-code'
      ? `Use the AskUserQuestion tool to gather this input${n.blocking ? ', and do not proceed until you have the answer' : ''}.`
      : n.blocking
        ? 'Ask the user and wait for their answer before continuing.'
        : 'Ask the user.';
  const sentence = ctx.text(n, 'ask_user:tool', fallback);
  const tail = mdInline(n.why ? `${sentence} ${n.why}` : sentence);
  if (n.options && n.options.length > 0) blocks.push(para(tail));
  else blocks = appendInline(blocks, [txt(' '), ...tail]);
  const files = fileSentences(ctx, n);
  if (files.length) blocks = appendInline(blocks, files);
  blocks.push(...attachedBlocks(ctx, n, 0));
  return blocks;
}

function renderDelegateBlocks(ctx: Ctx, n: DelegateNodeT): RootContent[] {
  const agent = n.agentType
    ? `${/^[aeiou]/i.test(n.agentType) ? 'an' : 'a'} ${n.agentType} subagent`
    : 'a subagent';
  const fallback =
    ctx.profile === 'claude-code'
      ? `Spawn ${agent} with this task: ${n.task}`
      : `Delegate to a separate agent if available; otherwise do it inline: ${n.task}`;
  let s = ctx.text(n, 'delegate:sentence', fallback);
  if (n.parallel) s += ' Run independent subagents in parallel.';
  if (n.returns) s += ` It should return ${n.returns}.`;
  let blocks: RootContent[] = mdBlocks(s);
  if (n.title) blocks = withLead(blocks, [strong(mdInline(n.title))]);
  return blocks;
}

function renderSkillCallBlocks(ctx: Ctx, n: SkillCallNodeT): RootContent[] {
  const when = n.when ? ` when ${n.when}` : '';
  const args = n.args ? ` ${n.args}` : '';
  const inline: PhrasingContent[] =
    ctx.profile === 'claude-code'
      ? [txt('Invoke '), code(`/${n.skill}${args}`), txt(`${when}.`)]
      : [txt('Apply the '), code(n.skill), txt(` skill${when}.`)];
  const override = n.overrides?.['skill_call:sentence'];
  let blocks: RootContent[] = [para(override !== undefined ? mdInline(override) : inline)];
  if (n.title) blocks = withLead(blocks, [strong(mdInline(n.title))]);
  return blocks;
}

function renderInjectBlocks(ctx: Ctx, n: InjectNodeT): RootContent[] {
  if (ctx.profile !== 'claude-code') {
    ctx.diag(
      'profile/inject-requires-claude-code',
      'error',
      'Dynamic context injection is Claude Code only; omitted',
      n.id,
    );
    return [];
  }
  if (n.multiline) {
    const blocks: RootContent[] = [];
    if (n.label) blocks.push(para(mdInline(n.label)));
    blocks.push(codeBlock('!', n.command));
    return blocks;
  }
  const inline: PhrasingContent[] = [];
  if (n.label) inline.push(txt(`${n.label}: `));
  inline.push(txt('!'), code(n.command));
  return [para(inline)];
}

function renderListItemNode(ctx: Ctx, n: SkillNode, depth: number): ListItem {
  switch (n.kind) {
    case 'step':
      return listItem(
        renderStepBlocks(ctx, n as StepNodeT, depth),
        (n as StepNodeT).spread ?? false,
      );
    case 'ask_user':
      return listItem(renderAskUserBlocks(ctx, n as AskUserNodeT));
    case 'delegate':
      return listItem(renderDelegateBlocks(ctx, n as DelegateNodeT));
    case 'skill_call':
      return listItem(renderSkillCallBlocks(ctx, n as SkillCallNodeT));
    case 'inject':
      return listItem(renderInjectBlocks(ctx, n as InjectNodeT));
    default:
      return listItem([para([txt(n.title ?? n.kind)])]);
  }
}

function renderExample(n: ExampleNodeT, _depth: number): RootContent[] {
  const label = n.label ? `Example ${n.label}:` : 'Example:';
  const blocks: RootContent[] = [para([strong([txt(label)])])];
  const pair = (name: string, value: string) => {
    if (value.includes('\n')) blocks.push(para([txt(`${name}:`)]), codeBlock(undefined, value));
    else blocks.push(para([txt(`${name}: `), ...mdInline(value)]));
  };
  pair('Input', n.input);
  pair('Output', n.output);
  if (n.commentary) blocks.push(...mdBlocks(n.commentary));
  return blocks;
}

function renderOutputFormat(ctx: Ctx, n: OutputFormatNodeT): RootContent[] {
  const blocks: RootContent[] = [];
  if (n.intro) blocks.push(...mdBlocks(n.intro));
  if (n.strictness === 'exact')
    blocks.push(para(mdInline(ctx.text(n, 'output:strictness', 'Use this exact template:'))));
  else if (n.strictness === 'guide')
    blocks.push(para(mdInline(ctx.text(n, 'output:strictness', 'Use this structure as a guide:'))));
  blocks.push(codeBlock(n.format, n.template));
  if (n.destination) {
    blocks.push(
      para([
        txt('Save the result to '),
        code(n.destination),
        ...mdInline(ctx.text(n, 'output:destination', ' after the user confirms.')),
      ]),
    );
  }
  return blocks;
}

function renderChecklist(n: ChecklistNodeT): RootContent[] {
  const items = n.items.map((it) => {
    const children: PhrasingContent[] = mdInline(it.text);
    if (it.why) children.push(txt(' '), ...mdInline(it.why));
    return listItem([para(children)], false, n.style === 'task' ? (it.checked ?? false) : null);
  });
  return [list(false, items, n.spread ?? false)];
}

function renderTable(header: string[], rows: string[][], align?: (string | null)[]): Table {
  const row = (cells: string[]): TableRow => ({
    type: 'tableRow',
    children: cells.map((c) => ({ type: 'tableCell', children: mdInline(c) })),
  });
  return {
    type: 'table',
    align: (align ?? header.map(() => null)) as Table['align'],
    children: [row(header), ...rows.map(row)],
  };
}

function renderCatalog(ctx: Ctx, n: CatalogNodeT, depth: number): RootContent[] {
  const blocks: RootContent[] = [];
  if (n.intro) blocks.push(...mdBlocks(n.intro));
  if (n.table) blocks.push(renderTable(n.table.header, n.table.rows, n.table.align));
  else if (n.categories.length > 0) {
    blocks.push(
      renderTable(
        ['Priority', 'Category', 'Impact', 'Prefix'],
        n.categories.map((c, i) => [String(i + 1), c.name, c.impact ?? '', `\`${c.prefix}\``]),
      ),
    );
  }
  if (n.quickReference === 'auto') {
    const refs = ctx.doc.nodes.filter((x) => x.kind === 'reference') as ReferenceNodeT[];
    n.categories.forEach((c, i) => {
      blocks.push(
        heading(depth + 1, [txt(`${i + 1}. ${c.name}${c.impact ? ` (${c.impact})` : ''}`)]),
      );
      const members = refs.filter((r) => {
        const file = (ctx.filePaths.get(r.id) ?? r.path).split('/').pop() ?? '';
        return r.categoryId === c.id || (!r.categoryId && file.startsWith(c.prefix));
      });
      if (members.length > 0) {
        blocks.push(
          list(
            false,
            members.map((r) => {
              const file = (ctx.filePaths.get(r.id) ?? r.path).split('/').pop() ?? r.path;
              const children: PhrasingContent[] = [code(file.replace(/\.md$/, ''))];
              if (r.summary) children.push(txt(` - ${r.summary}`));
              return listItem([para(children)]);
            }),
          ),
        );
      }
    });
  }
  return blocks;
}

function renderLoop(ctx: Ctx, n: LoopNodeT, depth: number, state: RenderState): RootContent[] {
  const blocks: RootContent[] = [];
  if (n.intro) blocks.push(...mdBlocks(n.intro));
  const max = n.maxIterations ? ` (at most ${n.maxIterations} rounds)` : '';
  const until = n.until || 'the goal is met';
  blocks.push(
    para(mdInline(ctx.text(n, 'loop:start', `Repeat the following until ${until}${max}:`))),
  );
  blocks.push(...renderContainerBody(ctx, n.id, depth, state, 'numbered'));
  const stop = ctx.text(n, 'loop:stop', `Stop when ${until}.`);
  blocks.push(para(mdInline(n.why ? `${stop} ${n.why}` : stop)));
  return blocks;
}

function renderPhase(ctx: Ctx, n: PhaseNodeT, depth: number, state: RenderState): RootContent[] {
  const d = n.headingDepth ?? depth;
  const blocks: RootContent[] = [heading(d, mdInline(n.title))];
  if (n.intro) blocks.push(...mdBlocks(n.intro));
  blocks.push(...renderContainerBody(ctx, n.id, d + 1, state, n.stepStyle));
  return blocks;
}

function chainInline(
  ctx: Ctx,
  b: Branch,
  depth: number,
): { inline: PhrasingContent[]; nested: RootContent[]; deferred?: RootContent[] } {
  if (b.pointer) {
    const p = b.pointer;
    if (p.kind === 'reference' || p.kind === 'script' || p.kind === 'asset') {
      const path = ctx.filePaths.get(p.id) ?? (p as { path: string }).path;
      return {
        inline: [txt('see '), { type: 'link', url: path, children: [txt(path)] }],
        nested: [],
      };
    }
    const title = p.title ?? (p as { question?: string }).question ?? p.kind;
    return { inline: [txt(`go to "${title}"`)], nested: [] };
  }
  if (b.chain.length === 0) return { inline: [txt('continue.')], nested: [] };
  if (b.chain.length === 1) {
    const only = b.chain[0] as SkillNode;
    const item = renderListItemNode(ctx, only, depth);
    const first = item.children[0];
    if (item.children.length === 1 && first && first.type === 'paragraph') {
      return { inline: first.children, nested: [] };
    }
    return { inline: [], nested: [list(true, [item])] };
  }
  const items = b.chain.map((c) => renderListItemNode(ctx, c, depth));
  if (b.chain.length <= 3) return { inline: [], nested: [list(true, items)] };
  const plainLabel = plainText(mdInline(b.label));
  return {
    inline: [txt(`see "If ${plainLabel}" below`)],
    nested: [],
    deferred: [heading(depth + 1, [txt(`If ${plainLabel}`)]), list(true, items)],
  };
}

function renderDecision(
  ctx: Ctx,
  item: Extract<FlowItem, { type: 'decision' }>,
  depth: number,
  state: RenderState,
): RootContent[] {
  const n = item.node;
  const blocks: RootContent[] = [];
  if (n.intro) blocks.push(...mdBlocks(n.intro));
  if (n.question) blocks.push(para([strong(mdInline(n.question))]));
  const items = item.branches.map((b) => {
    const { inline, nested, deferred } = chainInline(ctx, b, depth);
    if (deferred) state.tail.push(...deferred);
    const head: PhrasingContent[] = [
      strong(mdInline(b.label)),
      txt(inline.length ? ' → ' : ' →'),
      ...inline,
    ];
    return listItem([para(head), ...nested]);
  });
  blocks.push(list(false, items));
  return blocks;
}

function renderBlockNode(ctx: Ctx, n: SkillNode, depth: number, state: RenderState): RootContent[] {
  switch (n.kind) {
    case 'phase':
      return renderPhase(ctx, n as PhaseNodeT, depth, state);
    case 'loop':
      return renderLoop(ctx, n as LoopNodeT, depth, state);
    case 'raw_markdown':
      return mdBlocks((n as { body: string }).body);
    case 'output_format':
      return renderOutputFormat(ctx, n as OutputFormatNodeT);
    case 'example':
      return renderExample(n as ExampleNodeT, depth);
    case 'checklist':
      return renderChecklist(n as ChecklistNodeT);
    case 'catalog':
      return renderCatalog(ctx, n as CatalogNodeT, depth);
    default:
      return [];
  }
}

/** Render the flow children of a container into block nodes. */
function renderContainerBody(
  ctx: Ctx,
  parentId: string | null,
  depth: number,
  state: RenderState,
  stepStyle: 'numbered' | 'bulleted' | 'prose' = 'numbered',
): RootContent[] {
  const items = sequence(ctx, parentId);
  const blocks: RootContent[] = [];
  let run: {
    key: string;
    style: 'numbered' | 'bulleted';
    ordered: boolean;
    items: ListItem[];
    spread: boolean;
    start?: number;
  } | null = null;
  const flush = () => {
    if (run) {
      blocks.push(list(run.ordered, run.items, run.spread, run.start));
      run = null;
    }
  };
  const localState: RenderState = { tail: [], diverted: state.diverted };

  for (const item of items) {
    if (item.type === 'decision') {
      flush();
      blocks.push(...renderDecision(ctx, item, depth, localState));
      continue;
    }
    const n = item.node;
    if (!isKnownNode(n)) {
      ctx.diag('graph/unknown-node-kind', 'error', `Unknown node kind "${n.kind}" skipped`, n.id);
      continue;
    }
    if (state.diverted && parentId === null && ROOT_SECTION_KINDS.has(n.kind)) {
      state.diverted.push(n);
      continue;
    }
    if (n.kind === 'guardrail') {
      const g = n as GuardrailNodeT;
      if (run?.key !== 'guardrail' || g.listSpread !== undefined) {
        flush();
        run = {
          key: 'guardrail',
          style: 'bulleted',
          ordered: false,
          items: [],
          spread: g.listSpread ?? false,
        };
      }
      run.items.push(renderGuardrailItem(g));
      continue;
    }
    if (LIST_ITEM_KINDS.has(n.kind)) {
      const s = n as StepNodeT;
      // A step may choose prose on its own, so one phase can hold both paragraphs and a list.
      const asProse = s.prose ?? stepStyle === 'prose';
      if (asProse && n.kind === 'step') {
        flush();
        blocks.push(...renderStepBlocks(ctx, s, depth));
        continue;
      }
      const explicit =
        s.listStyle !== undefined || s.listStart !== undefined || s.listSpread !== undefined;
      const inherited: 'numbered' | 'bulleted' =
        run && run.key === 'flow' ? run.style : stepStyle === 'bulleted' ? 'bulleted' : 'numbered';
      const style: 'numbered' | 'bulleted' = s.listStyle ?? inherited;
      if (run?.key !== 'flow' || explicit) {
        flush();
        run = {
          key: 'flow',
          style,
          ordered: style === 'numbered',
          items: [],
          spread: s.listSpread ?? false,
          start: s.listStart,
        };
      }
      run.items.push(renderListItemNode(ctx, n, depth));
      continue;
    }
    flush();
    blocks.push(...renderBlockNode(ctx, n, depth, localState));
  }
  flush();
  blocks.push(...localState.tail);
  return blocks;
}

export function isInlinedReference(r: ReferenceNodeT): boolean {
  if (r.source !== 'inline') return false;
  if (r.inline === 'always') return true;
  if (r.inline === 'auto') return countLines(r.body ?? '') <= 12;
  return false;
}

function synthesizedSections(ctx: Ctx, diverted: SkillNode[], depth: number): RootContent[] {
  const blocks: RootContent[] = [];
  const outputs = diverted.filter((n) => n.kind === 'output_format') as OutputFormatNodeT[];
  const examples = diverted.filter((n) => n.kind === 'example') as ExampleNodeT[];
  const dos = diverted.filter(
    (n) => n.kind === 'guardrail' && (n as GuardrailNodeT).polarity === 'do',
  ) as GuardrailNodeT[];
  const donts = diverted.filter(
    (n) => n.kind === 'guardrail' && (n as GuardrailNodeT).polarity === 'dont',
  ) as GuardrailNodeT[];
  const checklists = diverted.filter((n) => n.kind === 'checklist') as ChecklistNodeT[];
  const catalogs = diverted.filter((n) => n.kind === 'catalog') as CatalogNodeT[];

  for (const c of catalogs) {
    blocks.push(
      heading(
        depth,
        mdInline(c.title ?? ctx.text(c, 'section:catalog', 'Rule Categories by Priority')),
      ),
    );
    blocks.push(...renderCatalog(ctx, c, depth));
  }
  if (outputs.length) {
    blocks.push(heading(depth, mdInline(ctx.text(ctx.entry, 'section:output', 'Output'))));
    for (const o of outputs) blocks.push(...renderOutputFormat(ctx, o));
  }
  if (examples.length) {
    blocks.push(heading(depth, mdInline(ctx.text(ctx.entry, 'section:examples', 'Examples'))));
    for (const e of examples) blocks.push(...renderExample(e, depth));
  }
  if (dos.length) {
    blocks.push(heading(depth, mdInline(ctx.text(ctx.entry, 'section:guidelines', 'Guidelines'))));
    blocks.push(list(false, dos.map(renderGuardrailItem)));
  }
  if (donts.length) {
    blocks.push(
      heading(
        depth,
        mdInline(ctx.text(ctx.entry, 'section:antipatterns', 'Anti-patterns to Avoid')),
      ),
    );
    blocks.push(list(false, donts.map(renderGuardrailItem)));
  }
  for (const c of checklists) {
    const title =
      c.title ??
      (c.variant === 'verification'
        ? 'Verification'
        : c.variant === 'red-flags'
          ? 'Red Flags'
          : 'Checklist');
    blocks.push(heading(depth, mdInline(ctx.text(c, 'section:checklist', title))));
    blocks.push(...renderChecklist(c));
  }
  return blocks;
}

// ---------- entry point ----------

export function compile(doc: SkillDoc, options: CompileOptions = {}): CompileResult {
  const ctx = new Ctx(doc, options);
  const entry = ctx.entry;
  const mermaidMode = options.mermaid ?? 'none';

  const scripts = doc.nodes.filter((n) => n.kind === 'script') as ScriptNodeT[];
  const derivedTools =
    ctx.profile === 'claude-code' && entry.autoAllowScripts
      ? scripts.map((s) => `Bash(\${CLAUDE_SKILL_DIR}/${ctx.filePaths.get(s.id) ?? s.path} *)`)
      : [];

  const root: RootContent[] = [];
  root.push({ type: 'yaml', value: toYaml(buildFrontmatter(ctx, derivedTools)) });
  if (entry.title) root.push(heading(1, mdInline(entry.title)));
  if (entry.summary) root.push(...mdBlocks(entry.summary));

  if (entry.overview === 'auto') {
    const phases = ctx.flowChildren(null).filter((n) => n.kind === 'phase') as PhaseNodeT[];
    if (phases.length > 0) {
      root.push(heading(2, mdInline(ctx.text(entry, 'section:overview', 'How It Works'))));
      root.push(
        list(
          true,
          phases.map((p) =>
            listItem([
              para([
                strong([...mdInline(p.title), ...(p.summary ? [txt(':')] : [])]),
                ...(p.summary ? [txt(' '), ...mdInline(p.summary)] : []),
              ]),
            ]),
          ),
        ),
      );
    }
  }
  if (entry.usage) {
    root.push(heading(2, mdInline(ctx.text(entry, 'section:usage', 'Usage'))));
    root.push(...mdBlocks(entry.usage));
  }

  const state: RenderState = { tail: [], diverted: [] };
  root.push(...renderContainerBody(ctx, null, 2, state, 'numbered'));
  root.push(...synthesizedSections(ctx, state.diverted ?? [], 2));

  const references = doc.nodes.filter((n) => n.kind === 'reference') as ReferenceNodeT[];
  const inlinedRefs = references.filter(isInlinedReference);
  if (entry.referenceIndex !== 'none') {
    const listed = references.filter(
      (r) =>
        !isInlinedReference(r) &&
        r.source !== 'url' &&
        (entry.referenceIndex === 'all' || !ctx.mentioned.has(r.id)),
    );
    if (listed.length > 0) {
      root.push(heading(2, mdInline(ctx.text(entry, 'section:references', 'Reference files'))));
      root.push(
        list(
          false,
          listed.map((r) => {
            const children: PhrasingContent[] = [code(ctx.filePaths.get(r.id) ?? r.path)];
            const desc = r.summary ?? r.readWhen;
            if (desc) children.push(txt(` - ${desc}`));
            return listItem([para(children)]);
          }),
        ),
      );
    }
  }
  for (const r of inlinedRefs) {
    root.push(heading(2, mdInline(r.title ?? r.path)));
    root.push(...mdBlocks(r.body ?? ''));
  }

  let mermaidText = '';
  if (mermaidMode !== 'none') mermaidText = toMermaid(ctx);
  if (mermaidMode === 'inline') {
    root.push(heading(2, mdInline(ctx.text(entry, 'section:diagram', 'Workflow diagram'))));
    root.push(codeBlock('mermaid', mermaidText.replace(/\n$/, '')));
  }

  const skillMd = stringifyMarkdown({ type: 'root', children: root } as Root);
  const files: Record<string, string> = { 'SKILL.md': skillMd };
  const binaryFiles: Record<string, string> = {};

  for (const r of references) {
    if (isInlinedReference(r) || r.source !== 'inline') continue;
    files[ctx.filePaths.get(r.id) ?? r.path] = ensureTrailingNewline(r.body ?? '');
  }
  for (const s of scripts) files[ctx.filePaths.get(s.id) ?? s.path] = ensureTrailingNewline(s.code);
  for (const a of doc.nodes.filter((n) => n.kind === 'asset')) {
    const asset = a as { id: string; path: string; content?: string; encoding: 'utf8' | 'base64' };
    const p = ctx.filePaths.get(asset.id) ?? asset.path;
    if (asset.encoding === 'base64') binaryFiles[p] = asset.content ?? '';
    else files[p] = asset.content ?? '';
  }
  if (mermaidMode === 'file') files['assets/workflow.mmd'] = mermaidText;

  const budget = { lines: entry.budget?.lines ?? 500, tokens: entry.budget?.tokens ?? 5000 };
  return {
    files,
    binaryFiles,
    skillMd,
    report: {
      profile: ctx.profile,
      lines: countLines(skillMd),
      tokens: estimateTokens(skillMd),
      budget,
      diagnostics: ctx.diagnostics,
      files: [...Object.keys(files), ...Object.keys(binaryFiles)].sort(),
      mentioned: [...ctx.mentioned].sort(),
    },
  };
}

function ensureTrailingNewline(s: string): string {
  if (s.length === 0) return s;
  return s.endsWith('\n') ? s : `${s}\n`;
}

/** Convenience: compile and return only SKILL.md. */
export function compileToMarkdown(doc: SkillDoc, options: CompileOptions = {}): string {
  return compile(doc, options).skillMd;
}
