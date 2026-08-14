-- Faculty Action Inbox (product expansion §3-7). Actionable academic mail,
-- extracted into structured objects and surfaced with explainable priority --
-- never an opaque "AI importance = 93%" score (§4). Built on top of the
-- shared source_signals layer (010_signal_layer.sql): one action_inbox_items
-- row is a classification result over one (or more, once correlation is
-- added) source_signals row, never a second independent mailbox scan.

do $$ begin create type public.inbox_category as enum (
  'research_collaboration', 'grant_opportunity', 'publication_journal', 'reviewer_invitation',
  'conference', 'invited_talk', 'seminar', 'fdp_workshop', 'student_mentorship', 'committee_work',
  'administrative_request', 'deadline', 'academic_opportunity', 'other', 'ignore_non_actionable'
); exception when duplicate_object then null; end $$;
do $$ begin create type public.inbox_urgency as enum ('high', 'medium', 'low'); exception when duplicate_object then null; end $$;
do $$ begin create type public.inbox_item_status as enum ('new', 'saved', 'accepted', 'declined', 'sent_to_grantops', 'collaboration_started', 'ignored'); exception when duplicate_object then null; end $$;

create table if not exists public.action_inbox_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  signal_id uuid references public.source_signals(id) on delete set null,
  category public.inbox_category not null default 'other',
  subject text not null default '',
  sender text,
  organization text,
  summary text,
  requested_action text,
  deadline date,
  meeting_date date,
  related_people jsonb not null default '[]'::jsonb,
  related_documents jsonb not null default '[]'::jsonb,
  research_topics text[] not null default '{}',
  urgency public.inbox_urgency not null default 'low',
  relevance_reasons text[] not null default '{}',
  confidence numeric not null default 0,
  status public.inbox_item_status not null default 'new',
  generated_replies jsonb not null default '{}'::jsonb,
  gmail_message_id text,
  gmail_draft_id text,
  related_grant_workspace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, signal_id)
);
create index if not exists action_inbox_items_profile_idx on public.action_inbox_items(profile_id, status, urgency);
drop trigger if exists action_inbox_items_updated_at on public.action_inbox_items;
create trigger action_inbox_items_updated_at before update on public.action_inbox_items for each row execute function public.set_updated_at();

alter table public.action_inbox_items enable row level security;

drop policy if exists action_inbox_items_owner on public.action_inbox_items;
create policy action_inbox_items_owner on public.action_inbox_items for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.action_inbox_items; exception when duplicate_object then null; end;
  end if;
end $$;
