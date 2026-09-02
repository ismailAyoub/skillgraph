'use client';

import { Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import { AI_MODELS, setAiModel, setAnthropicKey } from '@/lib/settings';
import { useAiSettings } from '@/lib/useSettings';

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const { key } = useAiSettings();
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        title={key ? 'Settings (API key set)' : 'Settings: set your Anthropic API key'}
        aria-label="Settings"
      >
        <SettingsIcon size={14} />
        {!key && <span className="text-[var(--muted)]">Set API key</span>}
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { key, model } = useAiSettings();
  const [draftKey, setDraftKey] = useState(key);
  const [draftModel, setDraftModel] = useState(model);

  const save = () => {
    setAnthropicKey(draftKey);
    setAiModel(draftModel);
    onClose();
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
        <code>/api/ai</code> routes per request, never stored server-side.
      </p>
    </Modal>
  );
}
