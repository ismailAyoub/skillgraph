'use client';

/**
 * Cloud-saved skills (Supabase table `skills`, RLS: owner read/write, public read for shared).
 * The graph file is stored as JSON; SKILL.md is always recompiled from it.
 */
import type { SkillFile } from '@skillgraph/core';
import { supabaseBrowser } from './supabase/browser';

export interface CloudSkillRow {
  id: string;
  name: string;
  description: string;
  node_count: number;
  is_public: boolean;
  share_slug: string | null;
  updated_at: string;
}

export interface CloudSkill extends CloudSkillRow {
  file: SkillFile;
}

const COLS = 'id,name,description,node_count,is_public,share_slug,updated_at';

function entryOf(file: SkillFile): { name: string; description: string } {
  const e = file.doc.nodes.find((n) => n.kind === 'entry') as
    | { name: string; description: string }
    | undefined;
  return { name: e?.name ?? 'skill', description: e?.description ?? '' };
}

function need() {
  const sb = supabaseBrowser();
  if (!sb) throw new Error('Accounts are not enabled on this deployment');
  return sb;
}

export async function listCloudSkills(): Promise<CloudSkillRow[]> {
  const sb = need();
  // Public skills are readable by everyone under RLS; the dashboard must list only the owner's rows.
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await sb
    .from('skills')
    .select(COLS)
    .eq('owner', auth.user.id)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudSkillRow[];
}

export async function getCloudSkill(id: string): Promise<CloudSkill | null> {
  const { data, error } = await need()
    .from('skills')
    .select(`${COLS},file`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CloudSkill | null) ?? null;
}

/** Insert (no id) or update (id) the caller's skill; returns the row id. */
export async function saveCloudSkill(file: SkillFile, id?: string): Promise<string> {
  const sb = need();
  const { name, description } = entryOf(file);
  const payload = { name, description, node_count: file.doc.nodes.length, file };
  if (id) {
    const { error } = await sb.from('skills').update(payload).eq('id', id);
    if (error) throw new Error(error.message);
    return id;
  }
  const { data, error } = await sb.from('skills').insert(payload).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function deleteCloudSkill(id: string): Promise<void> {
  const { error } = await need().from('skills').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Turn sharing on (allocates a slug once) or off. Returns the current slug when public. */
export async function setCloudSkillPublic(id: string, isPublic: boolean): Promise<string | null> {
  const sb = need();
  const { data, error } = await sb.rpc('set_skill_public', { skill_id: id, make_public: isPublic });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Anyone (including signed-out visitors) can read a public skill by its share slug. */
export async function getSharedSkill(slug: string): Promise<CloudSkill | null> {
  const sb = supabaseBrowser();
  if (!sb) return null;
  const { data, error } = await sb
    .from('skills')
    .select(`${COLS},file`)
    .eq('share_slug', slug)
    .eq('is_public', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CloudSkill | null) ?? null;
}

export function shareUrl(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/s/${slug}`;
}
