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
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-xs">
      <div className="text-[11.5px] leading-[1.45] text-[var(--faint)]">
        Click to add after the selection, or drag onto the canvas.
      </div>
      {GROUPS.map((g) => (
        <div key={g.id} className="flex flex-col gap-1.5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--faint)]">
            {g.label}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
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
                  className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-2 text-left text-[12.5px] hover:border-[var(--ink)]"
                >
                  <span
                    className={`inline-block h-2 w-2 ${g.id === 'files' ? 'rounded-[2px]' : 'rounded-full'}`}
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
