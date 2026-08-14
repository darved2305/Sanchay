-- Reconciles 018_professional_network_extensions.sql's schema with the
-- actual API shape implemented in api/network.py: collaboration payload is
-- stored inline as jsonb on community_posts (not a separate
-- collaboration_details table), "Express Interest" uses post_interests (not
-- collaboration_interests), and collaboration_workspaces links back to its
-- originating post via source_post_id (not post_id). No real rows existed in
-- the superseded tables (verified before writing this migration), so this is
-- a straight schema correction, not a data migration.

alter table public.community_posts add column if not exists collaboration_payload jsonb;

create table if not exists public.post_interests (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index if not exists post_interests_post_idx on public.post_interests(post_id);

alter table public.post_interests enable row level security;
drop policy if exists post_interests_read on public.post_interests;
create policy post_interests_read on public.post_interests for select to authenticated using (
  profile_id = auth.uid() or exists(select 1 from public.community_posts p where p.id = post_id and p.author_id = auth.uid())
);
drop policy if exists post_interests_self_write on public.post_interests;
create policy post_interests_self_write on public.post_interests for insert to authenticated with check (profile_id = auth.uid());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.post_interests; exception when duplicate_object then null; end;
  end if;
end $$;

alter table public.collaboration_workspaces rename column post_id to source_post_id;

drop table if exists public.collaboration_interests;
drop table if exists public.collaboration_details;
