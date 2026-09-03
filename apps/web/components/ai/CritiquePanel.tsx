'use client';

import type { CritiqueFinding } from '@skillgraph/ai';
import { Button } from '@/components/ui';
import { callAi } from '@/lib/ai';
import { useAiPanel } from '@/lib/aiStore';
import { useEditor } from '@/lib/store';
import { applyPatch, Busy, ErrorNote, OpSummary, SeverityPill, useAiRun } from './common';

function findingKey(f: CritiqueFinding): string {
  return `${f.rule}:${f.nodeId ?? ''}:${f.message}`;
}

export function CritiquePanel({ disabled }: { disabled: boolean }) {
  const file = useEditor((s) => s.file);
  const compiled = useEditor((s) => s.compiled);
  const lintResult = useEditor((s) => s.lintResult);
  const select = useEditor((s) => s.select);
  const critique = useAiPanel((s) => s.critique);
  const dismissed = useAiPanel((s) => s.dismissed);
  const setValue = useAiPanel((s) => s.set);
  const dismiss = useAiPanel((s) => s.dismiss);
  const { busy, error, run } = useAiRun();

  const doc = file?.doc;
  const findings = (critique?.findings ?? []).filter((f) => !dismissed.includes(findingKey(f)));
  const patched = findings.filter((f) => f.patch);

  const review = () => {
    if (!doc || !compiled) return;
    void run(
      () => callAi('critique', { doc, compiled, lints: lintResult?.diagnostics }),
      (result) => setValue('critique', result),
    );
  };

  const applyAll = () => {
    const ops = patched.flatMap((f) => f.patch?.ops ?? []);
    if (!ops.length) return;
    applyPatch({ ops });
    for (const f of patched) dismiss(findingKey(f));
  };

  return (
    <div className="space-y-2 p-2 text-[11px]">
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={review} disabled={disabled || busy || !doc}>
          {critique ? 'Review again' : 'Review this skill'}
        </Button>
        {patched.length > 1 && (
          <Button onClick={applyAll} disabled={disabled || busy}>
            Apply all ({patched.length})
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
      {busy && <Busy label="Reviewing…" />}
      {critique && !busy && (
        <>
          <p className="leading-snug text-[var(--muted)]">{critique.summary}</p>
          {findings.length === 0 && (
            <div className="py-2 text-[var(--muted)]">No open findings.</div>
          )}
          {findings.map((f) => {
            const key = findingKey(f);
            return (
              <div
                key={key}
                className="space-y-1.5 rounded border border-[var(--line)] bg-[var(--card)] p-2"
              >
                <div className="flex items-center gap-1.5">
                  <SeverityPill severity={f.severity} />
                  <span className="font-mono text-[10px] text-[var(--muted)]">{f.rule}</span>
                  {f.nodeId && (
                    <button
                      type="button"
                      onClick={() => f.nodeId && select(f.nodeId)}
                      className="ml-auto font-mono text-[10px] text-[var(--accent)] hover:underline"
                    >
                      {f.nodeId}
                    </button>
                  )}
                </div>
                <div className="leading-snug">{f.message}</div>
                {f.patch && <OpSummary patch={f.patch} />}
                <div className="flex gap-2">
                  {f.patch && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (f.patch) applyPatch(f.patch);
                        dismiss(key);
                      }}
                    >
                      Apply
                    </Button>
                  )}
                  <Button onClick={() => dismiss(key)}>Dismiss</Button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
