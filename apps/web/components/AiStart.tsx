'use client';

import { slugify } from '@skillgraph/core';
import { Check, MessageSquareText, Sparkles } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { aiStatusLabel, SettingsDialog } from '@/components/SettingsDialog';
import { Button, TextArea } from '@/components/ui';
import { saveSkill } from '@/lib/db';
import { setKickoff } from '@/lib/kickoff';
import { TEMPLATES } from '@/lib/templates';
import { useUi } from '@/lib/uiStore';
import { useAiSettings } from '@/lib/useSettings';

const EXAMPLES = [
  'Review a pull request against our house style and post a summary comment',
  'Turn a meeting transcript into a decision log with owners and due dates',
  'Generate a weekly changelog from merged PRs, grouped by product area',
];

const STOPWORDS = new Set(
  'a an the and or to for of in on at with into from against about our your my their this that it as by be is are'.split(
    ' ',
  ),
);

/** Derive a kebab-case skill name from the first few content words of the description. */
export function nameFromDescription(text: string): string {
  const words = text
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ');
  const slug = slugify(words || 'new skill', 40);
  return slug === 'item' ? 'new-skill' : slug;
}

/**
 * Dashboard entry point: describe the skill in a sentence, and the editor opens with the chat
 * already running on that sentence. The graph is built by the interview, one answer at a time.
 */
export function AiStart() {
  const router = useRouter();
  const { effective } = useAiSettings();
  const setupOpen = useUi((s) => s.aiSetupOpen);
  const setSetupOpen = useUi((s) => s.setAiSetupOpen);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = text.trim().length > 0;

  const start = async () => {
    const message = text.trim();
    if (!message || busy) return;
    if (!effective) {
      setSetupOpen(true);
      return;
    }
    setBusy(true);
    const blank = TEMPLATES.find((t) => t.id === 'blank') ?? TEMPLATES[0];
    if (!blank) return;
    const id = nanoid(10);
    await saveSkill(id, blank.build(nameFromDescription(message)));
    setKickoff(id, message);
    router.push(`/edit/${id}`);
  };

  return (
    <section
      className="mb-8 rounded-lg border border-[var(--accent)] bg-white p-4"
      data-testid="ai-start"
    >
      <div className="mb-1 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquareText size={16} className="text-[var(--accent)]" /> Build a skill by chatting
        </h2>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          {effective ? (
            <>
              <Check size={12} className="text-[var(--ok)]" /> {aiStatusLabel(effective)}
            </>
          ) : (
            <>
              AI not connected
              <Button
                variant="primary"
                onClick={() => setSetupOpen(true)}
                data-testid="ai-start-connect"
              >
                <Sparkles size={13} /> Connect AI
              </Button>
            </>
          )}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-[var(--muted)]">
        Say what the skill should do. Claude asks a few questions, one at a time, and draws the
        graph as you answer. You can edit every node afterwards, and every AI edit is undoable.
      </p>
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void start();
        }}
        placeholder={`e.g. ${EXAMPLES[0]}`}
        aria-label="Describe the skill you want"
        data-testid="ai-start-text"
        rows={3}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void start()}
          disabled={!ready || busy}
          data-testid="ai-start-go"
          title={effective ? 'Open the editor and start the chat (⌘⏎)' : 'Connect AI first'}
        >
          <Sparkles size={14} /> {busy ? 'Opening…' : 'Start chatting'}
        </Button>
        <span className="text-[11px] text-[var(--muted)]">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            {ex.length > 48 ? `${ex.slice(0, 46)}…` : ex}
          </button>
        ))}
      </div>
      {setupOpen && <SettingsDialog onClose={() => setSetupOpen(false)} />}
    </section>
  );
}
