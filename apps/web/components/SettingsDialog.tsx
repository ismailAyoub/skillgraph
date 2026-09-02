'use client';

import { Check, KeyRound, Sparkles, TerminalSquare } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, Field, Input, Modal, Pill, Select } from '@/components/ui';
import { BRIDGE_REPO_URL, BRIDGE_START_COMMANDS } from '@/lib/bridge';
import {
  AI_MODELS,
  type AiBackend,
  setAiBackend,
  setAiModel,
  setAnthropicKey,
} from '@/lib/settings';
import { useUi } from '@/lib/uiStore';
import { useAiSettings } from '@/lib/useSettings';

/** One-line status of the AI connection, for headers and cards. */
export function aiStatusLabel(effective: 'api' | 'bridge' | null): string {
  if (effective === 'bridge') return 'AI: your Claude subscription (local bridge)';
  if (effective === 'api') return 'AI: Anthropic API key';
  return 'AI not connected';
}

/**
 * Header button that opens the "Connect AI" dialog. Reads as a call to action until an AI backend
 * is reachable, then as a quiet status.
 */
export function SettingsButton() {
  const open = useUi((s) => s.aiSetupOpen);
  const setOpen = useUi((s) => s.setAiSetupOpen);
  const { effective } = useAiSettings();
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        title={aiStatusLabel(effective)}
        aria-label="AI setup"
        className={effective ? '' : 'border-[var(--accent)] text-[var(--accent)]'}
      >
        <Sparkles size={14} />
        {effective ? 'AI' : 'Connect AI'}
        {effective && <Check size={12} className="text-[var(--ok)]" />}
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function Choice({
  selected,
  onSelect,
  icon,
  title,
  status,
  children,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  status: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${selected ? 'border-[var(--accent)] bg-[var(--accent-soft)]/40' : 'border-[var(--line)] bg-white'}`}
      data-testid={testId}
    >
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name="ai-backend"
          checked={selected}
          onChange={onSelect}
          className="accent-[var(--accent)]"
        />
        <span className="text-[var(--accent)]">{icon}</span>
        <span className="text-xs font-semibold">{title}</span>
        <span className="ml-auto">{status}</span>
      </label>
      {selected && <div className="mt-2 space-y-2 pl-6">{children}</div>}
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { key, model, backend, bridgeAi } = useAiSettings();
  const [draftKey, setDraftKey] = useState(key);
  const [draftModel, setDraftModel] = useState(model);
  // "auto" is kept for existing settings but the dialog always shows one explicit choice.
  const [choice, setChoice] = useState<Exclude<AiBackend, 'auto'>>(
    backend === 'api' || (backend === 'auto' && key) ? 'api' : 'bridge',
  );

  const save = () => {
    setAnthropicKey(draftKey);
    setAiModel(draftModel);
    setAiBackend(choice);
    onClose();
  };

  return (
    <Modal
      title="Connect AI"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} data-testid="settings-save">
            Save
          </Button>
        </>
      }
    >
      <p className="leading-snug text-[var(--muted)]">
        Chat, critique, describe and copilot all talk to Claude. Your SkillGraph account (if you
        have one) only stores skills; it is not a Claude login. Pick how the editor should reach
        Claude:
      </p>

      <Choice
        selected={choice === 'bridge'}
        onSelect={() => setChoice('bridge')}
        icon={<TerminalSquare size={14} />}
        title="Your Claude subscription"
        status={
          bridgeAi ? <Pill tone="ok">connected</Pill> : <Pill tone="muted">not detected</Pill>
        }
        testId="ai-choice-bridge"
      >
        <p className="leading-snug text-[var(--muted)]">
          Uses the Claude Code login already on your computer. No API key, nothing beyond your plan.
          A small local bridge relays each request to <code>claude -p</code> on your machine.
        </p>
        <ol className="list-decimal space-y-1.5 pl-4 leading-snug">
          <li>
            Install Claude Code and sign in once: run <code>claude</code> in a terminal and follow
            the login prompt.
          </li>
          <li>
            Start the bridge (the CLI is not on npm yet, so it runs from a checkout of the{' '}
            <a
              href={BRIDGE_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--ink)]"
            >
              repo
            </a>
            ):
            <pre className="mt-1 overflow-x-auto rounded border border-[var(--line)] bg-neutral-50 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed">
              {BRIDGE_START_COMMANDS.join('\n')}
            </pre>
          </li>
          <li>
            Leave that terminal open. This dialog flips to{' '}
            <span className="font-semibold text-[var(--ok)]">connected</span> within a few seconds.
          </li>
        </ol>
      </Choice>

      <Choice
        selected={choice === 'api'}
        onSelect={() => setChoice('api')}
        icon={<KeyRound size={14} />}
        title="An Anthropic API key"
        status={draftKey ? <Pill tone="ok">key set</Pill> : <Pill tone="muted">no key</Pill>}
        testId="ai-choice-api"
      >
        <Input
          type="password"
          autoComplete="off"
          placeholder="sk-ant-…"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          data-testid="settings-api-key"
          aria-label="Anthropic API key"
        />
        <p className="leading-snug text-[var(--muted)]">
          Billed per request by Anthropic. The key stays in this browser (localStorage) and is sent
          only to this app&apos;s <code>/api/ai</code> routes, one request at a time; the server
          never stores or logs it.
        </p>
      </Choice>

      <Field label="Model">
        <Select value={draftModel} onChange={(e) => setDraftModel(e.target.value)}>
          {AI_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
