import type { SkillFile } from '@skillgraph/core';
import { del, get, set } from 'idb-keyval';
import type { BridgeOrigin } from './bridge';

export interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  updatedAt: number;
  nodeCount: number;
  /** Where the skill came from, when it is linked to a folder through the local bridge. */
  origin?: BridgeOrigin;
}

const INDEX_KEY = 'skillgraph:index';
const key = (id: string) => `skillgraph:skill:${id}`;

export async function listSkills(): Promise<SkillIndexEntry[]> {
  const idx = (await get<SkillIndexEntry[]>(INDEX_KEY)) ?? [];
  return [...idx].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSkill(id: string): Promise<SkillFile | undefined> {
  return get<SkillFile>(key(id));
}

export async function saveSkill(
  id: string,
  file: SkillFile,
  origin?: BridgeOrigin | null,
): Promise<void> {
  await set(key(id), file);
  const entry = file.doc.nodes.find((n) => n.kind === 'entry') as
    | { name: string; description: string }
    | undefined;
  const all = (await get<SkillIndexEntry[]>(INDEX_KEY)) ?? [];
  const previous = all.find((e) => e.id === id);
  const idx = all.filter((e) => e.id !== id);
  const next: SkillIndexEntry = {
    id,
    name: entry?.name ?? id,
    description: entry?.description ?? '',
    updatedAt: Date.now(),
    nodeCount: file.doc.nodes.length,
  };
  const resolvedOrigin = origin === null ? undefined : (origin ?? previous?.origin);
  if (resolvedOrigin) next.origin = resolvedOrigin;
  idx.push(next);
  await set(INDEX_KEY, idx);
}

export async function getSkillEntry(id: string): Promise<SkillIndexEntry | undefined> {
  const idx = (await get<SkillIndexEntry[]>(INDEX_KEY)) ?? [];
  return idx.find((e) => e.id === id);
}

export async function setSkillOrigin(id: string, origin: BridgeOrigin | undefined): Promise<void> {
  const idx = (await get<SkillIndexEntry[]>(INDEX_KEY)) ?? [];
  await set(
    INDEX_KEY,
    idx.map((e) => (e.id === id ? { ...e, origin } : e)),
  );
}

export async function deleteSkill(id: string): Promise<void> {
  await del(key(id));
  const idx = ((await get<SkillIndexEntry[]>(INDEX_KEY)) ?? []).filter((e) => e.id !== id);
  await set(INDEX_KEY, idx);
}
