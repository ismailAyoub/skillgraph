'use client';

import { Ctx, toMermaid } from '@skillgraph/core';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AiPanel } from '@/components/ai/AiPanel';
import { Button, Pill, Tabs } from '@/components/ui';
import { useEditor } from '@/lib/store';
import { type PreviewTab as Tab, useUi } from '@/lib/uiStore';

export function Preview() {
  const compiled = useEditor((s) => s.compiled);
  const lintResult = useEditor((s) => s.lintResult);
  const file = useEditor((s) => s.file);
  const select = useEditor((s) => s.select);
  const tab = useUi((s) => s.previewTab);
  const setTab = useUi((s) => s.setPreviewTab);
  const [activeFile, setActiveFile] = useState<string>('SKILL.md');

  const mermaid = useMemo(() => (file ? toMermaid(new Ctx(file.doc)) : ''), [file]);
  if (!compiled) return null;
  const body = compiled.skillMd.replace(/^---[\s\S]*?---\n/, '');
  const errs = lintResult?.errors ?? 0;
  const warns = lintResult?.warnings ?? 0;

  return (
    <div className="flex h-full flex-col">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'rendered', label: 'Preview' },
          { id: 'raw', label: 'SKILL.md' },
          { id: 'files', label: `Files (${compiled.report.files.length})` },
          {
            id: 'lint',
            label: (
              <span className="flex items-center gap-1">
                Lint
                {errs > 0 && <Pill tone="err">{errs}</Pill>}
                {warns > 0 && <Pill tone="warn">{warns}</Pill>}
              </span>
            ),
          },
          { id: 'diagram', label: 'Diagram' },
          { id: 'ai', label: 'AI' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'rendered' && (
          <div className="prose-preview p-3 text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        )}
        {tab === 'raw' && (
          <pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-snug">
            {compiled.skillMd}
          </pre>
        )}
        {tab === 'files' && (
          <div className="flex h-full">
            <div className="w-44 shrink-0 border-r border-[var(--line)] p-2 text-[11px]">
              {compiled.report.files.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActiveFile(p)}
                  className={`block w-full truncate rounded px-1.5 py-1 text-left font-mono ${activeFile === p ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'hover:bg-[var(--panel)]'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <pre className="min-w-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-snug">
              {compiled.files[activeFile] ?? (compiled.binaryFiles[activeFile] ? '(binary)' : '')}
            </pre>
          </div>
        )}
        {tab === 'lint' && (
          <div className="space-y-1 p-2 text-[11px]">
            {(lintResult?.diagnostics.length ?? 0) === 0 && (
              <div className="p-2 text-[var(--muted)]">No findings. Nice.</div>
            )}
            {lintResult?.diagnostics.map((d) => (
              <button
                key={`${d.rule}-${d.nodeId}-${d.message}`}
                type="button"
                onClick={() => d.nodeId && select(d.nodeId)}
                className="block w-full rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-left hover:border-[var(--accent)]"
              >
                <span className={`font-semibold sg-diag-${d.severity}`}>{d.severity}</span>{' '}
                <span className="font-mono text-[var(--muted)]">{d.rule}</span>
                <div>{d.message}</div>
              </button>
            ))}
          </div>
        )}
        {tab === 'ai' && <AiPanel />}
        {tab === 'diagram' && (
          <div className="p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
              Mermaid source of the flow.
              <Button onClick={() => navigator.clipboard.writeText(mermaid)}>Copy</Button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[11px]">{mermaid}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
