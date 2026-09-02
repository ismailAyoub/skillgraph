'use client';

import { compile } from '@skillgraph/core';
import { Copy, Download, PencilLine } from 'lucide-react';
import { nanoid } from 'nanoid';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Pill } from '@/components/ui';
import { type CloudSkill, getSharedSkill } from '@/lib/cloud';
import { saveSkill } from '@/lib/db';
import { buildZip, download } from '@/lib/io';

/** Public, read-only view of a shared skill: the compiled SKILL.md plus "open a copy". */
export function SharedSkill({ slug }: { slug: string }) {
  const router = useRouter();
  const [skill, setSkill] = useState<CloudSkill | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSharedSkill(slug)
      .then(setSkill)
      .catch((e) => setError((e as Error).message));
  }, [slug]);

  const compiled = useMemo(() => (skill ? compile(skill.file.doc) : null), [skill]);

  if (error) return <div className="p-8 text-sm text-red-700">{error}</div>;
  if (skill === undefined) return <div className="p-8 text-sm text-[var(--muted)]">Loading…</div>;
  if (skill === null || !compiled)
    return (
      <div className="mx-auto max-w-2xl p-8 text-sm">
        <p className="mb-2 font-semibold">This link is not public.</p>
        <p className="text-[var(--muted)]">
          The owner may have stopped sharing it.{' '}
          <Link href="/" className="text-[var(--accent)] hover:underline">
            Back to SkillGraph
          </Link>
        </p>
      </div>
    );

  const body = compiled.skillMd.replace(/^---[\s\S]*?---\n/, '');
  const openCopy = async () => {
    const id = nanoid(10);
    await saveSkill(id, skill.file);
    router.push(`/edit/${id}`);
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/" className="text-[12px] font-semibold hover:underline">
          SkillGraph
        </Link>
        <span className="text-[var(--line)]">/</span>
        <span className="text-[12px] text-[var(--muted)]">shared skill</span>
        <span className="ml-auto" />
        <Pill>{compiled.report.lines} lines</Pill>
        <Pill tone="muted">~{compiled.report.tokens} tokens</Pill>
        <Button
          onClick={() => navigator.clipboard.writeText(compiled.skillMd)}
          title="Copy SKILL.md"
        >
          <Copy size={14} /> Copy
        </Button>
        <Button
          onClick={() => {
            const { name, data } = buildZip(skill.file, { clean: true });
            download(`${name}.zip`, data, 'application/zip');
          }}
        >
          <Download size={14} /> Download
        </Button>
        <Button variant="primary" onClick={() => void openCopy()}>
          <PencilLine size={14} /> Open a copy in the editor
        </Button>
      </div>
      <h1 className="text-2xl font-bold">{skill.name}</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">{skill.description}</p>
      <div className="prose-preview rounded-lg border border-[var(--line)] bg-white p-6 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    </div>
  );
}
