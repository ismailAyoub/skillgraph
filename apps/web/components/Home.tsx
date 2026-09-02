'use client';

import { slugify } from '@skillgraph/core';
import { FolderOpen, Plus, Trash2, Upload } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountBar } from '@/components/AccountBar';
import { AiStart } from '@/components/AiStart';
import { CloudSkills } from '@/components/CloudSkills';
import { LocalSkills } from '@/components/LocalSkills';
import { Button, Field, Input, Pill, Select } from '@/components/ui';
import { deleteSkill, listSkills, type SkillIndexEntry, saveSkill } from '@/lib/db';
import { importFiles } from '@/lib/io';
import { TEMPLATES } from '@/lib/templates';

export function Home() {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillIndexEntry[]>([]);
  const [name, setName] = useState('my-new-skill');
  const [template, setTemplate] = useState('workflow');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setSkills(await listSkills()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    const t = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];
    if (!t) return;
    const id = nanoid(10);
    await saveSkill(id, t.build(slugify(name)));
    router.push(`/edit/${id}`);
  };

  const onImport = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy('Importing…');
    setError(null);
    try {
      const { file, coverage, source } = await importFiles(Array.from(list));
      const id = nanoid(10);
      await saveSkill(id, file);
      if (source === 'skill.md' && coverage !== undefined)
        setBusy(
          `Recognized ${Math.round(coverage * 100)}% of the body as structure; the rest is kept as verbatim markdown.`,
        );
      router.push(`/edit/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <AccountBar />
      <header className="mb-8">
        <h1 className="text-2xl font-bold">SkillGraph</h1>
        <p className="text-sm text-[var(--muted)]">
          Draw an Agent Skill as a graph. Compile it to SKILL.md. See what the agent will read.
        </p>
      </header>

      <AiStart />

      <section className="mb-8 grid grid-cols-2 gap-6">
        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Plus size={16} /> Start from a template
          </h2>
          <div className="space-y-3">
            <Field label="Name" hint="kebab-case">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Template">
              <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-[11px] text-[var(--muted)]">
              {TEMPLATES.find((t) => t.id === template)?.description}
            </p>
            <Button variant="primary" onClick={() => void create()}>
              Create
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Upload size={16} /> Import an existing skill
          </h2>
          <p className="mb-3 text-[11px] text-[var(--muted)]">
            A skill folder, a zip / .skill package, or a single SKILL.md. Unrecognized prose is kept
            verbatim, so nothing is lost.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => dirRef.current?.click()}>
              <FolderOpen size={14} /> Folder
            </Button>
            <Button onClick={() => zipRef.current?.click()}>
              <Upload size={14} /> Zip or SKILL.md
            </Button>
          </div>
          <input
            ref={zipRef}
            type="file"
            accept=".zip,.skill,.md,text/markdown"
            multiple
            hidden
            onChange={(e) => void onImport(e.target.files)}
          />
          <input
            ref={dirRef}
            type="file"
            hidden
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => void onImport(e.target.files)}
          />
          {busy && <p className="mt-2 text-[11px] text-[var(--muted)]">{busy}</p>}
          {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
        </div>
      </section>

      <CloudSkills />

      <LocalSkills />

      <section>
        <h2 className="mb-2 text-sm font-semibold">Your skills</h2>
        {skills.length === 0 && (
          <p className="text-xs text-[var(--muted)]">Nothing yet. Create one or import one.</p>
        )}
        <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-white">
          {skills.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2">
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => router.push(`/edit/${s.id}`)}
              >
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="line-clamp-1 text-[11px] text-[var(--muted)]">{s.description}</div>
              </button>
              {s.cloudId && <Pill tone="ok">cloud</Pill>}
              <Pill>{s.nodeCount} nodes</Pill>
              <span className="text-[10px] text-[var(--muted)]">
                {new Date(s.updatedAt).toLocaleString()}
              </span>
              <Button
                variant="ghost"
                title="Delete"
                onClick={async () => {
                  if (confirm(`Delete ${s.name}? This only removes it from this browser.`)) {
                    await deleteSkill(s.id);
                    await refresh();
                  }
                }}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
