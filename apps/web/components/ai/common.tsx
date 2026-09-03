'use client';

import type { GraphPatchT, PatchOpT } from '@skillgraph/core';
import { useCallback, useState } from 'react';
import { Button, Pill } from '@/components/ui';
import { AiClientError } from '@/lib/ai';
import { claudeStep, subscriptionHint } from '@/lib/claudeStatus';
import { useEditor } from '@/lib/store';
import { useUi } from '@/lib/uiStore';
import { useAiSettings } from '@/lib/useSettings';

/** One line per op: what it does, to which node, and which keys it touches. */
export function summarizeOp(op: PatchOpT): { kind: string; id: string; keys: string[] } {
  switch (op.op) {
    case 'add':
      return { kind: 'add', id: op.node.id, keys: [op.node.kind] };
    case 'restore':
      return { kind: 'restore', id: op.node.id, keys: [op.node.kind] };
    case 'update':
      return { kind: 'update', id: op.id, keys: Object.keys(op.data) };
    case 'remove':
      return { kind: 'remove', id: op.id, keys: [] };
    case 'move':
      return { kind: 'move', id: op.id, keys: ['parentId', 'order'] };
    case 'addEdge':
      return { kind: 'addEdge', id: op.edge.id, keys: [`${op.edge.source} → ${op.edge.target}`] };
    case 'updateEdge':
      return { kind: 'updateEdge', id: op.id, keys: Object.keys(op.data) };
    case 'removeEdge':
      return { kind: 'removeEdge', id: op.id, keys: [] };
    case 'setProfile':
      return { kind: 'setProfile', id: '—', keys: [op.profile] };
  }
}

export function OpSummary({ patch }: { patch: GraphPatchT }) {
  return (
    <ul className="space-y-0.5 font-mono text-[10px] text-[var(--muted)]">
      {patch.ops.map((op, i) => {
        const s = summarizeOp(op);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ops are positional and never reordered
          <li key={i} className="truncate">
            <span className="font-semibold text-[var(--ink)]">{s.kind}</span> {s.id}
            {s.keys.length > 0 && <span> · {s.keys.join(', ')}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Apply a proposed patch through the editor store, so it lands on the undo stack. */
export function applyPatch(patch: GraphPatchT): void {
  useEditor.getState().dispatch(patch);
}

export function ProposalCard({
  rationale,
  patch,
  onApply,
  onDiscard,
  applyLabel = 'Apply',
}: {
  rationale?: string;
  patch: GraphPatchT;
  onApply: () => void;
  onDiscard?: () => void;
  applyLabel?: string;
}) {
  return (
    <div className="space-y-2 rounded border border-[var(--line)] bg-[var(--card)] p-2">
      {rationale && <p className="leading-snug">{rationale}</p>}
      <OpSummary patch={patch} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={onApply}>
          {applyLabel}
        </Button>
        {onDiscard && <Button onClick={onDiscard}>Discard</Button>}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-[var(--err)]">
      {error}
    </div>
  );
}

export function Busy({ label = 'Thinking…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-[var(--muted)]">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
      {label}
    </div>
  );
}

export function NoKeyHint() {
  const setAiSetupOpen = useUi((s) => s.setAiSetupOpen);
  const { claude } = useAiSettings();
  return (
    <div
      data-testid="ai-no-key"
      className="space-y-1.5 rounded border border-[var(--accent)] bg-[var(--accent-soft)]/40 px-2 py-2 text-[11px]"
    >
      <p className="leading-snug">{subscriptionHint(claudeStep(claude))}</p>
      <Button variant="primary" onClick={() => setAiSetupOpen(true)}>
        Connect AI
      </Button>
    </div>
  );
}

export function SeverityPill({ severity }: { severity: 'error' | 'warning' | 'info' }) {
  const tone = severity === 'error' ? 'err' : severity === 'warning' ? 'warn' : 'muted';
  return <Pill tone={tone}>{severity}</Pill>;
}

/** Runs one AI call at a time and keeps its loading/error state. */
export function useAiRun(): {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: <T>(fn: () => Promise<T>, onDone: (result: T) => void) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, onDone: (result: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (e) {
      setError(e instanceof AiClientError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, clearError: () => setError(null), run };
}
