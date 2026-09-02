'use client';

import { HardDrive, RefreshCw } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Pill } from '@/components/ui';
import {
  BRIDGE_START_COMMANDS,
  type BridgeSkill,
  bridgeHealth,
  bridgeList,
  bridgeOpen,
  getBridgeUrl,
  setBridgeUrl,
} from '@/lib/bridge';
import { saveSkill } from '@/lib/db';

export function LocalSkills() {
  const router = useRouter();
  const [url, setUrl] = useState(getBridgeUrl());
  const [health, setHealth] = useState<{ dir: string } | null>(null);
  const [skills, setSkills] = useState<BridgeSkill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const h = await bridgeHealth(url);
    setHealth(h);
    if (h) {
      try {
        setSkills(await bridgeList(url));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const res = await bridgeOpen(url, name);
      const id = nanoid(10);
      await saveSkill(id, res.graph, { type: 'bridge', url, name, diskHashes: res.diskHashes });
      router.push(`/edit/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <section className="mb-8 rounded-lg border border-[var(--line)] bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <HardDrive size={16} /> Local skills
        </h2>
        {health ? (
          <Pill tone="ok">connected · {health.dir}</Pill>
        ) : (
          <Pill tone="muted">bridge not running</Pill>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setBridgeUrl(e.target.value);
            }}
            style={{ width: 200 }}
          />
          <Button onClick={() => void refresh()} title="Refresh">
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>
      {!health && (
        <div className="space-y-1.5 text-[11px] text-[var(--muted)]">
          <p>
            Edit the skills in <code>~/.claude/skills</code> directly, and let the AI use your
            Claude subscription. Run the bridge in a terminal, then refresh:
          </p>
          <pre className="overflow-x-auto rounded border border-[var(--line)] bg-neutral-50 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-[var(--ink)]">
            {BRIDGE_START_COMMANDS.join('\n')}
          </pre>
          <p>Saves write SKILL.md and the graph back to the folder, with drift protection.</p>
        </div>
      )}
      {error && <p className="text-[11px] text-red-700">{error}</p>}
      {health && skills.length === 0 && (
        <p className="text-[11px] text-[var(--muted)]">No skills in that folder yet.</p>
      )}
      {health && skills.length > 0 && (
        <ul className="divide-y divide-[var(--line)]">
          {skills.map((s) => (
            <li key={s.name} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="line-clamp-1 text-[11px] text-[var(--muted)]">{s.description}</div>
              </div>
              {s.hasGraph ? <Pill tone="accent">graph</Pill> : <Pill>SKILL.md only</Pill>}
              <Button onClick={() => void open(s.name)} disabled={busy === s.name}>
                {busy === s.name ? 'Opening…' : 'Open'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
