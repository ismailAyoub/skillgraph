-- SkillGraph cloud storage: one row per saved skill graph. Applied through the Supabase MCP.
create extension if not exists pgcrypto;

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  node_count integer not null default 0,
  file jsonb not null,
  is_public boolean not null default false,
  share_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists skills_owner_updated_idx on public.skills (owner, updated_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists skills_set_updated_at on public.skills;
create trigger skills_set_updated_at before update on public.skills
  for each row execute function public.set_updated_at();

alter table public.skills enable row level security;

drop policy if exists "owners read own skills" on public.skills;
create policy "owners read own skills" on public.skills
  for select to authenticated using ((select auth.uid()) = owner);

drop policy if exists "anyone reads public skills" on public.skills;
create policy "anyone reads public skills" on public.skills
  for select to anon, authenticated using (is_public = true);

drop policy if exists "owners insert own skills" on public.skills;
create policy "owners insert own skills" on public.skills
  for insert to authenticated with check ((select auth.uid()) = owner);

drop policy if exists "owners update own skills" on public.skills;
create policy "owners update own skills" on public.skills
  for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

drop policy if exists "owners delete own skills" on public.skills;
create policy "owners delete own skills" on public.skills
  for delete to authenticated using ((select auth.uid()) = owner);

-- Share toggle: allocates a stable slug the first time a skill goes public.
create or replace function public.set_skill_public(skill_id uuid, make_public boolean)
returns text language plpgsql security invoker set search_path = public, extensions as $$
declare
  slug text;
begin
  if make_public then
    update public.skills
      set is_public = true,
          share_slug = coalesce(share_slug, encode(extensions.gen_random_bytes(6), 'hex'))
      where id = skill_id and owner = (select auth.uid())
      returning share_slug into slug;
    return slug;
  else
    update public.skills set is_public = false
      where id = skill_id and owner = (select auth.uid());
    return null;
  end if;
end $$;

revoke all on function public.set_skill_public(uuid, boolean) from public;
grant execute on function public.set_skill_public(uuid, boolean) to authenticated;
