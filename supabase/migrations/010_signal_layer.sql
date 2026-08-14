-- Shared source-signal + activity-cluster layer (product expansion §49/§57).
-- One persistent record per raw signal from any source (Gmail, Calendar,
-- Drive, an uploaded document, a manual entry), classified once and never
-- reprocessed while its content is unchanged (content_hash). The Faculty
-- Action Inbox, the Smart Academic Repository, and (eventually) Reconstruct
-- My Year all read/write this same table instead of each maintaining a
-- private, duplicate copy of "what have we already seen and classified."

do $$ begin create type public.signal_source as enum ('gmail', 'google_calendar', 'google_drive', 'upload', 'manual'); exception when duplicate_object then null; end $$;
do $$ begin create type public.signal_status as enum ('new', 'classified', 'clustered', 'actioned', 'ignored'); exception when duplicate_object then null; end $$;
do $$ begin create type public.cluster_status as enum ('open', 'proposed', 'confirmed', 'ignored'); exception when duplicate_object then null; end $$;

create table if not exists public.activity_clusters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  predicted_category public.activity_category,
  normalized_title text not null default '',
  organization text,
  start_date date,
  confidence numeric not null default 0,
  status public.cluster_status not null default 'open',
  activity_id uuid references public.academic_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists activity_clusters_profile_idx on public.activity_clusters(profile_id, status);
drop trigger if exists activity_clusters_updated_at on public.activity_clusters;
create trigger activity_clusters_updated_at before update on public.activity_clusters for each row execute function public.set_updated_at();

create table if not exists public.source_signals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source public.signal_source not null,
  external_id text not null,
  content_hash text not null,
  observed_at timestamptz not null default now(),
  event_date date,
  title text not null default '',
  sender text,
  organization text,
  snippet text,
  metadata jsonb not null default '{}'::jsonb,
  classification jsonb not null default '{}'::jsonb,
  entities jsonb not null default '{}'::jsonb,
  status public.signal_status not null default 'new',
  cluster_id uuid references public.activity_clusters(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, source, external_id)
);
create index if not exists source_signals_profile_idx on public.source_signals(profile_id, source, status);
create index if not exists source_signals_cluster_idx on public.source_signals(cluster_id);
drop trigger if exists source_signals_updated_at on public.source_signals;
create trigger source_signals_updated_at before update on public.source_signals for each row execute function public.set_updated_at();

-- ---------- Incremental sync cursors (Gmail historyId / Calendar syncToken / Drive startPageToken) ----------
-- One row per connected source per faculty; a present cursor means "resume
-- from here," never "rescan everything." Kept separate from
-- oauth_connections (007_oauth_tokens.sql) so a disconnect/reconnect cycle
-- can reset cursors without touching token storage.
create table if not exists public.source_sync_state (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider public.oauth_provider not null,
  cursor text,
  last_full_sync_at timestamptz,
  last_delta_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, provider)
);
drop trigger if exists source_sync_state_updated_at on public.source_sync_state;
create trigger source_sync_state_updated_at before update on public.source_sync_state for each row execute function public.set_updated_at();

alter table public.activity_clusters enable row level security;
alter table public.source_signals enable row level security;
alter table public.source_sync_state enable row level security;

drop policy if exists activity_clusters_owner on public.activity_clusters;
create policy activity_clusters_owner on public.activity_clusters for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists source_signals_owner on public.source_signals;
create policy source_signals_owner on public.source_signals for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists source_sync_state_owner on public.source_sync_state;
create policy source_sync_state_owner on public.source_sync_state for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
