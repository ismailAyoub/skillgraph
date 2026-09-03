'use client';

import type { TriggerQuery } from '@skillgraph/ai';
import { Button, Pill } from '@/components/ui';
import { callAi } from '@/lib/ai';
import { useAiPanel } from '@/lib/aiStore';
import { useEditor } from '@/lib/store';
import { Busy, ErrorNote, useAiRun } from './common';

export function DescribePanel({ disabled }: { disabled: boolean }) {
  const file = useEditor((s) => s.file);
  const update = useEditor((s) => s.update);
  const describe = useAiPanel((s) => s.describe);
  const queries = useAiPanel((s) => s.triggerQueries);
  const setValue = useAiPanel((s) => s.set);
  const { busy, error, run } = useAiRun();

  const doc = file?.doc;
  const entry = doc?.nodes.find((n) => n.kind === 'entry');
  const current = entry && 'description' in entry ? (entry.description as string) : '';
  const shown: TriggerQuery[] | null = queries ?? describe?.triggerQueries ?? null;

  const suggest = () => {
    if (!doc) return;
    void run(
      () => callAi('describe', { doc }),
      (result) => {
        setValue('describe', result);
        setValue('triggerQueries', result.triggerQueries);
      },
    );
  };

  const moreQueries = () => {
    if (!doc) return;
    void run(
      () => callAi('trigger-queries', { doc }),
      (result) => setValue('triggerQueries', result),
    );
  };

  return (
    <div className="space-y-2 p-2 text-[11px]">
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={suggest} disabled={disabled || busy || !doc}>
          {describe ? 'Suggest again' : 'Suggest descriptions'}
        </Button>
        {describe && (
          <Button onClick={moreQueries} disabled={disabled || busy}>
            Regenerate queries
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
      {busy && <Busy label="Drafting…" />}
      {current && (
        <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-2 leading-snug">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Current
          </div>
          {current}
        </div>
      )}
      {describe?.candidates.map((c) => (
        <div
          key={c.description}
          className="space-y-1.5 rounded border border-[var(--line)] bg-[var(--card)] p-2"
        >
          <div className="leading-snug">{c.description}</div>
          <div className="leading-snug text-[var(--muted)]">{c.rationale}</div>
          <Button
            variant="primary"
            disabled={!entry}
            onClick={() => entry && update(entry.id, { description: c.description })}
          >
            Use this
          </Button>
        </div>
      ))}
      {shown && shown.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Trigger queries ({shown.length})
            </span>
            <Button onClick={() => navigator.clipboard.writeText(JSON.stringify(shown, null, 2))}>
              Copy JSON
            </Button>
          </div>
          <ul className="space-y-1">
            {shown.map((q) => (
              <li
                key={q.query}
                className="flex items-start gap-1.5 rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1"
              >
                <span className="min-w-0 flex-1 leading-snug">{q.query}</span>
                <Pill tone={q.should_trigger ? 'ok' : 'muted'}>
                  {q.should_trigger ? 'should trigger' : 'should not'}
                </Pill>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
