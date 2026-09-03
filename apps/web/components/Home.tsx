'use client';

import { slugify } from '@skillgraph/core';
import { FolderOpen, Trash2, Upload } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountBar } from '@/components/AccountBar';
import { AiStart } from '@/components/AiStart';
import { CloudSkills } from '@/components/CloudSkills';
import { LocalSkills } from '@/components/LocalSkills';
import { Button, Field, Input, Select } from '@/components/ui';
import { deleteSkill, listSkills, type SkillIndexEntry, saveSkill } from '@/lib/db';
import { importFiles } from '@/lib/io';
import { TEMPLATES } from '@/lib/templates';

function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <h2 className="font-serif text-[22px] font-normal">{children}</h2>
      {count !== undefined && (
        <span className="font-mono text-[12px] text-[var(--faint)]">{count}</span>
      )}
    </div>
  );
}

function when(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  if (d < 7 * 86_400_000) return `${Math.round(d / 86_400_000)} d ago`;
  return new Date(ts).toLocaleDateString();
}

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
    <div className="min-h-screen">
      <AccountBar />
      <main className="mx-auto max-w-5xl px-8 pb-16">
        <AiStart />

        <section className="mt-6 grid grid-cols-[1.3fr_1fr_1fr] gap-14 border-t border-[var(--line)] pt-10">
          <div className="flex flex-col gap-3">
            <SectionTitle count={skills.length}>Your skills</SectionTitle>
            {skills.length === 0 && (
              <p className="text-[13px] text-[var(--muted)]">
                Nothing yet. Chat above, start from a template, or import one.
              </p>
            )}
            <ul className="flex flex-col">
              {skills.map((s) => (
                <li
                  key={s.id}
                  className="group flex items-center gap-3 border-t border-[var(--line)] py-3 last:border-b"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => router.push(`/edit/${s.id}`)}
                  >
                    <div className="truncate text-[14px] font-medium">{s.name}</div>
                    <div className="line-clamp-1 text-[12px] text-[var(--muted)]">
                      {s.description}
                    </div>
                  </button>
                  <span className="font-mono text-[11.5px] text-[var(--faint)]">
                    {s.cloudId ? 'cloud · ' : ''}
                    {s.nodeCount} nodes · {when(s.updatedAt)}
                  </span>
                  <Button
                    variant="ghost"
                    title="Delete"
                    className="opacity-0 group-hover:opacity-100"
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
          </div>

          <div className="flex flex-col gap-3">
            <SectionTitle>Start from a template</SectionTitle>
            <p className="text-[13px] leading-[1.55] text-[var(--muted)]">
              {TEMPLATES.find((t) => t.id === template)?.description}
            </p>
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
            <Button variant="primary" onClick={() => void create()} className="self-start">
              Create
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <SectionTitle>Import a skill</SectionTitle>
            <p className="text-[13px] leading-[1.55] text-[var(--muted)]">
              A folder, a zip or a single SKILL.md. Nothing is lost; unrecognized prose stays
              verbatim.
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
            {busy && <p className="text-[12px] text-[var(--muted)]">{busy}</p>}
            {error && <p className="text-[12px] text-[var(--err)]">{error}</p>}
          </div>
        </section>

        <div className="mt-12 flex flex-col gap-8">
          <div id="cloud">
            <CloudSkills />
          </div>
          <div id="local">
            <LocalSkills />
          </div>
        </div>
      </main>
    </div>
  );
}
