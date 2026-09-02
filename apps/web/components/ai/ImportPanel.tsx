'use client';

import { Button, Field, TextArea } from '@/components/ui';
import { callAi } from '@/lib/ai';
import { useAiPanel } from '@/lib/aiStore';
import { useEditor } from '@/lib/store';
import { applyPatch, Busy, ErrorNote, ProposalCard, useAiRun } from './common';

export function ImportPanel({ disabled }: { disabled: boolean }) {
  const file = useEditor((s) => s.file);
  const transcript = useAiPanel((s) => s.transcript);
  const proposal = useAiPanel((s) => s.importProposal);
  const recovery = useAiPanel((s) => s.recovery);
  const setValue = useAiPanel((s) => s.set);
  const { busy, error, run } = useAiRun();

  const doc = file?.doc;
  const rawNodes = doc?.nodes.filter((n) => n.kind === 'raw_markdown') ?? [];

  const build = () => {
    if (!doc || !transcript.trim()) return;
    void run(
      () => callAi('from-transcript', { doc, transcript }),
      (result) => setValue('importProposal', result),
    );
  };

  const recover = () => {
    if (!doc) return;
    void run(
      () => callAi('decompile-fallback', { doc, rawNodeIds: rawNodes.map((n) => n.id) }),
      (result) => setValue('recovery', result),
    );
  };

  return (
    <div className="space-y-2 p-2 text-[11px]">
      <Field label="Transcript" hint="paste a chat or a how-to">
        <TextArea
          value={transcript}
          onChange={(e) => setValue('transcript', e.target.value)}
          placeholder="Paste the conversation that taught you this workflow…"
          style={{ minHeight: 120 }}
        />
      </Field>
      <Button
        variant="primary"
        onClick={build}
        disabled={disabled || busy || !doc || !transcript.trim()}
      >
        Turn into graph nodes
      </Button>
      <ErrorNote error={error} />
      {busy && <Busy label="Reading…" />}
      {proposal && !busy && (
        <ProposalCard
          rationale={proposal.rationale}
          patch={proposal.patch}
          onApply={() => {
            applyPatch(proposal.patch);
            setValue('importProposal', null);
          }}
          onDiscard={() => setValue('importProposal', null)}
        />
      )}
      {rawNodes.length > 0 && (
        <div className="space-y-1.5 border-t border-[var(--line)] pt-2">
          <div className="text-[var(--muted)]">
            {rawNodes.length} raw markdown node(s) survived the import unstructured.
          </div>
          <Button onClick={recover} disabled={disabled || busy}>
            Recover raw markdown
          </Button>
          {recovery && !busy && (
            <ProposalCard
              rationale={recovery.rationale}
              patch={recovery.patch}
              onApply={() => {
                applyPatch(recovery.patch);
                setValue('recovery', null);
              }}
              onDiscard={() => setValue('recovery', null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
