'use client';

import { Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import {
  AI_BACKENDS,
  AI_MODELS,
  type AiBackend,
  setAiBackend,
  setAiModel,
  setAnthropicKey,
} from '@/lib/settings';
import { useAiSettings } from '@/lib/useSettings';

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const { effective } = useAiSettings();
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        title={
          effective === 'api'
            ? 'Settings (AI via API key)'
            : effective === 'bridge'
              ? 'Settings (AI via local Claude Code login)'
              : 'Settings: set an API key or run skillgraph dev'
        }
        aria-label="Settings"
      >
        <SettingsIcon size={14} />
        {!effective && <span className="text-[var(--muted)]">Set up AI</span>}
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { key, model, backend, bridgeAi } = useAiSettings();
  const [draftKey, setDraftKey] = useState(key);
  const [draftModel, setDraftModel] = useState(model);
  const [draftBackend, setDraftBackend] = useState<AiBackend>(backend);

  const save = () => {
    setAnthropicKey(draftKey);
    setAiModel(draftModel);
    setAiBackend(draftBackend);
    onClose();
  };
  const backendLabel: Record<AiBackend, string> = {
    auto: 'Auto (API key if set, else local bridge)',
    api: 'Anthropic API key',
    bridge: 'Local Claude Code login (skillgraph dev)',
  };

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Anthropic API key">
        <Input
          type="password"
          autoComplete="off"
          placeholder="sk-ant-…"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          data-testid="settings-api-key"
        />
      </Field>
      <Field label="AI backend" hint={bridgeAi ? 'bridge online' : 'bridge offline'}>
        <Select
          value={draftBackend}
          onChange={(e) => setDraftBackend(e.target.value as AiBackend)}
          data-testid="settings-backend"
        >
          {AI_BACKENDS.map((b) => (
            <option key={b} value={b}>
              {backendLabel[b]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Model">
        <Select value={draftModel} onChange={(e) => setDraftModel(e.target.value)}>
          {AI_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-[11px] leading-snug text-[var(--muted)]">
        The key stays in this browser (localStorage) and is sent only to this app&apos;s{' '}
        <code>/api/ai</code> routes per request, never stored server-side. Without a key, run{' '}
        <code>skillgraph dev</code> on your machine: the AI tab then talks to the local bridge,
        which runs <code>claude -p</code> with your Claude Code login.
      </p>
    </Modal>
  );
}
