'use client';

import type { CopilotIntent } from '@skillgraph/ai';
import { useState } from 'react';
import { Button, Field, Select, TextArea } from '@/components/ui';
import { callAi } from '@/lib/ai';
import { useAiPanel } from '@/lib/aiStore';
import { useEditor } from '@/lib/store';
import { applyPatch, Busy, ErrorNote, ProposalCard, useAiRun } from './common';

const INTENTS: { id: CopilotIntent; label: string }[] = [
  { id: 'rewrite-imperative', label: 'Rewrite as imperative' },
  { id: 'add-why', label: 'Add the why' },
  { id: 'split-steps', label: 'Split into steps' },
  { id: 'draft-reference', label: 'Draft a reference' },
  { id: 'draft-script', label: 'Draft a script' },
  { id: 'tighten', label: 'Tighten' },
  { id: 'custom', label: 'Custom instruction' },
];

export function CopilotPanel({ disabled }: { disabled: boolean }) {
  const file = useEditor((s) => s.file);
  const selectedId = useEditor((s) => s.selectedId);
  const proposal = useAiPanel((s) => s.copilot);
  const proposalNodeId = useAiPanel((s) => s.copilotNodeId);
  const setValue = useAiPanel((s) => s.set);
  const [intent, setIntent] = useState<CopilotIntent>('rewrite-imperative');
  const [instruction, setInstruction] = useState('');
  const { busy, error, run } = useAiRun();

  const doc = file?.doc;
  const node = doc?.nodes.find((n) => n.id === selectedId);

  const ask = () => {
    if (!doc || !selectedId) return;
    void run(
      () =>
        callAi('copilot', {
          doc,
          nodeId: selectedId,
          intent,
          instruction: instruction.trim() || undefined,
        }),
      (result) => {
        setValue('copilot', result);
        setValue('copilotNodeId', selectedId);
      },
    );
  };

  return (
    <div className="space-y-2 p-2 text-[11px]">
      {node ? (
        <div className="text-[var(--muted)]">
          Acting on <span className="font-mono text-[var(--ink)]">{node.id}</span> ({node.kind})
        </div>
      ) : (
        <div className="rounded border border-[var(--line)] bg-neutral-50 px-2 py-1.5 text-[var(--muted)]">
          Select a node on the canvas to use the copilot.
        </div>
      )}
      <Field label="Intent">
        <Select value={intent} onChange={(e) => setIntent(e.target.value as CopilotIntent)}>
          {INTENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Instruction" hint="optional">
        <TextArea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Anything the model should know…"
        />
      </Field>
      <Button variant="primary" onClick={ask} disabled={disabled || busy || !node}>
        Propose a change
      </Button>
      <ErrorNote error={error} />
      {busy && <Busy />}
      {proposal && !busy && (
        <>
          {proposalNodeId !== selectedId && (
            <div className="text-[10px] text-[var(--muted)]">
              Proposal for <span className="font-mono">{proposalNodeId}</span>
            </div>
          )}
          <ProposalCard
            rationale={proposal.rationale}
            patch={proposal.patch}
            onApply={() => {
              applyPatch(proposal.patch);
              setValue('copilot', null);
              setValue('copilotNodeId', null);
            }}
            onDiscard={() => {
              setValue('copilot', null);
              setValue('copilotNodeId', null);
            }}
          />
        </>
      )}
    </div>
  );
}
