import type { List, Paragraph, PhrasingContent, Root, RootContent, Table } from 'mdast';
import { YAML_TO_FIELD } from '../compiler/frontmatter';
import {
  blocksToMarkdown,
  fromYaml,
  inlineToMarkdown,
  parseMarkdown,
  plainText,
} from '../markdown/index';
import {
  type CatalogNodeT,
  type EntryNodeT,
  SCHEMA_VERSION,
  type SkillEdge,
  type SkillFile,
  SkillFileSchema,
  type SkillNode,
} from '../schema/graph';
import { newId, sequentialIds } from '../util/ids';
import { slugify } from '../util/slug';
import {
  DONT_RE,
  GUARD_HEADING,
  headingText,
  isSimpleItem,
  OUTPUT_HEADING,
  RED_FLAG_HEADING,
  STEP_HEADING,
  splitLead,
  startsWithStrong,
  VERIFY_HEADING,
} from './shapes';

export interface ImportInput {
  /** Text files keyed by path relative to the skill root; must include `SKILL.md`. */
  files: Record<string, string>;
  /** Binary files as base64, keyed by relative path. */
  binaryFiles?: Record<string, string>;
  /** Folder name; used as the skill name when the frontmatter has none and for lint. */
  dirName?: string;
  /** Sequential ids (tests, golden files) instead of random ones. */
  deterministicIds?: boolean;
}

export interface FidelityItem {
  section: string;
  kind: 'raw' | 'guessed';
  confidence: number;
  reason: string;
  nodeId?: string;
}

export interface FidelityReport {
  /** Characters of SKILL.md body captured by structured nodes. */
  recognized: number;
  /** Characters kept verbatim in raw_markdown nodes. */
  raw: number;
  /** recognized / (recognized + raw) */
  coverage: number;
  items: FidelityItem[];
  /** Mentions of files that were resolved by suffix match (non-relative paths). */
  nonRelativeMentions: string[];
}

export interface ImportResult {
  file: SkillFile;
  report: FidelityReport;
}

const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1)$/i;
const TEXT_EXT = /\.(md|markdown|txt|mdx)$/i;

function blockLength(b: RootContent): number {
  return blocksToMarkdown([b]).length;
}

export function decompile(input: ImportInput): ImportResult {
  const md = input.files['SKILL.md'];
  if (md === undefined) throw new Error('SKILL.md is required');
  const id = input.deterministicIds ? sequentialIds() : newId;
  const root: Root = parseMarkdown(md);
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];
  const items: FidelityItem[] = [];
  const nonRelativeMentions = new Set<string>();
  let recognized = 0;
  let raw = 0;

  // ---- frontmatter ----
  const yamlNode = root.children.find((c) => c.type === 'yaml');
  const fm = yamlNode && yamlNode.type === 'yaml' ? fromYaml(yamlNode.value) : {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const entryId = id('entry');
  const entry: EntryNodeT = {
    id: entryId,
    kind: 'entry',
    parentId: null,
    order: 0,
    provenance: 'import',
    name: str(fm.name) ?? input.dirName ?? 'skill',
    description: str(fm.description) ?? '',
    triggers: [],
    negativeTriggers: [],
    allowedTools: [],
    overview: 'none',
    referenceIndex: 'none',
    frontmatterOrder: Object.keys(fm),
  };
  if (str(fm.license)) entry.license = str(fm.license);
  if (str(fm.compatibility)) entry.compatibility = str(fm.compatibility);
  if (fm.metadata && typeof fm.metadata === 'object')
    entry.metadata = fm.metadata as Record<string, unknown>;
  if (fm['allowed-tools'] !== undefined) {
    entry.allowedToolsRaw = Array.isArray(fm['allowed-tools'])
      ? (fm['allowed-tools'] as string[]).join(', ')
      : String(fm['allowed-tools']);
  }
  const cc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (
      ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k)
    )
      continue;
    const field = YAML_TO_FIELD.get(k);
    cc[field ?? k] = v;
  }
  if (Object.keys(cc).length > 0) entry.claudeCode = cc as EntryNodeT['claudeCode'];
  nodes.push(entry);

  // ---- body ----
  const blocks = root.children.filter((c) => c.type !== 'yaml');
  let i = 0;
  const first = blocks[0];
  if (first && first.type === 'heading' && first.depth === 1) {
    entry.title = headingText(first);
    i++;
  }
  const summary: RootContent[] = [];
  while (i < blocks.length && blocks[i]?.type === 'paragraph')
    summary.push(blocks[i++] as RootContent);
  if (summary.length) {
    entry.summary = blocksToMarkdown(summary);
    recognized += entry.summary.length;
  }

  const orderCounters = new Map<string | null, number>();
  const nextOrder = (parent: string | null): number => {
    const n = (orderCounters.get(parent) ?? 0) + 1;
    orderCounters.set(parent, n);
    return n;
  };

  type Frame = { id: string; depth: number; title: string };
  const stack: Frame[] = [];
  const currentParent = (): string | null => stack[stack.length - 1]?.id ?? null;
  const currentTitle = (): string => stack[stack.length - 1]?.title ?? '';

  let pendingRaw: { parent: string | null; blocks: RootContent[] } | null = null;
  const flushRaw = () => {
    if (!pendingRaw || pendingRaw.blocks.length === 0) {
      pendingRaw = null;
      return;
    }
    const body = blocksToMarkdown(pendingRaw.blocks);
    const nid = id('raw_markdown');
    nodes.push({
      id: nid,
      kind: 'raw_markdown',
      parentId: pendingRaw.parent,
      order: nextOrder(pendingRaw.parent),
      provenance: 'import',
      body,
    });
    raw += body.length;
    items.push({
      section: currentTitle(),
      kind: 'raw',
      confidence: 1,
      reason: `${pendingRaw.blocks.map((b) => b.type).join(', ')} kept verbatim`,
      nodeId: nid,
    });
    pendingRaw = null;
  };
  const emitRaw = (block: RootContent) => {
    const parent = currentParent();
    if (pendingRaw && pendingRaw.parent !== parent) flushRaw();
    if (!pendingRaw) pendingRaw = { parent, blocks: [] };
    pendingRaw.blocks.push(block);
  };

  // ---- file inventory ----
  const knownFiles = Object.keys(input.files).filter(
    (p) =>
      p !== 'SKILL.md' &&
      !p.endsWith('SKILL.graph.json') &&
      !p.split('/').some((seg) => seg.startsWith('.')),
  );
  const binaryPaths = Object.keys(input.binaryFiles ?? {});
  const fileNodeByPath = new Map<string, string>();
  const mentionEdges = new Set<string>();

  const resolveMention = (token: string): string | undefined => {
    const t = token.replace(/^["'`(<]+|["'`),.:;>]+$/g, '').replace(/^\.\//, '');
    if (!t || !/[./]/.test(t)) return undefined;
    if (fileNodeByPath.has(t)) return t;
    for (const p of [...knownFiles, ...binaryPaths]) {
      if (t.endsWith(`/${p}`)) {
        nonRelativeMentions.add(token);
        return p;
      }
    }
    return undefined;
  };

  const pendingMentions: Array<{ host: string; path: string }> = [];
  /** mdast blocks captured by structured nodes (already scanned for mentions) or headings -> phase id. */
  const structured = new Set<unknown>();
  const headingHost = new Map<unknown, string>();
  const scanMentions = (node: RootContent | PhrasingContent, host: string) => {
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const m = n as { type?: string; value?: string; url?: string; children?: unknown[] };
      if (m.type === 'inlineCode' && m.value) {
        for (const tok of m.value.split(/\s+/)) {
          const p = resolveMention(tok);
          if (p) pendingMentions.push({ host, path: p });
        }
      } else if (m.type === 'code' && m.value) {
        for (const tok of m.value.split(/\s+/)) {
          const p = resolveMention(tok);
          if (p) pendingMentions.push({ host, path: p });
        }
      } else if (m.type === 'link' && m.url) {
        const p = resolveMention(m.url);
        if (p) pendingMentions.push({ host, path: p });
      } else if (m.type === 'text' && m.value) {
        for (const tok of m.value.split(/\s+/)) {
          const p = resolveMention(tok);
          if (p) pendingMentions.push({ host, path: p });
        }
      }
      if (Array.isArray(m.children)) for (const c of m.children) visit(c);
    };
    visit(node);
  };

  // Register file nodes up-front so mentions can resolve.
  const allPaths = [...knownFiles, ...binaryPaths].sort();
  for (const p of allPaths) fileNodeByPath.set(p, '');

  // ---- recognizers ----
  const stepsFromList = (
    lst: List,
    style: 'numbered' | 'bulleted',
    confidence: number,
    reason: string,
  ) => {
    structured.add(lst);
    const parent = currentParent();
    lst.children.forEach((item, idx) => {
      const children = [...item.children] as RootContent[];
      let title: string | undefined;
      const p0 = children[0];
      if (p0 && p0.type === 'paragraph') {
        const { lead, rest } = splitLead(p0);
        if (lead !== undefined) {
          title = lead;
          if (rest.length === 0) children.shift();
          else children[0] = { ...p0, children: rest };
        }
      }
      const instruction = blocksToMarkdown(children);
      const nid = id('step');
      const node: SkillNode = {
        id: nid,
        kind: 'step',
        parentId: parent,
        order: nextOrder(parent),
        provenance: 'import',
        title,
        instruction,
      };
      if (item.spread) node.spread = true;
      if (idx === 0) {
        node.listSpread = lst.spread ?? false;
        node.listStyle = style;
        if (lst.ordered && lst.start !== null && lst.start !== undefined && lst.start !== 1)
          node.listStart = lst.start;
      }
      nodes.push(node);
      recognized += instruction.length + (title?.length ?? 0);
      if (confidence < 1)
        items.push({ section: currentTitle(), kind: 'guessed', confidence, reason, nodeId: nid });
      scanMentions(item as unknown as RootContent, nid);
      if (idx > 0) {
        const prev = nodes[nodes.length - 2];
        if (prev && prev.kind === 'step')
          edges.push({ id: id('edge'), kind: 'next', source: prev.id, target: nid });
      }
    });
  };

  const guardrailsFromList = (lst: List) => {
    structured.add(lst);
    const parent = currentParent();
    lst.children.forEach((item, idx) => {
      const p0 = item.children[0] as Paragraph;
      const { lead, rest } = splitLead(p0);
      const text = lead ?? '';
      const why = rest.length ? inlineToMarkdown(rest) : undefined;
      const nid = id('guardrail');
      const node: SkillNode = {
        id: nid,
        kind: 'guardrail',
        parentId: parent,
        order: nextOrder(parent),
        provenance: 'import',
        polarity: DONT_RE.test(plainText(p0.children)) ? 'dont' : 'do',
        text,
        why,
      };
      if (item.spread) node.spread = true;
      if (idx === 0) node.listSpread = lst.spread ?? false;
      nodes.push(node);
      recognized += text.length + (why?.length ?? 0);
      scanMentions(item as unknown as RootContent, nid);
    });
  };

  const checklistFromList = (
    lst: List,
    variant: 'verification' | 'red-flags' | 'custom',
    style: 'task' | 'bullet',
  ) => {
    structured.add(lst);
    const parent = currentParent();
    const nid = id('checklist');
    const listItems = lst.children.map((item) => {
      const p0 = item.children[0] as Paragraph;
      const text = inlineToMarkdown(p0.children);
      const entryItem: { text: string; checked?: boolean } = { text };
      if (style === 'task') entryItem.checked = item.checked ?? false;
      return entryItem;
    });
    const node: SkillNode = {
      id: nid,
      kind: 'checklist',
      parentId: parent,
      order: nextOrder(parent),
      provenance: 'import',
      variant,
      style,
      items: listItems,
      spread: lst.spread ?? false,
    };
    nodes.push(node);
    recognized += listItems.reduce((a, b) => a + b.text.length, 0);
    scanMentions(lst, nid);
  };

  const catalogFromTable = (tbl: Table): boolean => {
    const rows = tbl.children.map((r) => r.children.map((c) => inlineToMarkdown(c.children)));
    const header = rows[0];
    if (!header) return false;
    const plainHeader = header.map((h) => h.toLowerCase());
    const prefixCol = plainHeader.findIndex((h) => /prefix/.test(h));
    const catCol = plainHeader.findIndex((h) => /categor/.test(h));
    if (prefixCol < 0 || catCol < 0) return false;
    const impactCol = plainHeader.findIndex(
      (h) => /impact|priority|severity/.test(h) && !/^priority$/.test(h),
    );
    const parent = currentParent();
    const nid = id('catalog');
    const categories: CatalogNodeT['categories'] = rows.slice(1).map((r) => {
      const name = r[catCol] ?? '';
      const prefix = (r[prefixCol] ?? '').replace(/`/g, '').trim();
      const cat: CatalogNodeT['categories'][number] = { id: slugify(name), name, prefix };
      if (impactCol >= 0 && r[impactCol]) cat.impact = r[impactCol];
      return cat;
    });
    const align = (tbl.align ?? header.map(() => null)) as Array<
      'left' | 'right' | 'center' | null
    >;
    const node: CatalogNodeT = {
      id: nid,
      kind: 'catalog',
      parentId: parent,
      order: nextOrder(parent),
      provenance: 'import',
      table: { header, rows: rows.slice(1), align },
      categories,
      quickReference: 'none',
    };
    nodes.push(node);
    structured.add(tbl);
    scanMentions(tbl, nid);
    recognized += blockLength(tbl);
    return true;
  };

  for (; i < blocks.length; i++) {
    const b = blocks[i] as RootContent;
    if (b.type === 'heading') {
      flushRaw();
      while (stack.length && (stack[stack.length - 1] as Frame).depth >= b.depth) stack.pop();
      const parent = currentParent();
      const nid = id('phase');
      const title = headingText(b);
      nodes.push({
        id: nid,
        kind: 'phase',
        parentId: parent,
        order: nextOrder(parent),
        provenance: 'import',
        title,
        stepStyle: 'numbered',
        headingDepth: b.depth,
      });
      recognized += title.length;
      headingHost.set(b, nid);
      stack.push({ id: nid, depth: b.depth, title });
      continue;
    }
    const sectionTitle = plainText(
      stack.length
        ? ((parseMarkdown(currentTitle()).children[0] as Paragraph)?.children ?? [])
        : [],
    );

    if (b.type === 'list') {
      const lst = b;
      const allSimple = lst.children.every(isSimpleItem);
      const allTask =
        lst.children.length > 0 &&
        lst.children.every((it) => it.checked !== null && it.checked !== undefined);
      const allStrong = lst.children.length > 0 && lst.children.every(startsWithStrong);
      if (allTask && allSimple) {
        flushRaw();
        checklistFromList(
          lst,
          VERIFY_HEADING.test(sectionTitle)
            ? 'verification'
            : RED_FLAG_HEADING.test(sectionTitle)
              ? 'red-flags'
              : 'custom',
          'task',
        );
        continue;
      }
      if (lst.ordered) {
        flushRaw();
        stepsFromList(lst, 'numbered', 1, 'ordered list');
        continue;
      }
      if (allSimple && RED_FLAG_HEADING.test(sectionTitle) && !allStrong) {
        flushRaw();
        checklistFromList(lst, 'red-flags', 'bullet');
        continue;
      }
      if (allSimple && allStrong && GUARD_HEADING.test(sectionTitle)) {
        flushRaw();
        guardrailsFromList(lst);
        continue;
      }
      if (allStrong && STEP_HEADING.test(sectionTitle)) {
        flushRaw();
        stepsFromList(
          lst,
          'bulleted',
          0.7,
          'bulleted list with bold leads under a workflow heading',
        );
        continue;
      }
      emitRaw(b);
      continue;
    }
    if (b.type === 'code' && OUTPUT_HEADING.test(sectionTitle)) {
      flushRaw();
      const parent = currentParent();
      const nid = id('output_format');
      nodes.push({
        id: nid,
        kind: 'output_format',
        parentId: parent,
        order: nextOrder(parent),
        provenance: 'import',
        template: b.value,
        format: b.lang ?? undefined,
      });
      recognized += b.value.length;
      structured.add(b);
      items.push({
        section: sectionTitle,
        kind: 'guessed',
        confidence: 0.8,
        reason: 'fenced block under an output-like heading',
        nodeId: nid,
      });
      continue;
    }
    if (b.type === 'table' && catalogFromTable(b)) {
      flushRaw();
      continue;
    }
    emitRaw(b);
  }
  flushRaw();

  // Mentions inside raw blocks: host is the enclosing phase (or the entry for pre-heading content).
  {
    const stack2: Frame[] = [];
    for (const b of blocks) {
      if (b.type === 'heading') {
        while (stack2.length && (stack2[stack2.length - 1] as Frame).depth >= b.depth) stack2.pop();
        const host = headingHost.get(b);
        if (host) stack2.push({ id: host, depth: b.depth, title: '' });
        continue;
      }
      if (structured.has(b)) continue;
      scanMentions(b, stack2[stack2.length - 1]?.id ?? entryId);
    }
  }

  // ---- file nodes ----
  let fileOrder = 1000;
  const catalog = nodes.find((n) => n.kind === 'catalog') as CatalogNodeT | undefined;
  for (const p of allPaths) {
    const isBinary = binaryPaths.includes(p);
    const base = p.split('/').pop() ?? p;
    let node: SkillNode;
    if (!isBinary && (p.startsWith('scripts/') || SCRIPT_EXT.test(p))) {
      node = {
        id: id('script'),
        kind: 'script',
        parentId: null,
        order: fileOrder++,
        provenance: 'import',
        title: base,
        path: p,
        language: languageFor(p),
        code: input.files[p] ?? '',
      };
    } else if (!isBinary && TEXT_EXT.test(p)) {
      const ref: SkillNode = {
        id: id('reference'),
        kind: 'reference',
        parentId: null,
        order: fileOrder++,
        provenance: 'import',
        title: base.replace(/\.(md|markdown|txt|mdx)$/i, ''),
        path: p,
        source: 'inline',
        inline: 'never',
        body: input.files[p] ?? '',
      };
      if (catalog) {
        const cat = catalog.categories.find((c) => c.prefix && base.startsWith(c.prefix));
        if (cat) ref.categoryId = cat.id;
      }
      node = ref;
    } else {
      node = {
        id: id('asset'),
        kind: 'asset',
        parentId: null,
        order: fileOrder++,
        provenance: 'import',
        title: base,
        path: p,
        encoding: isBinary ? 'base64' : 'utf8',
        content: isBinary ? input.binaryFiles?.[p] : input.files[p],
      };
    }
    nodes.push(node);
    fileNodeByPath.set(p, node.id);
  }

  for (const m of pendingMentions) {
    const targetId = fileNodeByPath.get(m.path);
    if (!targetId) continue;
    const key = `${m.host}->${targetId}`;
    if (mentionEdges.has(key)) continue;
    mentionEdges.add(key);
    const target = nodes.find((n) => n.id === targetId);
    edges.push({
      id: id('edge'),
      kind: target?.kind === 'script' ? 'runs' : 'reads',
      source: m.host,
      target: targetId,
      mentioned: true,
    });
  }

  const file = SkillFileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    doc: { profile: 'claude-code', nodes, edges },
    layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  });
  const total = recognized + raw;
  return {
    file,
    report: {
      recognized,
      raw,
      coverage: total === 0 ? 1 : recognized / total,
      items,
      nonRelativeMentions: [...nonRelativeMentions],
    },
  };
}

function languageFor(p: string): string {
  const ext = (p.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    py: 'python',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    rb: 'ruby',
    pl: 'perl',
    ps1: 'powershell',
  };
  return map[ext] ?? ext;
}
