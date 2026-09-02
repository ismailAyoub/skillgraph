'use client';

import type { NodeKind } from '@skillgraph/core';
import { KIND_META, PALETTE_ORDER } from '@/lib/nodeMeta';
import { useEditor } from '@/lib/store';

const GROUPS: { id: 'flow' | 'files' | 'quality' | 'other'; label: string }[] = [
  { id: 'flow', label: 'Flow' },
  { id: 'files', label: 'Files' },
  { id: 'quality', label: 'Quality' },
  { id: 'other', label: 'Other' },
];

export function Palette() {
  const addNode = useEditor((s) => s.addNode);
  const selectedId = useEditor((s) => s.selectedId);
  const file = useEditor((s) => s.file);

  const onAdd = (kind: NodeKind) => {
    const selected = file?.doc.nodes.find((n) => n.id === selectedId);
    const isFile = kind === 'reference' || kind === 'script' || kind === 'asset';
    if (selected && !isFile && selected.kind !== 'entry') {
      if (selected.kind === 'phase' || selected.kind === 'loop') {
        addNode(kind, { parentId: selected.id });
      } else {
        addNode(kind, { parentId: selected.parentId ?? null, after: selected.id });
      }
    } else {
      addNode(kind, { parentId: null });
    }
    setTimeout(() => void useEditor.getState().relayout(), 0);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2 text-xs">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
        Drag onto the canvas, or click to add after the selection
      </div>
      {GROUPS.map((g) => (
        <div key={g.id} className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {g.label}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {PALETTE_ORDER.filter((k) => KIND_META[k].group === g.id).map((k) => {
              const m = KIND_META[k];
              return (
                <button
                  key={k}
                  type="button"
                  title={m.description}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/skillgraph-kind', k);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onAdd(k)}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-left hover:border-[var(--accent)]"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: m.color }}
                  />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
