'use client';

import { Cloud, Link2, Link2Off, RefreshCw, Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button, Pill } from '@/components/ui';
import { ACCOUNTS_ENABLED, useSession } from '@/lib/auth';
import {
  type CloudSkillRow,
  deleteCloudSkill,
  getCloudSkill,
  listCloudSkills,
  setCloudSkillPublic,
  shareUrl,
} from '@/lib/cloud';
import { findSkillByCloudId, saveSkill, setSkillCloudId } from '@/lib/db';

/** Skills saved to the signed-in account. Opening one links it to a browser copy that syncs back. */
export function CloudSkills() {
  const router = useRouter();
  const { loading, user } = useSession();
  const [rows, setRows] = useState<CloudSkillRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setRows(await listCloudSkills());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ACCOUNTS_ENABLED || loading || !user) return null;

  const open = async (row: CloudSkillRow) => {
    setBusy(row.id);
    try {
      const existing = await findSkillByCloudId(row.id);
      const skill = await getCloudSkill(row.id);
      if (!skill) throw new Error('Skill not found (was it deleted?)');
      const id = existing?.id ?? nanoid(10);
      await saveSkill(id, skill.file);
      await setSkillCloudId(id, row.id);
      router.push(`/edit/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const toggleShare = async (row: CloudSkillRow) => {
    setBusy(row.id);
    try {
      const slug = await setCloudSkillPublic(row.id, !row.is_public);
      if (slug) await navigator.clipboard.writeText(shareUrl(slug)).catch(() => {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-8 rounded-lg border border-[var(--line)] bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Cloud size={16} /> Cloud skills
        </h2>
        <span className="text-[11px] text-[var(--muted)]">
          Saved to your account; open one and edits sync automatically.
        </span>
        <Button variant="ghost" className="ml-auto" onClick={() => void refresh()} title="Refresh">
          <RefreshCw size={13} />
        </Button>
      </div>
      {error && <p className="mb-2 text-[11px] text-red-700">{error}</p>}
      {rows.length === 0 && (
        <p className="text-xs text-[var(--muted)]">
          Nothing in the cloud yet. Open a skill and press "Save to cloud" in the editor header.
        </p>
      )}
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <button
              type="button"
              className="flex-1 text-left"
              disabled={busy === r.id}
              onClick={() => void open(r)}
            >
              <div className="text-sm font-semibold">{r.name}</div>
              <div className="line-clamp-1 text-[11px] text-[var(--muted)]">{r.description}</div>
            </button>
            {r.is_public && r.share_slug && (
              <a
                href={shareUrl(r.share_slug)}
                className="text-[11px] text-[var(--accent)] hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                /s/{r.share_slug}
              </a>
            )}
            <Pill>{r.node_count} nodes</Pill>
            <span className="text-[10px] text-[var(--muted)]">
              {new Date(r.updated_at).toLocaleString()}
            </span>
            <Button
              variant="ghost"
              title={r.is_public ? 'Stop sharing' : 'Share (copies a public link)'}
              disabled={busy === r.id}
              onClick={() => void toggleShare(r)}
            >
              {r.is_public ? <Link2Off size={14} /> : <Link2 size={14} />}
            </Button>
            <Button
              variant="ghost"
              title="Delete from the cloud"
              disabled={busy === r.id}
              onClick={async () => {
                if (!confirm(`Delete ${r.name} from your account? Browser copies stay.`)) return;
                setBusy(r.id);
                try {
                  await deleteCloudSkill(r.id);
                  const local = await findSkillByCloudId(r.id);
                  if (local) await setSkillCloudId(local.id, undefined);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
