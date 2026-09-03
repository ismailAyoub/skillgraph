'use client';

import {
  type CatalogNodeT,
  type ChecklistNodeT,
  type MarkdownShape,
  type NodeKind,
  type SkillEdge,
  type SkillNode,
  unpackNode,
  unpackShape,
} from '@skillgraph/core';
import { Trash2, Ungroup } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Input, Pill, Select, TextArea, Toggle } from '@/components/ui';
import { KIND_META, nodeTitle } from '@/lib/nodeMeta';
import { useEditor } from '@/lib/store';
import { placeUnpacked } from '@/lib/unpackPlace';
import { CodeEditor } from './CodeEditor';

type FieldSpec =
  | {
      key: string;
      label: string;
      type: 'text' | 'textarea' | 'number';
      hint?: string;
      placeholder?: string;
    }
  | {
      key: string;
      label: string;
      type: 'markdown' | 'code';
      hint?: string;
      langKey?: string;
      lang?: string;
    }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      hint?: string;
      allowEmpty?: boolean;
    }
  | { key: string; label: string; type: 'toggle'; hint?: string }
  | { key: string; label: string; type: 'list'; hint?: string; placeholder?: string };

const sel = (
  key: string,
  label: string,
  options: string[],
  hint?: string,
  allowEmpty = false,
): FieldSpec => ({
  key,
  label,
  type: 'select',
  options: options.map((o) => ({ value: o, label: o })),
  hint,
  allowEmpty,
});

const FIELDS: Partial<Record<NodeKind, FieldSpec[]>> = {
  entry: [
    { key: 'name', label: 'Name', type: 'text', hint: 'kebab-case, equals folder name' },
    { key: 'title', label: 'Title (H1)', type: 'text' },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      hint: 'what + when; ≤1024 chars',
    },
    {
      key: 'triggers',
      label: 'Trigger phrases',
      type: 'list',
      hint: 'used by evals; keep them in the description',
    },
    {
      key: 'negativeTriggers',
      label: 'Do not use for',
      type: 'list',
      hint: 'compiled into the description',
    },
    { key: 'summary', label: 'Summary (after H1)', type: 'markdown' },
    sel('overview', 'How It Works section', ['none', 'auto'], 'auto = one line per phase'),
    { key: 'usage', label: 'Usage section', type: 'markdown' },
    sel(
      'referenceIndex',
      'Reference index',
      ['unmentioned', 'all', 'none'],
      'list files the body never mentions',
    ),
    { key: 'license', label: 'License', type: 'text' },
    {
      key: 'compatibility',
      label: 'Compatibility',
      type: 'text',
      hint: '≤500 chars, only if needed',
    },
    { key: 'allowedTools', label: 'Allowed tools', type: 'list', placeholder: 'Bash(git:*)' },
    { key: 'autoAllowScripts', label: 'Pre-approve bundled scripts (Claude Code)', type: 'toggle' },
    {
      key: 'claudeCode.argumentHint',
      label: 'Argument hint (Claude Code)',
      type: 'text',
      placeholder: '<file-or-pattern>',
    },
    { key: 'claudeCode.whenToUse', label: 'when_to_use (Claude Code)', type: 'textarea' },
    sel('claudeCode.model', 'Model (Claude Code)', ['opus', 'sonnet', 'haiku'], undefined, true),
    sel('claudeCode.effort', 'Effort (Claude Code)', ['low', 'medium', 'high'], undefined, true),
    sel('claudeCode.context', 'Context (Claude Code)', ['fork'], 'fork = run in a subagent', true),
    {
      key: 'claudeCode.disableModelInvocation',
      label: 'User-invoked only (disable-model-invocation)',
      type: 'toggle',
    },
    { key: 'claudeCode.userInvocable', label: 'Show in /help (user-invocable)', type: 'toggle' },
  ],
  phase: [
    { key: 'title', label: 'Heading', type: 'text' },
    {
      key: 'summary',
      label: 'One-line summary',
      type: 'text',
      hint: 'used by the How It Works overview',
    },
    { key: 'intro', label: 'Intro paragraph', type: 'markdown' },
    sel('stepStyle', 'Step style', ['numbered', 'bulleted', 'prose']),
  ],
  step: [
    { key: 'title', label: 'Bold lead', type: 'text', hint: 'e.g. "Restate the idea"' },
    { key: 'instruction', label: 'Instruction', type: 'markdown', hint: 'continues the sentence' },
    { key: 'why', label: 'Why', type: 'textarea', hint: 'a plain sentence, not a MUST' },
    { key: 'detail', label: 'Sub-bullets', type: 'list' },
    {
      key: 'tools',
      label: 'Tool hints',
      type: 'list',
      hint: 'for traces; not rendered unless toggled',
    },
    { key: 'mentionTools', label: 'Mention tools in text', type: 'toggle' },
  ],
  decision: [
    { key: 'question', label: 'Question', type: 'text' },
    { key: 'intro', label: 'Intro', type: 'markdown' },
  ],
  loop: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'until', label: 'Repeat until', type: 'text' },
    { key: 'maxIterations', label: 'Max rounds', type: 'number' },
    { key: 'intro', label: 'Intro', type: 'markdown' },
    { key: 'why', label: 'Why stop there', type: 'textarea' },
  ],
  ask_user: [
    { key: 'title', label: 'Bold lead', type: 'text' },
    { key: 'question', label: 'Question', type: 'textarea' },
    { key: 'options', label: 'Options', type: 'list' },
    { key: 'blocking', label: 'Wait for the answer', type: 'toggle' },
    { key: 'why', label: 'Why', type: 'textarea' },
  ],
  reference: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'path', label: 'Path', type: 'text', hint: 'references/<name>.md' },
    sel('source', 'Source', ['inline', 'url', 'external']),
    { key: 'url', label: 'URL (source = url)', type: 'text' },
    { key: 'summary', label: 'What it contains', type: 'text', hint: '"Read … for <summary>"' },
    { key: 'readWhen', label: 'Read when', type: 'text' },
    sel('inline', 'Inline in SKILL.md', ['never', 'auto', 'always'], 'auto inlines ≤12 lines'),
    { key: 'categoryId', label: 'Catalog category id', type: 'text' },
    { key: 'body', label: 'Content', type: 'code', lang: 'markdown' },
  ],
  catalog: [
    { key: 'title', label: 'Heading', type: 'text' },
    { key: 'intro', label: 'Intro', type: 'markdown' },
    sel('quickReference', 'Quick reference list', ['auto', 'none']),
  ],
  script: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'path', label: 'Path', type: 'text', hint: 'scripts/<name>' },
    sel(
      'language',
      'Language',
      ['bash', 'python', 'javascript', 'typescript', 'ruby'],
      undefined,
      true,
    ),
    { key: 'runWhen', label: 'Run to…', type: 'text', hint: '"Run scripts/x.sh to <this>"' },
    { key: 'args', label: 'Arguments', type: 'list' },
    { key: 'usage', label: 'Usage snippet', type: 'code', lang: 'bash' },
    { key: 'code', label: 'Source', type: 'code', langKey: 'language' },
  ],
  asset: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'path', label: 'Path', type: 'text', hint: 'assets/<name>' },
    { key: 'usedFor', label: 'Used for', type: 'text' },
    { key: 'content', label: 'Content', type: 'code' },
  ],
  output_format: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'intro', label: 'Intro', type: 'markdown' },
    sel('strictness', 'Strictness', ['exact', 'guide'], undefined, true),
    { key: 'format', label: 'Fence language', type: 'text', placeholder: 'markdown' },
    { key: 'destination', label: 'Save to', type: 'text', placeholder: 'docs/report.md' },
    { key: 'template', label: 'Template', type: 'code', langKey: 'format' },
  ],
  guardrail: [
    sel('polarity', 'Polarity', ['do', 'dont']),
    { key: 'text', label: 'Bold lead', type: 'text', hint: 'e.g. "Don\'t generate 20+ ideas."' },
    { key: 'why', label: 'Why', type: 'textarea' },
  ],
  example: [
    { key: 'label', label: 'Label', type: 'text', placeholder: '1' },
    { key: 'input', label: 'Input', type: 'textarea' },
    { key: 'output', label: 'Output', type: 'textarea' },
    { key: 'commentary', label: 'Commentary', type: 'markdown' },
  ],
  checklist: [
    { key: 'title', label: 'Heading', type: 'text' },
    sel('variant', 'Variant', ['verification', 'red-flags', 'custom']),
    sel('style', 'Style', ['task', 'bullet']),
  ],
  delegate: [
    { key: 'title', label: 'Bold lead', type: 'text' },
    { key: 'agentType', label: 'Agent type', type: 'text', placeholder: 'Explore' },
    { key: 'task', label: 'Task', type: 'textarea' },
    { key: 'parallel', label: 'Run in parallel', type: 'toggle' },
    { key: 'returns', label: 'Should return', type: 'text' },
  ],
  skill_call: [
    { key: 'title', label: 'Bold lead', type: 'text' },
    { key: 'skill', label: 'Skill name', type: 'text' },
    { key: 'args', label: 'Arguments', type: 'text' },
    { key: 'when', label: 'When', type: 'text' },
  ],
  inject: [
    { key: 'label', label: 'Label', type: 'text' },
    { key: 'command', label: 'Command', type: 'code', lang: 'bash' },
    { key: 'multiline', label: 'Multiline block', type: 'toggle' },
  ],
  raw_markdown: [{ key: 'body', label: 'Markdown', type: 'code', lang: 'markdown' }],
  note: [{ key: 'body', label: 'Note', type: 'textarea' }],
};

function getPath(obj: Record<string, unknown>, key: string): unknown {
  const [a, b] = key.split('.');
  if (!b) return obj[a as string];
  const inner = obj[a as string];
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>)[b] : undefined;
}

function ListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-1">
      {value.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are positional and may repeat
        <div key={`${i}-${v}`} className="flex items-center gap-1">
          <Input
            value={v}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button
            variant="ghost"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            title="Remove"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          placeholder={placeholder ?? 'Add…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onChange([...value, draft.trim()]);
              setDraft('');
            }
          }}
        />
        <Button
          onClick={() => {
            if (draft.trim()) {
              onChange([...value, draft.trim()]);
              setDraft('');
            }
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function FieldControl({ node, spec }: { node: SkillNode; spec: FieldSpec }) {
  const update = useEditor((s) => s.update);
  const record = node as unknown as Record<string, unknown>;
  const value = getPath(record, spec.key);
  const setValue = (v: unknown) => {
    const [a, b] = spec.key.split('.');
    if (b) {
      const inner = { ...((record[a as string] as Record<string, unknown>) ?? {}) };
      if (v === '' || v === undefined || v === false) delete inner[b];
      else inner[b] = v;
      update(node.id, { [a as string]: Object.keys(inner).length ? inner : undefined });
    } else {
      update(node.id, { [spec.key]: v === '' ? undefined : v });
    }
  };
  switch (spec.type) {
    case 'text':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <Input
            value={(value as string) ?? ''}
            placeholder={spec.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      );
    case 'number':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <Input
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => setValue(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </Field>
      );
    case 'textarea':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <TextArea
            value={(value as string) ?? ''}
            placeholder={spec.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      );
    case 'markdown':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <CodeEditor
            value={(value as string) ?? ''}
            lang="markdown"
            minHeight="80px"
            onChange={(v) => setValue(v)}
          />
        </Field>
      );
    case 'code': {
      const lang = spec.langKey ? (record[spec.langKey] as string | undefined) : spec.lang;
      return (
        <Field label={spec.label} hint={spec.hint}>
          <CodeEditor
            value={(value as string) ?? ''}
            lang={lang}
            minHeight="140px"
            onChange={(v) => setValue(v)}
          />
        </Field>
      );
    }
    case 'select':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <Select value={(value as string) ?? ''} onChange={(e) => setValue(e.target.value)}>
            {spec.allowEmpty && <option value="">(not set)</option>}
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'toggle':
      return <Toggle checked={Boolean(value)} onChange={(v) => setValue(v)} label={spec.label} />;
    case 'list':
      return (
        <Field label={spec.label} hint={spec.hint}>
          <ListEditor
            value={(value as string[]) ?? []}
            placeholder={spec.placeholder}
            onChange={(v) => setValue(v)}
          />
        </Field>
      );
  }
}

function ChecklistItemsEditor({ node }: { node: ChecklistNodeT }) {
  const update = useEditor((s) => s.update);
  const items = node.items;
  const setItems = (next: typeof items) => update(node.id, { items: next });
  const [draft, setDraft] = useState('');
  return (
    <Field label="Items" hint="text, then an optional why">
      <div className="space-y-1">
        {items.map((it, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items are positional and may repeat
          <div key={`${i}-${it.text}`} className="flex items-start gap-1">
            <div className="flex-1 space-y-1">
              <Input
                value={it.text}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
              />
              <Input
                value={it.why ?? ''}
                placeholder="why (optional)"
                onChange={(e) =>
                  setItems(
                    items.map((x, j) => (j === i ? { ...x, why: e.target.value || undefined } : x)),
                  )
                }
              />
            </div>
            <Button variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        <div className="flex gap-1">
          <Input
            value={draft}
            placeholder="Add item…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                setItems([...items, { text: draft.trim() }]);
                setDraft('');
              }
            }}
          />
          <Button
            onClick={() => {
              if (draft.trim()) {
                setItems([...items, { text: draft.trim() }]);
                setDraft('');
              }
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Field>
  );
}

function CategoriesEditor({ node }: { node: CatalogNodeT }) {
  const update = useEditor((s) => s.update);
  const cats = node.categories;
  const set = (next: typeof cats) => update(node.id, { categories: next });
  return (
    <Field label="Categories" hint="name · impact · file prefix">
      <div className="space-y-1">
        {cats.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[1fr_80px_80px_auto] gap-1">
            <Input
              value={c.name}
              onChange={(e) =>
                set(cats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <Input
              value={c.impact ?? ''}
              placeholder="HIGH"
              onChange={(e) =>
                set(
                  cats.map((x, j) => (j === i ? { ...x, impact: e.target.value || undefined } : x)),
                )
              }
            />
            <Input
              value={c.prefix}
              placeholder="perf-"
              onChange={(e) =>
                set(cats.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)))
              }
            />
            <Button variant="ghost" onClick={() => set(cats.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        <Button
          onClick={() =>
            set([...cats, { id: `cat-${cats.length + 1}`, name: 'New category', prefix: 'new-' }])
          }
        >
          Add category
        </Button>
      </div>
    </Field>
  );
}

function EdgesSection({ node }: { node: SkillNode }) {
  const file = useEditor((s) => s.file);
  const dispatch = useEditor((s) => s.dispatch);
  const removeEdge = useEditor((s) => s.removeEdge);
  const select = useEditor((s) => s.select);
  if (!file) return null;
  const byId = new Map(file.doc.nodes.map((n) => [n.id, n]));
  const outgoing = file.doc.edges.filter((e) => e.source === node.id);
  const incoming = file.doc.edges.filter((e) => e.target === node.id);
  if (outgoing.length === 0 && incoming.length === 0) return null;
  const row = (e: SkillEdge, other: SkillNode | undefined, dir: 'out' | 'in') => (
    <div
      key={e.id}
      className="flex items-center gap-1 rounded border border-[var(--line)] px-1.5 py-1"
    >
      <Pill tone={e.kind === 'branch' ? 'warn' : e.kind === 'next' ? 'muted' : 'accent'}>
        {e.kind}
      </Pill>
      {e.kind === 'branch' && dir === 'out' ? (
        <Input
          value={e.label ?? ''}
          placeholder="branch label"
          onChange={(ev) =>
            dispatch(
              { ops: [{ op: 'updateEdge', id: e.id, data: { label: ev.target.value } }] },
              { coalesceKey: `edge:${e.id}` },
            )
          }
        />
      ) : null}
      <button
        type="button"
        className="flex-1 truncate text-left hover:underline"
        onClick={() => other && select(other.id)}
      >
        {dir === 'out' ? '→ ' : '← '}
        {other ? nodeTitle(other) : '?'}
      </button>
      <Button variant="ghost" onClick={() => removeEdge(e.id)} title="Remove edge">
        <Trash2 size={12} />
      </Button>
    </div>
  );
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--faint)]">
        Connections
      </div>
      {outgoing.map((e) => row(e, byId.get(e.target), 'out'))}
      {incoming.map((e) => row(e, byId.get(e.source), 'in'))}
    </div>
  );
}

/** What the unpack button would turn into nodes, in the user's words. */
function unpackHint(node: SkillNode, shape: MarkdownShape): string {
  switch (node.kind) {
    case 'reference':
      return `A ${shape.stepItems}-step procedure is hiding inside this file.`;
    case 'step':
      return `${shape.stepItems} sub-steps are hiding inside this instruction.`;
    default:
      if (shape.items > 0) return `${shape.items} list item(s) are hiding inside this markdown.`;
      return shape.paragraphs === 1
        ? 'This markdown is one paragraph; as a step it gets a title, a why and a place in the flow.'
        : `${shape.paragraphs} paragraph(s) are hiding inside this markdown.`;
  }
}

export function Inspector() {
  const file = useEditor((s) => s.file);
  const selectedId = useEditor((s) => s.selectedId);
  const removeNode = useEditor((s) => s.removeNode);
  const dispatch = useEditor((s) => s.dispatch);
  const setLayout = useEditor((s) => s.setLayout);
  const select = useEditor((s) => s.select);
  const lintResult = useEditor((s) => s.lintResult);
  const [unpackError, setUnpackError] = useState<string | null>(null);
  const node =
    file?.doc.nodes.find((n) => n.id === (selectedId ?? 'entry_root')) ??
    file?.doc.nodes.find((n) => n.kind === 'entry');
  if (!file || !node) return <div className="p-3 text-xs text-[var(--muted)]">Select a node.</div>;
  const meta = KIND_META[node.kind as NodeKind];
  const specs = FIELDS[node.kind as NodeKind] ?? [];
  const issues = (lintResult?.diagnostics ?? []).filter((d) => d.nodeId === node.id);
  const shape = unpackShape(node);
  const unpack = () => {
    try {
      const patch = unpackNode(file.doc, node.id);
      const boxes = placeUnpacked(file, patch);
      dispatch(patch);
      setLayout(boxes);
      const first = patch.ops.find((op) => op.op === 'add');
      select(first && first.op === 'add' ? first.node.id : null);
      setUnpackError(null);
    } catch (e) {
      // A rejected patch leaves the graph untouched; say so here rather than blanking the editor.
      setUnpackError((e as Error).message);
    }
  };
  return (
    <div className="space-y-3.5 p-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta?.color }} />
        <div className="font-serif text-[17px] font-medium">{meta?.label ?? node.kind}</div>
        <span className="ml-auto font-mono text-[10.5px] text-[var(--faint)]">{node.id}</span>
        {node.kind !== 'entry' && (
          <Button variant="danger" onClick={() => removeNode(node.id)} title="Delete node">
            <Trash2 size={12} />
          </Button>
        )}
      </div>
      {issues.length > 0 && (
        <div className="space-y-0.5 rounded-md border border-[var(--line)] bg-[var(--panel)] p-2 text-[11px]">
          {issues.map((d) => (
            <div key={`${d.rule}-${d.message}`} className={`sg-diag-${d.severity}`}>
              <span className="font-mono">{d.rule}</span> {d.message}
            </div>
          ))}
        </div>
      )}
      {shape && (
        <div
          className="flex items-center gap-2 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1.5 text-[11px] leading-snug"
          data-testid="unpack-hint"
        >
          <span className="flex-1">{unpackHint(node, shape)}</span>
          <Button
            onClick={unpack}
            data-testid="unpack-node"
            title="Turn this markdown into step nodes on the canvas (undoable)"
          >
            <Ungroup size={12} /> Unpack into nodes
          </Button>
        </div>
      )}
      {unpackError && (
        <div className="rounded-md border border-[var(--err)] px-2 py-1.5 text-[11px] leading-snug text-[var(--err)]">
          Could not unpack this node: {unpackError}
        </div>
      )}
      {specs.map((spec) => (
        <FieldControl key={spec.key} node={node} spec={spec} />
      ))}
      {node.kind === 'checklist' && <ChecklistItemsEditor node={node as ChecklistNodeT} />}
      {node.kind === 'catalog' && <CategoriesEditor node={node as CatalogNodeT} />}
      <EdgesSection node={node} />
    </div>
  );
}
