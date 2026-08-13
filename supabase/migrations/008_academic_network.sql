-- USP 9: Academic Network. A focused faculty professional network --
-- deliberately not a LinkedIn clone: search/discovery by academic intent,
-- explainable recommendations (tag overlap, not a black-box score),
-- connections, realtime messaging, communities with posts/comments/reactions.

do $$ begin create type public.connection_status as enum ('pending', 'accepted', 'declined'); exception when duplicate_object then null; end $$;
do $$ begin create type public.post_kind as enum ('post', 'question', 'opportunity', 'announcement'); exception when duplicate_object then null; end $$;

create table if not exists public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references public.profiles(id) on delete cascade,
  to_profile_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_profile_id <> to_profile_id),
  unique (from_profile_id, to_profile_id)
);
create index if not exists connection_requests_to_idx on public.connection_requests(to_profile_id, status);
create index if not exists connection_requests_from_idx on public.connection_requests(from_profile_id, status);

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  profile_id_a uuid not null references public.profiles(id) on delete cascade,
  profile_id_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (profile_id_a < profile_id_b),
  unique (profile_id_a, profile_id_b)
);
create index if not exists connections_a_idx on public.connections(profile_id_a);
create index if not exists connections_b_idx on public.connections(profile_id_b);

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (community_id, profile_id)
);
create index if not exists community_members_profile_idx on public.community_members(profile_id);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind public.post_kind not null default 'post',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists community_posts_community_idx on public.community_posts(community_id, created_at desc);
create index if not exists community_posts_author_idx on public.community_posts(author_id, created_at desc);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments(post_id, created_at);

create table if not exists public.post_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);
create index if not exists conversation_members_profile_idx on public.conversation_members(profile_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

alter table public.connection_requests enable row level security;
alter table public.connections enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists connection_requests_participant on public.connection_requests;
create policy connection_requests_participant on public.connection_requests for select to authenticated using (from_profile_id = auth.uid() or to_profile_id = auth.uid());
drop policy if exists connection_requests_sender_write on public.connection_requests;
create policy connection_requests_sender_write on public.connection_requests for insert to authenticated with check (from_profile_id = auth.uid());
drop policy if exists connection_requests_recipient_respond on public.connection_requests;
create policy connection_requests_recipient_respond on public.connection_requests for update to authenticated using (to_profile_id = auth.uid()) with check (to_profile_id = auth.uid());

drop policy if exists connections_participant on public.connections;
create policy connections_participant on public.connections for select to authenticated using (profile_id_a = auth.uid() or profile_id_b = auth.uid());

drop policy if exists communities_read_authenticated on public.communities;
create policy communities_read_authenticated on public.communities for select to authenticated using (true);
drop policy if exists communities_create_authenticated on public.communities;
create policy communities_create_authenticated on public.communities for insert to authenticated with check (created_by = auth.uid());

drop policy if exists community_members_read on public.community_members;
create policy community_members_read on public.community_members for select to authenticated using (true);
drop policy if exists community_members_self_write on public.community_members;
create policy community_members_self_write on public.community_members for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts for select to authenticated using (community_id is null or exists(select 1 from public.community_members m where m.community_id = community_id and m.profile_id = auth.uid()));
drop policy if exists community_posts_author_write on public.community_posts;
create policy community_posts_author_write on public.community_posts for insert to authenticated with check (author_id = auth.uid());

drop policy if exists post_comments_read on public.post_comments;
create policy post_comments_read on public.post_comments for select to authenticated using (true);
drop policy if exists post_comments_author_write on public.post_comments;
create policy post_comments_author_write on public.post_comments for insert to authenticated with check (author_id = auth.uid());

drop policy if exists post_reactions_read on public.post_reactions;
create policy post_reactions_read on public.post_reactions for select to authenticated using (true);
drop policy if exists post_reactions_self_write on public.post_reactions;
create policy post_reactions_self_write on public.post_reactions for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists direct_conversations_participant on public.direct_conversations;
create policy direct_conversations_participant on public.direct_conversations for select to authenticated using (exists(select 1 from public.conversation_members m where m.conversation_id = id and m.profile_id = auth.uid()));

drop policy if exists conversation_members_participant on public.conversation_members;
create policy conversation_members_participant on public.conversation_members for select to authenticated using (exists(select 1 from public.conversation_members m2 where m2.conversation_id = conversation_id and m2.profile_id = auth.uid()));

drop policy if exists messages_participant_read on public.messages;
create policy messages_participant_read on public.messages for select to authenticated using (exists(select 1 from public.conversation_members m where m.conversation_id = conversation_id and m.profile_id = auth.uid()));
drop policy if exists messages_participant_write on public.messages;
create policy messages_participant_write on public.messages for insert to authenticated with check (sender_id = auth.uid() and exists(select 1 from public.conversation_members m where m.conversation_id = conversation_id and m.profile_id = auth.uid()));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.connection_requests; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.community_posts; exception when duplicate_object then null; end;
  end if;
end $$;
