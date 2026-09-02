'use client';

import type { InterviewStep, InterviewTurn } from '@skillgraph/ai';
import { Button, Pill, TextArea } from '@/components/ui';
import { callAi } from '@/lib/ai';
import { useAiPanel } from '@/lib/aiStore';
import { useEditor } from '@/lib/store';
import { applyPatch, Busy, ErrorNote, OpSummary, useAiRun } from './common';

export function InterviewPanel({ disabled }: { disabled: boolean }) {
  const file = useEditor((s) => s.file);
  const undo = useEditor((s) => s.undo);
  const turns = useAiPanel((s) => s.interviewTurns);
  const step = useAiPanel((s) => s.interviewStep);
  const draft = useAiPanel((s) => s.interviewDraft);
  const setValue = useAiPanel((s) => s.set);
  const { busy, error, run } = useAiRun();

  const doc = file?.doc;

  /** Ask for the next step. Any patch it carries is applied right away (and is undoable). */
  const advance = (transcript: InterviewTurn[]) => {
    if (!doc) return;
    setValue('interviewTurns', transcript);
    void run(
      () => callAi('interview', { doc, transcript }),
      (result: InterviewStep) => {
        if (result.patch) applyPatch(result.patch);
        setValue('interviewStep', result);
        if (result.question) {
          setValue('interviewTurns', [
            ...transcript,
            { role: 'assistant', content: result.question },
          ]);
        }
      },
    );
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setValue('interviewDraft', '');
    advance([...turns, { role: 'user', content: text }]);
  };

  const reset = () => {
    setValue('interviewTurns', []);
    setValue('interviewStep', null);
    setValue('interviewDraft', '');
  };

  return (
    <div className="space-y-2 p-2 text-[11px]">
      {turns.length === 0 && !step && (
        <p className="leading-snug text-[var(--muted)]">
          The model asks one question at a time and edits the graph as you answer. Every edit lands
          on the undo stack.
        </p>
      )}
      <div className="space-y-1.5">
        {turns.map((t, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
            key={i}
            className={`rounded border px-2 py-1.5 leading-snug ${
              t.role === 'assistant'
                ? 'border-[var(--line)] bg-white'
                : 'border-transparent bg-[var(--accent-soft)] text-[var(--accent)]'
            }`}
          >
            {t.content}
          </div>
        ))}
      </div>
      {busy && <Busy label="Listening…" />}
      <ErrorNote error={error} />
      {step && !busy && (
        <div className="space-y-1.5 rounded border border-[var(--line)] bg-neutral-50 p-2">
          <div className="flex items-center gap-2">
            <Pill tone={step.confidence >= 0.7 ? 'ok' : step.confidence >= 0.4 ? 'warn' : 'muted'}>
              confidence {Math.round(step.confidence * 100)}%
            </Pill>
            {step.done && <Pill tone="accent">done</Pill>}
          </div>
          {step.rationale && <div className="leading-snug">{step.rationale}</div>}
          {step.patch && <OpSummary patch={step.patch} />}
          {step.patch && (
            <Button onClick={undo} title="Revert the edit this step applied">
              Undo last step
            </Button>
          )}
        </div>
      )}
      {turns.length === 0 && !step ? (
        <Button variant="primary" onClick={() => advance([])} disabled={disabled || busy || !doc}>
          Start interview
        </Button>
      ) : (
        <div className="space-y-1.5">
          {!step?.done && (
            <>
              <TextArea
                value={draft}
                onChange={(e) => setValue('interviewDraft', e.target.value)}
                placeholder="Your answer…"
                disabled={disabled || busy}
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={send}
                  disabled={disabled || busy || !draft.trim()}
                >
                  Send
                </Button>
                <Button onClick={reset}>Restart</Button>
              </div>
            </>
          )}
          {step?.done && <Button onClick={reset}>Start over</Button>}
        </div>
      )}
    </div>
  );
}
