'use client';

import {
  Check,
  Circle,
  CircleCheck,
  CircleDot,
  KeyRound,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, Field, Input, Modal, Pill, Select } from '@/components/ui';
import { BRIDGE_REPO_URL, BRIDGE_SERVICE_COMMANDS, BRIDGE_START_COMMANDS } from '@/lib/bridge';
import {
  type ClaudeStatus,
  claudeStep,
  type SubscriptionStep,
  subscriptionCta,
} from '@/lib/claudeStatus';
import {
  AI_MODELS,
  type AiBackend,
  setAiBackend,
  setAiModel,
  setAnthropicKey,
} from '@/lib/settings';
import { useUi } from '@/lib/uiStore';
import { type AiTarget, useAiSettings } from '@/lib/useSettings';

/** One-line status of the AI connection, for headers and cards. */
export function aiStatusLabel(effective: AiTarget | null, claude?: ClaudeStatus): string {
  const who = claude ? [claude.account, claude.subscription].filter(Boolean).join(' · ') : '';
  const suffix = who ? ` · ${who}` : '';
  if (effective === 'local')
    return `AI: your Claude subscription (this app, on your machine)${suffix}`;
  if (effective === 'bridge') return `AI: your Claude subscription (local bridge)${suffix}`;
  if (effective === 'api') return 'AI: Anthropic API key';
  if (claude) {
    const step = claudeStep(claude);
    if (step === 'login') return 'Claude Code is not logged in';
    if (step === 'install') return 'Claude Code is not installed';
  }
  return 'AI not connected';
}

/**
 * Header button that opens the "Connect AI" dialog. Reads as a call to action until an AI backend
 * is reachable, then as a quiet status.
 */
export function SettingsButton() {
  const open = useUi((s) => s.aiSetupOpen);
  const setOpen = useUi((s) => s.setAiSetupOpen);
  const { effective, claude } = useAiSettings();
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        title={aiStatusLabel(effective, claude)}
        aria-label="AI setup"
        className={effective ? '' : 'border-[var(--accent)] text-[var(--accent)]'}
      >
        <Sparkles size={14} />
        {effective ? 'AI' : subscriptionCta(claudeStep(claude))}
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
      className={`rounded-lg border p-3 ${selected ? 'border-[var(--accent)] bg-[var(--accent-soft)]/40' : 'border-[var(--line)] bg-[var(--card)]'}`}
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

const STEP_ORDER: SubscriptionStep[] = ['relay', 'install', 'login'];

function stepState(step: SubscriptionStep, current: SubscriptionStep): 'done' | 'current' | 'todo' {
  if (current === 'ready') return 'done';
  const i = STEP_ORDER.indexOf(step);
  const j = STEP_ORDER.indexOf(current);
  return i < j ? 'done' : i === j ? 'current' : 'todo';
}

function Step({
  state,
  title,
  children,
  testId,
}: {
  state: 'done' | 'current' | 'todo';
  title: ReactNode;
  children?: ReactNode;
  testId: string;
}) {
  const icon =
    state === 'done' ? (
      <CircleCheck size={14} className="text-[var(--ok)]" />
    ) : state === 'current' ? (
      <CircleDot size={14} className="text-[var(--accent)]" />
    ) : (
      <Circle size={14} className="text-[var(--faint)]" />
    );
  return (
    <li className="flex gap-2" data-testid={testId} data-state={state}>
      <span className="mt-[1px] shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className={state === 'todo' ? 'text-[var(--muted)]' : 'font-medium'}>{title}</div>
        {state === 'current' && <div className="space-y-1.5 text-[var(--muted)]">{children}</div>}
      </div>
    </li>
  );
}

const PRE =
  'mt-1 overflow-x-auto rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-[var(--ink)]';

/**
 * The subscription path, one link at a time, so the state is visible before the first call: a
 * relay on this machine, Claude Code installed, Claude Code logged in.
 */
function SubscriptionSteps({ claude }: { claude: ClaudeStatus }) {
  const current = claudeStep(claude);
  const who = [claude.account, claude.subscription].filter(Boolean).join(' · ');
  return (
    <ol className="space-y-2 leading-snug">
      <Step
        state={stepState('relay', current)}
        testId="ai-step-relay"
        title={
          claude.relay === 'local'
            ? 'This app is running on your machine and relays the requests itself'
            : claude.relay === 'bridge'
              ? 'The local bridge is running and relays the requests'
              : 'A relay on this machine'
        }
      >
        <p>
          The hosted app cannot reach your login, so something on your computer has to relay each
          request. Install the bridge once as a background service (macOS; starts at login, nothing
          to keep open). The CLI is not on npm yet, so it runs from a checkout of the{' '}
          <a
            href={BRIDGE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--ink)]"
          >
            repo
          </a>
          :
        </p>
        <pre className={PRE}>{BRIDGE_SERVICE_COMMANDS.join('\n')}</pre>
        <p>
          Or run it in a terminal you keep open:{' '}
          <code>{BRIDGE_START_COMMANDS[BRIDGE_START_COMMANDS.length - 1]}</code>. Running this app
          locally with <code>pnpm dev</code> works too: it relays by itself.
        </p>
      </Step>
      <Step
        state={stepState('install', current)}
        testId="ai-step-install"
        title={claude.installed ? 'Claude Code is installed' : 'Install Claude Code'}
      >
        <p>
          No <code>claude</code> command was found on this machine. Install it:
        </p>
        <pre className={PRE}>npm install -g @anthropic-ai/claude-code</pre>
        <p>
          If it is installed under another name, start the bridge with{' '}
          <code>SKILLGRAPH_CLAUDE_BIN</code> set.
        </p>
      </Step>
      <Step
        state={stepState('login', current)}
        testId="ai-step-login"
        title={
          claude.loggedIn ? (
            <>
              Logged in
              {who ? <span className="font-normal text-[var(--muted)]"> · {who}</span> : null}
              {claude.method === 'console' && (
                <span className="font-normal text-[var(--warn)]">
                  {' '}
                  (Console account, billed per token; run <code>claude auth login</code> to use your
                  subscription)
                </span>
              )}
            </>
          ) : (
            'Log in to Claude Code with your subscription'
          )
        }
      >
        <p>Claude Code is installed but not logged in (or its session expired). In a terminal:</p>
        <pre className={PRE}>claude auth login</pre>
        <p>
          Sign in on the page that opens, copy the code it shows, then paste it back into the same
          terminal at <code>Paste code here</code>. If it complains that the session expired, run{' '}
          <code>claude auth logout</code> first. This dialog updates by itself.
        </p>
        {claude.error && <p className="text-[var(--warn)]">Last check: {claude.error}</p>}
      </Step>
    </ol>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { key, model, backend, claude } = useAiSettings();
  const step = claudeStep(claude);
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
          step === 'ready' ? (
            <Pill tone="ok">connected</Pill>
          ) : step === 'login' ? (
            <Pill tone="warn">not logged in</Pill>
          ) : step === 'install' ? (
            <Pill tone="warn">not installed</Pill>
          ) : (
            <Pill tone="muted">not detected</Pill>
          )
        }
        testId="ai-choice-bridge"
      >
        <p className="leading-snug text-[var(--muted)]">
          Uses the Claude Code login already on your computer. No API key, nothing beyond your plan.
          Each request runs <code>claude -p</code> on your machine. Three things have to be true:
        </p>
        <SubscriptionSteps claude={claude} />
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
