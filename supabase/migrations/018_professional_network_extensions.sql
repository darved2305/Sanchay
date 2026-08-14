-- Faculty Professional Network extensions (product expansion §34-46): follow
-- (separate from connect), structured "Looking for Collaborators" posts with
-- an Express Interest flow, lightweight collaboration workspaces, additional
-- open-to flags, and multi-type reactions. Builds on the existing Academic
-- Network (008_academic_network.sql, USP 9) rather than a parallel system.

do $$ begin create type public.collaboration_stage as enum ('introduced', 'discussing', 'planning', 'active', 'submitted', 'completed', 'paused'); exception when duplicate_object then null; end $$;
do $$ begin alter type public.post_kind add value if not exists 'collaboration'; exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists open_to_grant_collaboration boolean not null default false;
alter table public.profiles add column if not exists open_to_reviewing boolean not null default false;

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists follows_followed_idx on public.follows(followed_id);

-- One-to-one structured payload for kind='collaboration' community_posts,
-- kept as its own table (not extra nullable columns on community_posts)
-- since it's the one post kind with a genuinely different shape (§39).
create table if not exists public.collaboration_details (
  post_id uuid primary key references public.community_posts(id) on delete cascade,
  research_area text,
  looking_for text,
  skills_needed text[] not null default '{}',
  goal text
);

create table if not exists public.collaboration_interests (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, profile_id)
);
create index if not exists collaboration_interests_post_idx on public.collaboration_interests(post_id);

create table if not exists public.collaboration_workspaces (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.community_posts(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  research_area text,
  goal text,
  stage public.collaboration_stage not null default 'introduced',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists collaboration_workspaces_creator_idx on public.collaboration_workspaces(created_by);
drop trigger if exists collaboration_workspaces_updated_at on public.collaboration_workspaces;
create trigger collaboration_workspaces_updated_at before update on public.collaboration_workspaces for each row execute function public.set_updated_at();

create table if not exists public.collaboration_members (
  workspace_id uuid not null references public.collaboration_workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

-- Multi-type reactions (§38: Like / Insightful / Celebrate) -- still one
-- reaction per person per post (upsert changes the type), not one row per type.
alter table public.post_reactions add column if not exists reaction_type text not null default 'like';
alter table public.post_reactions drop constraint if exists post_reactions_type_check;
alter table public.post_reactions add constraint post_reactions_type_check check (reaction_type in ('like', 'insightful', 'celebrate'));

alter table public.follows enable row level security;
alter table public.collaboration_details enable row level security;
alter table public.collaboration_interests enable row level security;
alter table public.collaboration_workspaces enable row level security;
alter table public.collaboration_members enable row level security;

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to authenticated using (true);
drop policy if exists follows_follower_write on public.follows;
create policy follows_follower_write on public.follows for all to authenticated using (follower_id = auth.uid()) with check (follower_id = auth.uid());

drop policy if exists collaboration_details_read on public.collaboration_details;
create policy collaboration_details_read on public.collaboration_details for select to authenticated using (
  exists(select 1 from public.community_posts p where p.id = post_id and (
    p.community_id is null
    or exists(select 1 from public.community_members m where m.community_id = p.community_id and m.profile_id = auth.uid())
  ))
);
drop policy if exists collaboration_details_author_write on public.collaboration_details;
create policy collaboration_details_author_write on public.collaboration_details for all to authenticated using (
  exists(select 1 from public.community_posts p where p.id = post_id and p.author_id = auth.uid())
) with check (
  exists(select 1 from public.community_posts p where p.id = post_id and p.author_id = auth.uid())
);

drop policy if exists collaboration_interests_read on public.collaboration_interests;
create policy collaboration_interests_read on public.collaboration_interests for select to authenticated using (
  profile_id = auth.uid() or exists(select 1 from public.community_posts p where p.id = post_id and p.author_id = auth.uid())
);
drop policy if exists collaboration_interests_self_write on public.collaboration_interests;
create policy collaboration_interests_self_write on public.collaboration_interests for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists collaboration_workspaces_participant on public.collaboration_workspaces;
create policy collaboration_workspaces_participant on public.collaboration_workspaces for select to authenticated using (
  created_by = auth.uid() or exists(select 1 from public.collaboration_members m where m.workspace_id = id and m.profile_id = auth.uid())
);
drop policy if exists collaboration_workspaces_creator_write on public.collaboration_workspaces;
create policy collaboration_workspaces_creator_write on public.collaboration_workspaces for insert to authenticated with check (created_by = auth.uid());
drop policy if exists collaboration_workspaces_participant_update on public.collaboration_workspaces;
create policy collaboration_workspaces_participant_update on public.collaboration_workspaces for update to authenticated using (
  created_by = auth.uid() or exists(select 1 from public.collaboration_members m where m.workspace_id = id and m.profile_id = auth.uid())
) with check (
  created_by = auth.uid() or exists(select 1 from public.collaboration_members m where m.workspace_id = id and m.profile_id = auth.uid())
);

drop policy if exists collaboration_members_participant on public.collaboration_members;
create policy collaboration_members_participant on public.collaboration_members for select to authenticated using (
  profile_id = auth.uid() or exists(select 1 from public.collaboration_workspaces w where w.id = workspace_id and w.created_by = auth.uid())
);
drop policy if exists collaboration_members_creator_write on public.collaboration_members;
create policy collaboration_members_creator_write on public.collaboration_members for insert to authenticated with check (
  exists(select 1 from public.collaboration_workspaces w where w.id = workspace_id and w.created_by = auth.uid())
  or profile_id = auth.uid()
);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.follows; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.collaboration_interests; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.collaboration_workspaces; exception when duplicate_object then null; end;
  end if;
end $$;
