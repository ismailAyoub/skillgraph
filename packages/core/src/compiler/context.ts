import type {
  EdgeKind,
  EntryNodeT,
  NodeKind,
  Profile,
  SkillDoc,
  SkillEdge,
  SkillNode,
} from '../schema/graph';
import { FILE_KINDS, FLOW_KINDS, isKnownNode } from '../schema/graph';
import { slugify, uniqueSlug } from '../util/slug';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  rule: string;
  severity: Severity;
  message: string;
  nodeId?: string;
  edgeId?: string;
  path?: string;
  line?: number;
}

export interface CompileOptions {
  profile?: Profile;
  mermaid?: 'none' | 'file' | 'inline';
}

export interface CompileReport {
  profile: Profile;
  lines: number;
  tokens: number;
  budget: { lines: number; tokens: number };
  diagnostics: Diagnostic[];
  /** Emitted file paths in deterministic order. */
  files: string[];
  /** File-node ids that are referenced by at least one reads/runs edge. */
  mentioned: string[];
}

export interface CompileResult {
  /** All emitted text files keyed by relative path, including SKILL.md. */
  files: Record<string, string>;
  /** Binary assets as base64, keyed by relative path. */
  binaryFiles: Record<string, string>;
  skillMd: string;
  report: CompileReport;
}

function byOrder(a: SkillNode, b: SkillNode): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Normalized, indexed view of a doc used by the compiler and the linter. */
export class Ctx {
  readonly doc: SkillDoc;
  readonly profile: Profile;
  readonly options: CompileOptions;
  readonly nodes = new Map<string, SkillNode>();
  readonly entry: EntryNodeT;
  readonly diagnostics: Diagnostic[] = [];
  readonly filePaths = new Map<string, string>();
  readonly mentioned = new Set<string>();
  private readonly childrenMap = new Map<string | null, SkillNode[]>();
  private readonly edgesFromMap = new Map<string, SkillEdge[]>();
  private readonly edgesToMap = new Map<string, SkillEdge[]>();

  constructor(doc: SkillDoc, options: CompileOptions = {}) {
    this.doc = doc;
    this.options = options;
    this.profile = options.profile ?? doc.profile;
    for (const n of doc.nodes) {
      if (this.nodes.has(n.id)) {
        this.diag('graph/duplicate-id', 'error', `Duplicate node id ${n.id}`, n.id);
        continue;
      }
      this.nodes.set(n.id, n);
    }
    const entries = doc.nodes.filter((n) => n.kind === 'entry') as EntryNodeT[];
    const entry = entries[0];
    if (!entry) throw new Error('Doc has no entry node');
    if (entries.length > 1)
      this.diag('graph/multiple-entries', 'error', 'More than one entry node', entries[1]?.id);
    this.entry = entry;

    for (const n of doc.nodes) {
      const parent = n.parentId ?? null;
      if (parent !== null && !this.nodes.has(parent)) {
        this.diag(
          'graph/missing-parent',
          'error',
          `Node ${n.id} has unknown parent ${parent}`,
          n.id,
        );
      }
      const list = this.childrenMap.get(parent) ?? [];
      list.push(n);
      this.childrenMap.set(parent, list);
    }
    for (const list of this.childrenMap.values()) list.sort(byOrder);

    for (const e of doc.edges) {
      if (!this.nodes.has(e.source) || !this.nodes.has(e.target)) {
        this.diag(
          'graph/dangling-edge',
          'error',
          `Edge ${e.id} references a missing node`,
          undefined,
          e.id,
        );
        continue;
      }
      const from = this.edgesFromMap.get(e.source) ?? [];
      from.push(e);
      this.edgesFromMap.set(e.source, from);
      const to = this.edgesToMap.get(e.target) ?? [];
      to.push(e);
      this.edgesToMap.set(e.target, to);
      if (e.kind === 'reads' || e.kind === 'runs') this.mentioned.add(e.target);
    }
    for (const list of this.edgesFromMap.values()) list.sort(edgeOrder);
    for (const list of this.edgesToMap.values()) list.sort(edgeOrder);

    this.assignFilePaths();
  }

  diag(rule: string, severity: Severity, message: string, nodeId?: string, edgeId?: string): void {
    this.diagnostics.push({ rule, severity, message, nodeId, edgeId });
  }

  children(parentId: string | null): SkillNode[] {
    return this.childrenMap.get(parentId) ?? [];
  }

  flowChildren(parentId: string | null): SkillNode[] {
    return this.children(parentId).filter(
      (n) => isKnownNode(n) && FLOW_KINDS.has(n.kind as NodeKind),
    );
  }

  edgesFrom(id: string, kind?: EdgeKind): SkillEdge[] {
    const all = this.edgesFromMap.get(id) ?? [];
    return kind ? all.filter((e) => e.kind === kind) : all;
  }

  edgesTo(id: string, kind?: EdgeKind): SkillEdge[] {
    const all = this.edgesToMap.get(id) ?? [];
    return kind ? all.filter((e) => e.kind === kind) : all;
  }

  node(id: string): SkillNode | undefined {
    return this.nodes.get(id);
  }

  /** Compiler-generated sentence with per-node override support. */
  text(node: SkillNode, key: string, fallback: string): string {
    const o = node.overrides?.[key];
    return o !== undefined ? o : fallback;
  }

  depthOf(node: SkillNode): number {
    let d = 0;
    let cur: SkillNode | undefined = node;
    while (cur?.parentId) {
      d++;
      cur = this.nodes.get(cur.parentId);
    }
    return d;
  }

  private assignFilePaths(): void {
    const taken = new Set<string>();
    const fileNodes = this.doc.nodes.filter(
      (n) => isKnownNode(n) && FILE_KINDS.has(n.kind as NodeKind),
    );
    // Explicit paths first so they always win.
    for (const n of fileNodes) {
      const explicit = (n as { path?: string }).path?.trim();
      if (explicit) {
        const p = normalizePath(explicit);
        if (taken.has(p))
          this.diag('body/duplicate-file-path', 'error', `Two nodes emit the same file ${p}`, n.id);
        taken.add(p);
        this.filePaths.set(n.id, p);
      }
    }
    for (const n of fileNodes) {
      if (this.filePaths.has(n.id)) continue;
      const base = slugify(n.slug ?? n.title ?? n.id);
      let dir = 'references';
      let ext = '.md';
      if (n.kind === 'script') {
        dir = 'scripts';
        ext = extForLanguage((n as { language?: string }).language);
      } else if (n.kind === 'asset') {
        dir = 'assets';
        ext = '';
      }
      const p = uniqueSlug(`${dir}/${base}${ext}`, taken);
      this.filePaths.set(n.id, p);
    }
  }
}

function edgeOrder(a: SkillEdge, b: SkillEdge): number {
  const ao = a.order ?? 0;
  const bo = b.order ?? 0;
  if (ao !== bo) return ao - bo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function extForLanguage(lang: string | undefined): string {
  switch ((lang ?? '').toLowerCase()) {
    case 'python':
    case 'py':
      return '.py';
    case 'javascript':
    case 'js':
    case 'node':
      return '.js';
    case 'typescript':
    case 'ts':
      return '.ts';
    case 'ruby':
    case 'rb':
      return '.rb';
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
    case '':
      return '.sh';
    default:
      return `.${lang}`;
  }
}
