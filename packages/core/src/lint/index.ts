import {
  type CompileResult,
  Ctx,
  compile,
  compiledDescription,
  type Diagnostic,
  FIELD_TO_YAML,
  isInlinedReference,
  type Severity,
} from '../compiler/index';
import type {
  EntryNodeT,
  LoopNodeT,
  ReferenceNodeT,
  ScriptNodeT,
  SkillDoc,
  SkillNode,
  StepNodeT,
} from '../schema/graph';
import { FLOW_KINDS, isKnownNode, type NodeKind } from '../schema/graph';
import { type MarkdownShape, unpackShape } from '../unpack/index';

export interface LintOptions {
  /** Folder the skill will live in; enables `spec/name-matches-dir`. */
  dirName?: string;
  /** Reuse an existing compile result instead of compiling again. */
  compiled?: CompileResult;
}

export interface LintResult {
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  infos: number;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_TOKEN_RE = /(?:references|scripts|assets|rules|templates)\/[A-Za-z0-9_./-]+/g;
const TIME_RE =
  /\b(?:before|after|until|as of|since)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|20\d\d)\b|\b(?:the latest version|currently the|as of today)\b/i;

export function lint(doc: SkillDoc, options: LintOptions = {}): LintResult {
  const compiled = options.compiled ?? compile(doc);
  const ctx = new Ctx(doc, { profile: compiled.report.profile });
  const entry = ctx.entry;
  const profile = ctx.profile;
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const push = (rule: string, severity: Severity, message: string, nodeId?: string) => {
    const key = `${rule}|${nodeId ?? ''}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ rule, severity, message, nodeId });
  };
  for (const d of compiled.report.diagnostics) push(d.rule, d.severity, d.message, d.nodeId);

  lintFrontmatter(entry, profile, compiled, options, ctx, push);
  lintBody(compiled, entry, profile, push);
  lintGraph(ctx, entry, push);
  lintStyle(ctx, entry, compiled, push);

  const errors = out.filter((d) => d.severity === 'error').length;
  const warnings = out.filter((d) => d.severity === 'warning').length;
  return { diagnostics: out, errors, warnings, infos: out.length - errors - warnings };
}

type Push = (rule: string, severity: Severity, message: string, nodeId?: string) => void;

function lintFrontmatter(
  entry: EntryNodeT,
  profile: string,
  compiled: CompileResult,
  options: LintOptions,
  ctx: Ctx,
  push: Push,
): void {
  const id = entry.id;
  if (!NAME_RE.test(entry.name) || entry.name.length > 64) {
    push(
      'spec/name-format',
      'error',
      `name "${entry.name}" must be 1-64 lowercase letters, digits and single hyphens`,
      id,
    );
  }
  if (options.dirName && options.dirName !== entry.name) {
    push(
      'spec/name-matches-dir',
      'error',
      `name "${entry.name}" must equal the folder name "${options.dirName}"`,
      id,
    );
  }
  const desc = compiledDescription(ctx, entry);
  if (desc.length === 0) push('spec/description-length', 'error', 'description is required', id);
  else if (desc.length > 1024)
    push(
      'spec/description-length',
      'error',
      `description is ${desc.length} chars; the limit is 1024`,
      id,
    );
  const whenToUse = entry.claudeCode?.whenToUse;
  if (typeof whenToUse === 'string' && desc.length + whenToUse.length > 1536) {
    push(
      'spec/description-length',
      'info',
      'description + when_to_use exceed 1536 chars; Claude Code truncates the combined text',
      id,
    );
  }
  if (/[<>]/.test(desc)) {
    push(
      'spec/description-angle-brackets',
      profile === 'universal' ? 'error' : 'warning',
      'description contains < or >, which claude.ai packaging rejects',
      id,
    );
  }
  if (entry.compatibility && entry.compatibility.length > 500) {
    push('spec/compat-length', 'error', 'compatibility must be at most 500 characters', id);
  }
  if (entry.metadata) {
    for (const [k, v] of Object.entries(entry.metadata)) {
      if (typeof v !== 'string') {
        push(
          'spec/metadata-string-map',
          profile === 'universal' ? 'error' : 'warning',
          `metadata.${k} must be a string`,
          id,
        );
      }
    }
  }
  const cc = (entry.claudeCode ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(cc)) {
    if (cc[k] === undefined) continue;
    const yamlKey = FIELD_TO_YAML.get(k) ?? k;
    if (profile === 'universal') {
      push(
        'spec/unknown-frontmatter',
        'error',
        `frontmatter key "${yamlKey}" is not part of the Agent Skills spec (dropped under the universal profile)`,
        id,
      );
    } else if (!FIELD_TO_YAML.has(k)) {
      push(
        'spec/unknown-frontmatter',
        'info',
        `frontmatter key "${yamlKey}" is not a known Claude Code field; passed through verbatim`,
        id,
      );
    }
  }
  if (profile === 'universal' && entry.allowedToolsRaw && entry.allowedToolsRaw.includes(',')) {
    push(
      'spec/allowed-tools-format',
      'warning',
      'allowed-tools should be space-separated under the universal profile',
      id,
    );
  }
  void compiled;
}

function lintBody(compiled: CompileResult, entry: EntryNodeT, profile: string, push: Push): void {
  const { lines, tokens, budget } = compiled.report;
  const md = compiled.skillMd;
  if (lines > budget.lines)
    push(
      'body/max-lines',
      'error',
      `SKILL.md is ${lines} lines; keep it under ${budget.lines}`,
      entry.id,
    );
  else if (lines >= Math.floor(budget.lines * 0.8))
    push(
      'body/max-lines',
      'warning',
      `SKILL.md is ${lines} lines; approaching the ${budget.lines}-line limit`,
      entry.id,
    );
  if (tokens > budget.tokens)
    push(
      'body/token-budget',
      'warning',
      `SKILL.md is ~${tokens} tokens; keep the body under ~${budget.tokens}`,
      entry.id,
    );

  const emitted = new Set(compiled.report.files);
  const seenPaths = new Set<string>();
  for (const m of md.matchAll(FILE_TOKEN_RE)) {
    const p = m[0].replace(/[.,;:)]+$/, '');
    if (seenPaths.has(p)) continue;
    seenPaths.add(p);
    if (!emitted.has(p) && !p.includes('*') && !/[<>{}]/.test(p)) {
      push(
        'body/file-ref-exists',
        'error',
        `SKILL.md mentions ${p} but no such file is emitted`,
        entry.id,
      );
    }
  }
  if (/\.\.\//.test(md))
    push(
      'body/file-ref-relative',
      'error',
      'SKILL.md references a path outside the skill folder (../)',
      entry.id,
    );
  if (/[A-Za-z]:\\|\\[A-Za-z0-9_]+\\/.test(md))
    push('body/file-ref-relative', 'error', 'Use forward slashes in file paths', entry.id);
  if (/^#{5,}\s/m.test(md))
    push(
      'body/heading-depth',
      'warning',
      'Headings deeper than H4 make the skill hard to scan',
      entry.id,
    );

  if (profile === 'universal' && /\$ARGUMENTS|\$\{CLAUDE_|\$[0-9]\b/.test(md)) {
    push(
      'profile/substitution-literal',
      'warning',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the message names the literal placeholder
      'Claude Code substitutions ($ARGUMENTS, ${CLAUDE_*}) will appear literally in other agents',
      entry.id,
    );
  }
}

function lintGraph(ctx: Ctx, entry: EntryNodeT, push: Push): void {
  const doc = ctx.doc;
  const hasCatalog = doc.nodes.some((n) => n.kind === 'catalog');
  for (const n of doc.nodes) {
    if (!isKnownNode(n)) {
      push('graph/unknown-node-kind', 'error', `Unknown node kind "${n.kind}"`, n.id);
      continue;
    }
    const hidden = hiddenProcedure(n, ctx);
    if (hidden) push('graph/procedure-in-markdown', 'warning', hidden, n.id);
    if (n.kind === 'reference') {
      const r = n as ReferenceNodeT;
      const indexed = entry.referenceIndex !== 'none' || (hasCatalog && r.categoryId);
      if (!ctx.mentioned.has(r.id) && !isInlinedReference(r) && !indexed && r.source !== 'url') {
        push(
          'graph/orphan-reference',
          'warning',
          `${ctx.filePaths.get(r.id) ?? r.path} is emitted but nothing tells the agent when to read it`,
          r.id,
        );
      }
      if (!r.readWhen && r.provenance !== 'import' && !isInlinedReference(r)) {
        push(
          'graph/reference-needs-read-when',
          'info',
          `Say when to read ${ctx.filePaths.get(r.id) ?? r.path}`,
          r.id,
        );
      }
    }
    if (n.kind === 'script') {
      const s = n as ScriptNodeT;
      if (!ctx.mentioned.has(s.id))
        push(
          'graph/orphan-script',
          'warning',
          `${ctx.filePaths.get(s.id) ?? s.path} is emitted but never referenced by a step`,
          s.id,
        );
      if (!s.runWhen && s.provenance !== 'import')
        push(
          'graph/script-needs-run-when',
          'info',
          `Say when to run ${ctx.filePaths.get(s.id) ?? s.path}`,
          s.id,
        );
    }
    if (n.kind === 'loop' && !(n as LoopNodeT).until.trim()) {
      push('graph/loop-needs-until', 'warning', 'Loop has no stop condition', n.id);
    }
    if (n.kind === 'ask_user' && ctx.profile === 'claude-code') {
      const cc = entry.claudeCode ?? {};
      if (cc.context === 'fork' && cc.background !== false) {
        push(
          'profile/ask-user-in-background-fork',
          'warning',
          'ask_user cannot block inside a forked/background skill',
          n.id,
        );
      }
    }
  }
  // Flow connectivity: within a container where edges exist, flag nodes with none.
  const containers = new Set<string | null>(doc.nodes.map((n) => n.parentId ?? null));
  for (const c of containers) {
    const kids = ctx
      .flowChildren(c)
      .filter((k) => k.kind !== 'raw_markdown' && k.kind !== 'guardrail' && k.kind !== 'example');
    if (kids.length < 2) continue;
    const connected = (id: string) =>
      [...ctx.edgesFrom(id), ...ctx.edgesTo(id)].some(
        (e) => e.kind === 'next' || e.kind === 'branch',
      );
    const anyConnected = kids.some((k) => connected(k.id));
    if (!anyConnected) continue;
    for (const k of kids) {
      if (
        !connected(k.id) &&
        FLOW_KINDS.has(k.kind as NodeKind) &&
        k.kind !== 'phase' &&
        k.provenance !== 'import'
      ) {
        push(
          'graph/unreachable-node',
          'info',
          'Not connected to the flow; it is ordered by position only',
          k.id,
        );
      }
    }
  }
  const scripts = doc.nodes.filter((n) => n.kind === 'script');
  if (ctx.profile === 'claude-code' && scripts.length > 0 && !entry.autoAllowScripts) {
    const raw = `${entry.allowedToolsRaw ?? ''} ${entry.allowedTools.join(' ')}`;
    if (!/Bash/.test(raw))
      push(
        'profile/script-not-preapproved',
        'info',
        'Scripts will prompt for permission; set allowed-tools or autoAllowScripts',
        entry.id,
      );
  }
}

function lintStyle(ctx: Ctx, entry: EntryNodeT, compiled: CompileResult, push: Push): void {
  const desc = entry.description;
  const id = entry.id;
  if (/^(i |i'm |you |we |your )/i.test(desc))
    push(
      'style/description-third-person',
      'warning',
      'Write the description in third person ("Extracts…", not "I extract…")',
      id,
    );
  if (
    !/\b(use (this|it|when|whenever|for)|when (the )?user|whenever|trigger|applies when|for (tasks|requests|questions)|should be used)\b/i.test(
      desc,
    )
  ) {
    push(
      'style/description-has-when',
      'warning',
      'Say when to use the skill in the description ("Use when…"); Claude decides from this text alone',
      id,
    );
  }
  for (const t of entry.triggers) {
    if (t && !desc.toLowerCase().includes(t.toLowerCase()))
      push(
        'style/description-has-triggers',
        'info',
        `Trigger phrase "${t}" does not appear in the description`,
        id,
      );
  }
  if (!/\b(whenever|even if|make sure|always use|any time|regardless)\b/i.test(desc)) {
    push(
      'style/description-pushy',
      'info',
      'Claude under-triggers skills; consider a pushier description ("use whenever…, even if…")',
      id,
    );
  }
  const caps = (compiled.skillMd.match(/\b(MUST|NEVER|ALWAYS)\b/g) ?? []).length;
  if (caps > 2)
    push(
      'style/all-caps-must',
      'warning',
      `${caps} ALL-CAPS imperatives; explain why instead of shouting`,
      id,
    );
  const time = compiled.skillMd.match(TIME_RE);
  if (time)
    push('style/time-sensitive', 'warning', `Time-sensitive phrase "${time[0]}" will go stale`, id);
  for (const n of ctx.doc.nodes) {
    if (n.kind !== 'step') continue;
    const s = n as StepNodeT;
    const text = `${s.title ?? ''} ${s.instruction}`.trim();
    if (/^(you should|the agent will|it is important|claude should|the model should)/i.test(text)) {
      push('style/imperative-step', 'info', 'Use the imperative ("Restate the idea…")', s.id);
    }
    if (s.instruction.length > 200 && !s.why && s.provenance !== 'import') {
      push(
        'style/step-has-why',
        'info',
        'Long step without a why; explaining the reason helps the model generalize',
        s.id,
      );
    }
  }
  for (const n of ctx.doc.nodes) {
    if (n.kind === 'reference' && (n as ReferenceNodeT).source === 'inline') {
      const body = (n as ReferenceNodeT).body ?? '';
      if (isInlinedReference(n as ReferenceNodeT) && body.split('\n').length > 40) {
        push(
          'style/inline-reference-too-long',
          'warning',
          'Inlined reference is over 40 lines; emit it as a file instead',
          n.id,
        );
      }
      if (
        !isInlinedReference(n as ReferenceNodeT) &&
        body.split('\n').length > 300 &&
        !/^#{1,3}\s.*(contents|table of contents|index)/im.test(body)
      ) {
        push(
          'disclosure/reference-needs-toc',
          'info',
          `${(n as ReferenceNodeT).path} is over 300 lines; add a table of contents`,
          n.id,
        );
      }
    }
  }
}

/**
 * A procedure hiding inside one node's markdown (see `unpackNode`): every raw_markdown that
 * holds prose or a list, a non-imported step that embeds sub-steps, an AI-written reference that is
 * really the workflow. Imported references are left alone: files on disk are progressive
 * disclosure, not a mistake.
 */
function hiddenProcedure(n: SkillNode, ctx: Ctx): string | null {
  const shape: MarkdownShape | null =
    n.kind === 'raw_markdown' ||
    (n.kind === 'step' && n.provenance !== 'import') ||
    (n.kind === 'reference' && n.provenance === 'ai')
      ? unpackShape(n)
      : null;
  if (!shape) return null;
  switch (n.kind) {
    case 'raw_markdown':
      if (shape.items === 0 && shape.paragraphs === 1 && shape.headings === 0)
        return 'Markdown holds one paragraph; unpack it into a step so it can be edited like the rest';
      return `Markdown holds ${shape.items > 0 ? `${shape.items} list item(s)` : `${shape.paragraphs} paragraph(s)`}; unpack it so each shows as a node on the canvas`;
    case 'reference':
      return `${ctx.filePaths.get(n.id) ?? (n as ReferenceNodeT).path} holds a ${shape.stepItems}-step procedure; unpack it into steps so the workflow shows on the canvas`;
    default:
      return `Instruction embeds ${shape.stepItems} sub-steps; unpack them into their own step nodes`;
  }
}
