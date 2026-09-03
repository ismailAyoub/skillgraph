'use client';

import { Button, Modal } from '@/components/ui';

export function DriftModal({
  drifted,
  busy,
  onReimport,
  onOverwrite,
  onClose,
}: {
  drifted: string[];
  busy: boolean;
  onReimport: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Files changed on disk"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onReimport} disabled={busy} title="Discard the in-browser edits">
            Re-import from disk
          </Button>
          <Button
            variant="danger"
            onClick={onOverwrite}
            disabled={busy}
            title="Replace the files on disk with this graph"
          >
            Overwrite disk
          </Button>
        </>
      }
    >
      <p>These files changed on disk since you opened the skill:</p>
      <ul className="max-h-40 overflow-auto rounded border border-[var(--line)] bg-[var(--panel)] p-2 font-mono text-[11px]">
        {drifted.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p className="text-[11px] text-[var(--muted)]">
        <b>Re-import</b> reloads the graph from the folder and keeps your node positions where the
        nodes still exist. <b>Overwrite</b> writes this graph over the files on disk.
      </p>
    </Modal>
  );
}
