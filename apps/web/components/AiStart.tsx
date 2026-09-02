'use client';

import type { InterviewStep, InterviewTurn } from '@skillgraph/ai';
import { applyPatch, compile, type SkillFile, slugify } from '@skillgraph/core';
import { ArrowRight, Check, MessageSquareText, RotateCcw, Sparkles } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Busy, ErrorNote } from '@/components/ai/common';
import { aiStatusLabel, SettingsDialog } from '@/components/SettingsDialog';
import { Button, Pill, TextArea } from '@/components/ui';
import { callAi } from '@/lib/ai';
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

function blankSkill(name: string): SkillFile {
  const blank = TEMPLATES.find((t) => t.id === 'blank') ?? TEMPLATES[0];
  if (!blank) throw new Error('no template');
  return blank.build(name);
}

/** What the draft contains so far, for the pills next to "Create skill". */
function draftSummary(file: SkillFile): {
  name: string;
  lines: number;
  phases: number;
  steps: number;
} {
  const entry = file.doc.nodes.find((n) => n.kind === 'entry') as { name: string } | undefined;
  return {
    name: entry?.name ?? 'skill',
    lines: compile(file.doc).report.lines,
    phases: file.doc.nodes.filter((n) => n.kind === 'phase').length,
    steps: file.doc.nodes.filter((n) => n.kind === 'step').length,
  };
}

/**
 * Dashboard chat: Claude interviews you here, one question at a time, and builds the skill graph
 * in memory as you answer. "Create skill" saves that draft and opens the editor on it, with the
 * conversation carried along so you can keep going there.
 */
export function AiStart() {
  const router = useRouter();
  const { effective } = useAiSettings();
  const setupOpen = useUi((s) => s.aiSetupOpen);
  const setSetupOpen = useUi((s) => s.setAiSetupOpen);
  const [file, setFile] = useState<SkillFile | null>(null);
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [step, setStep] = useState<InterviewStep | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const started = turns.length > 0;
  const done = step?.done === true;

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!effective) {
      setSetupOpen(true);
      return;
    }
    // The first message names the skill; the interview may rename it later through a patch.
    const current = file ?? blankSkill(nameFromDescription(text));
    const transcript: InterviewTurn[] = [...turns, { role: 'user', content: text }];
    setFile(current);
    setTurns(transcript);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const result = await callAi('interview', { doc: current.doc, transcript });
      const next = result.patch
        ? { ...current, doc: applyPatch(current.doc, result.patch).doc }
        : current;
      setFile(next);
      setStep(result);
      if (result.question)
        setTurns([...transcript, { role: 'assistant', content: result.question }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!file || creating) return;
    setCreating(true);
    const id = nanoid(10);
    await saveSkill(id, file);
    setKickoff(id, { turns, step });
    router.push(`/edit/${id}`);
  };

  const restart = () => {
    setFile(null);
    setTurns([]);
    setStep(null);
    setDraft('');
    setError(null);
  };

  const summary = file ? draftSummary(file) : null;

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
      {!started && (
        <p className="mb-3 text-[11px] text-[var(--muted)]">
          Say what the skill should do. Claude asks a few questions, one at a time, and drafts the
          skill as you answer. When it has enough, press Create skill to open the draft in the
          editor, where every node is yours to change.
        </p>
      )}

      {started && (
        <div
          className="mb-2 max-h-[360px] space-y-1.5 overflow-y-auto text-xs"
          data-testid="ai-start-chat"
        >
          {turns.map((t, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
              key={i}
              className={`max-w-[85%] rounded-lg border px-3 py-2 leading-snug ${
                t.role === 'assistant'
                  ? 'border-[var(--line)] bg-neutral-50'
                  : 'ml-auto border-transparent bg-[var(--accent-soft)] text-[var(--accent)]'
              }`}
            >
              {t.content}
            </div>
          ))}
          {busy && <Busy label="Thinking…" />}
          <ErrorNote error={error} />
          {done && (
            <div className="rounded-lg border border-[var(--ok)] bg-green-50 px-3 py-2 leading-snug text-green-800">
              The draft is ready. Create the skill to see it on the canvas and refine it there.
            </div>
          )}
        </div>
      )}

      {!done && (
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send();
          }}
          placeholder={started ? 'Your answer… (⌘⏎ to send)' : `e.g. ${EXAMPLES[0]}`}
          aria-label={started ? 'Your answer' : 'Describe the skill you want'}
          data-testid="ai-start-text"
          rows={started ? 2 : 3}
          disabled={busy}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!done && (
          <Button
            variant={started ? 'default' : 'primary'}
            onClick={() => void send()}
            disabled={!draft.trim() || busy}
            data-testid="ai-start-go"
            title={effective ? 'Send (⌘⏎)' : 'Connect AI first'}
          >
            <Sparkles size={14} /> {started ? 'Send' : 'Start chatting'}
          </Button>
        )}
        {started && file && (
          <Button
            variant={done ? 'primary' : started ? 'default' : 'primary'}
            onClick={() => void create()}
            disabled={busy || creating}
            data-testid="ai-start-create"
            title="Save the draft and open it in the editor"
          >
            {creating ? 'Opening…' : 'Create skill'} <ArrowRight size={14} />
          </Button>
        )}
        {started && (
          <Button variant="ghost" onClick={restart} title="Discard this draft and start over">
            <RotateCcw size={13} /> Start over
          </Button>
        )}
        {summary && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <span className="font-mono">{summary.name}</span>
            <Pill>{summary.lines} lines</Pill>
            {summary.phases > 0 && <Pill tone="accent">{summary.phases} phases</Pill>}
            {summary.steps > 0 && <Pill tone="accent">{summary.steps} steps</Pill>}
            {step && !done && (
              <Pill tone={step.confidence >= 0.7 ? 'ok' : 'warn'}>
                {Math.round(step.confidence * 100)}% there
              </Pill>
            )}
          </span>
        )}
        {!started && (
          <>
            <span className="text-[11px] text-[var(--muted)]">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setDraft(ex)}
                className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
              >
                {ex.length > 48 ? `${ex.slice(0, 46)}…` : ex}
              </button>
            ))}
          </>
        )}
      </div>
      {setupOpen && <SettingsDialog onClose={() => setSetupOpen(false)} />}
    </section>
  );
}
