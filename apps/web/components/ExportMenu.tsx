'use client';

import type { SkillFile } from '@skillgraph/core';
import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { buildPluginZip, buildSkillsRepoZip, buildZip, download } from '@/lib/io';

type Format = 'zip' | 'skill' | 'plugin' | 'skills-repo';

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: 'zip', label: 'Skill folder (.zip)', hint: 'includes SKILL.graph.json' },
  { id: 'skill', label: 'claude.ai package (.skill)', hint: 'universal profile, no graph' },
  { id: 'plugin', label: 'Claude Code plugin (.zip)', hint: 'plugin.json + marketplace.json' },
  { id: 'skills-repo', label: 'skills/ repo (.zip)', hint: 'for `npx skills add`' },
];

export function ExportMenu({ file }: { file: SkillFile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = (format: Format) => {
    setOpen(false);
    if (format === 'zip') {
      const { name, data } = buildZip(file);
      download(`${name}.zip`, data, 'application/zip');
    } else if (format === 'skill') {
      const { name, data } = buildZip(file, { clean: true, profile: 'universal' });
      download(`${name}.skill`, data, 'application/zip');
    } else if (format === 'plugin') {
      const { name, data } = buildPluginZip(file);
      download(`${name}.zip`, data, 'application/zip');
    } else {
      const { name, data } = buildSkillsRepoZip(file);
      download(`${name}.zip`, data, 'application/zip');
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="primary"
        onClick={() => setOpen((o) => !o)}
        title="Export the compiled skill"
      >
        <Download size={14} /> Export <ChevronDown size={12} />
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-[var(--line)] bg-[var(--card)] p-1 shadow-lg">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => run(f.id)}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--panel)]"
            >
              <div className="font-medium">{f.label}</div>
              <div className="text-[10px] text-[var(--muted)]">{f.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
