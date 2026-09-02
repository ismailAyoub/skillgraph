'use client';

import { Cloud, CloudOff, Link2, Link2Off } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Pill } from '@/components/ui';
import { ACCOUNTS_ENABLED, useSession } from '@/lib/auth';
import { getCloudSkill, setCloudSkillPublic, shareUrl } from '@/lib/cloud';
import { useEditor } from '@/lib/store';

/** Editor-header controls for cloud sync and share links. Hidden when accounts are disabled. */
export function CloudControls() {
  const { loading, user } = useSession();
  const cloudId = useEditor((s) => s.cloudId);
  const cloudStatus = useEditor((s) => s.cloudStatus);
  const cloudMessage = useEditor((s) => s.cloudMessage);
  const saveToCloud = useEditor((s) => s.saveToCloud);
  const skillId = useEditor((s) => s.skillId);
  const [share, setShare] = useState<{ isPublic: boolean; slug: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    setShare(null);
    if (!cloudId || !user) return;
    let alive = true;
    void getCloudSkill(cloudId)
      .then((row) => {
        if (alive && row) setShare({ isPublic: row.is_public, slug: row.share_slug });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cloudId, user]);

  if (!ACCOUNTS_ENABLED || loading || !skillId) return null;
  if (!user)
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/edit/${skillId}`)}`}
        className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
        title="Sign in to save this skill to your account and share it"
      >
        <span className="inline-flex items-center gap-1">
          <CloudOff size={13} /> Sign in to sync
        </span>
      </Link>
    );

  const toggleShare = async () => {
    if (!cloudId) return;
    setBusy(true);
    setShareError(null);
    try {
      const next = !(share?.isPublic ?? false);
      const slug = await setCloudSkillPublic(cloudId, next);
      setShare({ isPublic: next, slug: slug ?? share?.slug ?? null });
      if (next && slug) {
        await navigator.clipboard.writeText(shareUrl(slug)).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch (e) {
      setShareError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!cloudId && (
        <Button
          onClick={() => void saveToCloud()}
          disabled={cloudStatus === 'saving'}
          title="Save this skill to your account; later edits sync automatically"
        >
          <Cloud size={14} /> {cloudStatus === 'saving' ? 'Saving…' : 'Save to cloud'}
        </Button>
      )}
      {cloudId && (
        <>
          <Pill tone={cloudStatus === 'error' ? 'err' : 'ok'}>
            {cloudStatus === 'saving'
              ? 'syncing…'
              : cloudStatus === 'error'
                ? 'sync failed'
                : 'synced'}
          </Pill>
          <Button
            onClick={() => void toggleShare()}
            disabled={busy}
            title={
              share?.isPublic
                ? `Public at ${share.slug ? shareUrl(share.slug) : ''} (click to stop sharing)`
                : 'Create a public read-only link'
            }
          >
            {share?.isPublic ? <Link2Off size={14} /> : <Link2 size={14} />}{' '}
            {copied ? 'Link copied' : share?.isPublic ? 'Shared' : 'Share'}
          </Button>
        </>
      )}
      {(cloudMessage || shareError) && (
        <span className="text-[11px] text-red-700">{cloudMessage ?? shareError}</span>
      )}
    </>
  );
}
