'use client';

import { Tabs } from '@/components/ui';
import { type AiMode, useAiPanel } from '@/lib/aiStore';
import { useAiSettings } from '@/lib/useSettings';
import { CopilotPanel } from './CopilotPanel';
import { CritiquePanel } from './CritiquePanel';
import { NoKeyHint } from './common';
import { DescribePanel } from './DescribePanel';
import { ImportPanel } from './ImportPanel';
import { InterviewPanel } from './InterviewPanel';

const MODES: { id: AiMode; label: string }[] = [
  { id: 'critique', label: 'Critique' },
  { id: 'describe', label: 'Describe' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'interview', label: 'Interview' },
  { id: 'import', label: 'Import' },
];

/**
 * AI assistance over the current graph. Everything here is a proposal: nothing touches the doc
 * until Apply, and Apply always goes through the editor store so it is undoable.
 */
export function AiPanel() {
  const mode = useAiPanel((s) => s.mode);
  const setMode = useAiPanel((s) => s.setMode);
  const { key } = useAiSettings();
  const disabled = !key;

  return (
    <div className="flex h-full flex-col">
      <Tabs<AiMode> value={mode} onChange={setMode} tabs={MODES} />
      <div className="min-h-0 flex-1 overflow-auto">
        {disabled && (
          <div className="p-2">
            <NoKeyHint />
          </div>
        )}
        {mode === 'critique' && <CritiquePanel disabled={disabled} />}
        {mode === 'describe' && <DescribePanel disabled={disabled} />}
        {mode === 'copilot' && <CopilotPanel disabled={disabled} />}
        {mode === 'interview' && <InterviewPanel disabled={disabled} />}
        {mode === 'import' && <ImportPanel disabled={disabled} />}
      </div>
    </div>
  );
}
