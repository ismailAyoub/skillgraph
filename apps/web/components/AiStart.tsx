'use client';

import type { InterviewStep, InterviewTurn } from '@skillgraph/ai';
import { applyPatch, compile, type SkillFile, slugify } from '@skillgraph/core';
import { ArrowRight, RotateCcw, Sparkles } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Busy, ErrorNote } from '@/components/ai/common';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Button, Pill } from '@/components/ui';
import { callAi } from '@/lib/ai';
import { claudeStep, subscriptionCta } from '@/lib/claudeStatus';
import { saveSkill } from '@/lib/db';
import { setKickoff } from '@/lib/kickoff';
import { TEMPLATES } from '@/lib/templates';
import { useUi } from '@/lib/uiStore';
import { useAiSettings } from '@/lib/useSettings';

const EXAMPLES = [
  'Decision log from a meeting transcript',
  'Weekly changelog from merged PRs',
  'Onboarding checklist for new engineers',
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
 * Dashboard hero: Claude interviews you here, one question at a time, and builds the skill graph
 * in memory as you answer. "Create skill" saves that draft and opens the editor on it, with the
 * conversation carried along so you can keep going there.
 */
export function AiStart() {
  const router = useRouter();
  const { effective, claude } = useAiSettings();
  const cta = subscriptionCta(claudeStep(claude));
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
    <section className="flex flex-col items-center gap-6 pt-16 pb-10" data-testid="ai-start">
      {!started && (
        <div className="flex flex-col items-center gap-2.5 text-center">
          <h1 className="font-serif text-[44px] font-normal leading-[1.1] tracking-[-0.02em] text-balance">
            What should this skill do?
          </h1>
          <p className="max-w-[560px] text-[15px] leading-[1.55] text-[var(--muted)] text-pretty">
            Describe it in a sentence. Claude asks a few questions, one at a time, and drafts the
            skill as you answer.
          </p>
        </div>
      )}

      {started && (
        <div
          className="flex w-[760px] max-w-full flex-col gap-2.5 text-[13.5px]"
          data-testid="ai-start-chat"
        >
          {turns.map((t, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only
              key={i}
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 leading-[1.5] ${
                t.role === 'assistant'
                  ? 'self-start rounded-bl-[4px] border border-[var(--line)] bg-[var(--card)]'
                  : 'self-end rounded-br-[4px] bg-[var(--accent-soft)] text-[#1f3f27]'
              }`}
            >
              {t.content}
            </div>
          ))}
          {busy && <Busy label="Thinking…" />}
          <ErrorNote error={error} />
          {done && (
            <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-3.5 py-2.5 leading-[1.5] text-[var(--accent)]">
              The draft is ready. Create the skill to see it on the canvas and refine it there.
            </div>
          )}
        </div>
      )}

      {!done && (
        <div className="flex w-[760px] max-w-full flex-col rounded-xl border border-[var(--line-strong)] bg-[var(--card)] shadow-[inset_0_1px_0_#fff,0_12px_30px_-18px_rgba(60,45,20,0.35)]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send();
            }}
            placeholder={
              started
                ? 'Your answer…'
                : 'Review a pull request against our house style and post a summary comment…'
            }
            aria-label={started ? 'Your answer' : 'Describe the skill you want'}
            data-testid="ai-start-text"
            rows={started ? 2 : 3}
            disabled={busy}
            className={`w-full resize-none bg-transparent px-[22px] pt-5 pb-2 leading-[1.4] outline-none placeholder:italic placeholder:text-[#a39c90] ${started ? 'text-[15px]' : 'font-serif text-[20px]'}`}
          />
          <div className="flex items-center gap-2.5 px-3.5 pt-1 pb-3.5">
            <span className="font-mono text-[11.5px] text-[var(--faint)]">⌘⏎ to send</span>
            {!effective && (
              <button
                type="button"
                onClick={() => setSetupOpen(true)}
                className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--accent)]"
                data-testid="ai-start-connect"
              >
                <Sparkles size={13} /> {cta} first
              </button>
            )}
            <span className="ml-auto" />
            {started && (
              <Button variant="ghost" onClick={restart} title="Discard this draft and start over">
                <RotateCcw size={13} /> Start over
              </Button>
            )}
            {started && file && (
              <Button
                onClick={() => void create()}
                disabled={busy || creating}
                data-testid="ai-start-create"
                title="Save the draft and open it in the editor"
              >
                {creating ? 'Opening…' : 'Create skill'} <ArrowRight size={13} />
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void send()}
              disabled={!draft.trim() || busy}
              data-testid="ai-start-go"
              title={effective ? 'Send (⌘⏎)' : `${cta} first`}
              className="px-4 py-2.5 text-[14px]"
            >
              {started ? 'Send' : 'Start chatting'}
              {!started && <ArrowRight size={15} />}
            </Button>
          </div>
        </div>
      )}

      {done && file && (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={creating}
            data-testid="ai-start-create"
            className="px-4 py-2.5 text-[14px]"
          >
            {creating ? 'Opening…' : 'Create skill'} <ArrowRight size={15} />
          </Button>
          <Button variant="ghost" onClick={restart}>
            <RotateCcw size={13} /> Start over
          </Button>
        </div>
      )}

      {summary ? (
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--faint)]">
          <span className="font-mono">{summary.name}</span>
          <Pill>{summary.lines} lines</Pill>
          {summary.phases > 0 && <Pill tone="accent">{summary.phases} phases</Pill>}
          {summary.steps > 0 && <Pill tone="accent">{summary.steps} steps</Pill>}
          {step && !done && (
            <Pill tone={step.confidence >= 0.7 ? 'ok' : 'warn'}>
              {Math.round(step.confidence * 100)}% there
            </Pill>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-[var(--muted)]">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setDraft(ex)}
              className="rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1.5 hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      {setupOpen && <SettingsDialog onClose={() => setSetupOpen(false)} />}
    </section>
  );
}
