-- Sanchaya USP scope: Reconstruct My Year, Any Form Assistant, Deadline Rescue,
-- Shared Academic Facts, Promotion Dossier / Next Best Move, CV Import Bootstrap.
-- Builds on 001_compulsory.sql. Apply with `supabase db push` or the SQL editor.

do $$ begin create type public.job_status as enum ('queued', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reconstruct_candidate_status as enum ('proposed', 'confirmed', 'ignored'); exception when duplicate_object then null; end $$;
do $$ begin create type public.event_participant_status as enum ('pending', 'confirmed', 'declined'); exception when duplicate_object then null; end $$;
do $$ begin create type public.form_job_kind as enum ('analyze', 'generate'); exception when duplicate_object then null; end $$;
do $$ begin create type public.oauth_provider as enum ('gmail', 'google_calendar', 'google_drive'); exception when duplicate_object then null; end $$;

-- ---------- Background jobs (shared status envelope for every async USP action) ----------
create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  status public.job_status not null default 'queued',
  progress numeric not null default 0,
  progress_label text,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists background_jobs_owner_idx on public.background_jobs(owner_id, created_at desc);
drop trigger if exists background_jobs_updated_at on public.background_jobs;
create trigger background_jobs_updated_at before update on public.background_jobs for each row execute function public.set_updated_at();

-- ---------- USP 1: Reconstruct My Year ----------
create table if not exists public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider public.oauth_provider not null,
  status text not null default 'disconnected',
  scope text,
  external_account_email text,
  connected_at timestamptz,
  expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, provider)
);
drop trigger if exists oauth_connections_updated_at on public.oauth_connections;
create trigger oauth_connections_updated_at before update on public.oauth_connections for each row execute function public.set_updated_at();

create table if not exists public.reconstruction_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.background_jobs(id) on delete set null,
  academic_year text not null,
  sources_used text[] not null default '{}',
  candidate_count integer not null default 0,
  confirmed_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists reconstruction_runs_profile_idx on public.reconstruction_runs(profile_id, created_at desc);

create table if not exists public.reconstruction_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.reconstruction_runs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category public.activity_category not null,
  title text not null,
  organization text,
  start_date date,
  end_date date,
  confidence numeric not null default 0,
  status public.reconstruct_candidate_status not null default 'proposed',
  metadata jsonb not null default '{}'::jsonb,
  activity_id uuid references public.academic_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reconstruction_candidates_run_idx on public.reconstruction_candidates(run_id, status);
drop trigger if exists reconstruction_candidates_updated_at on public.reconstruction_candidates;
create trigger reconstruction_candidates_updated_at before update on public.reconstruction_candidates for each row execute function public.set_updated_at();

create table if not exists public.candidate_sources (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.reconstruction_candidates(id) on delete cascade,
  source_type text not null,
  source_ref text,
  snippet text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists candidate_sources_candidate_idx on public.candidate_sources(candidate_id);

-- ---------- USP 2: Any Form Assistant ----------
create table if not exists public.form_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.background_jobs(id) on delete set null,
  kind public.form_job_kind not null,
  original_file_name text not null,
  storage_path text not null,
  output_storage_path text,
  fields_detected integer not null default 0,
  fields_auto_filled integer not null default 0,
  fields_needs_confirmation integer not null default 0,
  fields_needs_new_info integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists form_jobs_owner_idx on public.form_jobs(owner_id, created_at desc);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_job_id uuid not null references public.form_jobs(id) on delete cascade,
  field_key text not null,
  label text not null,
  cell_ref text,
  canonical_path text,
  value text,
  confidence numeric,
  source text,
  status text not null default 'auto_filled',
  question text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists form_fields_job_idx on public.form_fields(form_job_id);
drop trigger if exists form_fields_updated_at on public.form_fields;
create trigger form_fields_updated_at before update on public.form_fields for each row execute function public.set_updated_at();

create table if not exists public.mapping_hints (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  label_pattern text not null,
  canonical_path text not null,
  hit_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, label_pattern, canonical_path)
);
drop trigger if exists mapping_hints_updated_at on public.mapping_hints;
create trigger mapping_hints_updated_at before update on public.mapping_hints for each row execute function public.set_updated_at();

-- ---------- USP 5: Shared Academic Facts ----------
create table if not exists public.institution_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  category public.activity_category not null,
  title text not null,
  organization text,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists institution_events_institution_idx on public.institution_events(institution_id, created_at desc);
drop trigger if exists institution_events_updated_at on public.institution_events;
create trigger institution_events_updated_at before update on public.institution_events for each row execute function public.set_updated_at();

create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.institution_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'participant',
  status public.event_participant_status not null default 'pending',
  proposal_activity_id uuid references public.academic_activities(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, profile_id)
);
create index if not exists event_participants_profile_idx on public.event_participants(profile_id, status);

-- ---------- USP 8: Promotion Dossier + Next Best Academic Move ----------
create table if not exists public.career_rules (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  goal_key text not null,
  goal_label text not null,
  description text,
  rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, goal_key)
);
drop trigger if exists career_rules_updated_at on public.career_rules;
create trigger career_rules_updated_at before update on public.career_rules for each row execute function public.set_updated_at();

create table if not exists public.career_goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  career_rule_id uuid not null references public.career_rules(id) on delete cascade,
  set_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (profile_id, career_rule_id)
);
create index if not exists career_goals_profile_idx on public.career_goals(profile_id, is_active);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  kind text not null,
  title text not null,
  description text,
  tags text[] not null default '{}',
  deadline date,
  url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists opportunities_institution_idx on public.opportunities(institution_id, deadline);

create table if not exists public.career_recommendations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  reason text not null,
  gap_key text,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, opportunity_id)
);
create index if not exists career_recommendations_profile_idx on public.career_recommendations(profile_id, dismissed);

create table if not exists public.promotion_dossiers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  career_rule_id uuid not null references public.career_rules(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  storage_path text,
  created_at timestamptz not null default now()
);
create index if not exists promotion_dossiers_profile_idx on public.promotion_dossiers(profile_id, created_at desc);

-- ---------- Triggers ----------
drop trigger if exists form_jobs_updated_at on public.form_jobs;
-- (form_jobs has no updated_at column beyond created/completed; no trigger needed)

-- ---------- RLS ----------
alter table public.background_jobs enable row level security;
alter table public.oauth_connections enable row level security;
alter table public.reconstruction_runs enable row level security;
alter table public.reconstruction_candidates enable row level security;
alter table public.candidate_sources enable row level security;
alter table public.form_jobs enable row level security;
alter table public.form_fields enable row level security;
alter table public.mapping_hints enable row level security;
alter table public.institution_events enable row level security;
alter table public.event_participants enable row level security;
alter table public.career_rules enable row level security;
alter table public.career_goals enable row level security;
alter table public.opportunities enable row level security;
alter table public.career_recommendations enable row level security;
alter table public.promotion_dossiers enable row level security;

drop policy if exists background_jobs_owner on public.background_jobs;
create policy background_jobs_owner on public.background_jobs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists oauth_connections_owner on public.oauth_connections;
create policy oauth_connections_owner on public.oauth_connections for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists reconstruction_runs_owner on public.reconstruction_runs;
create policy reconstruction_runs_owner on public.reconstruction_runs for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists reconstruction_candidates_owner on public.reconstruction_candidates;
create policy reconstruction_candidates_owner on public.reconstruction_candidates for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists candidate_sources_owner on public.candidate_sources;
create policy candidate_sources_owner on public.candidate_sources for all to authenticated using (exists(select 1 from public.reconstruction_candidates c where c.id = candidate_id and c.profile_id = auth.uid())) with check (exists(select 1 from public.reconstruction_candidates c where c.id = candidate_id and c.profile_id = auth.uid()));

drop policy if exists form_jobs_owner on public.form_jobs;
create policy form_jobs_owner on public.form_jobs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists form_fields_owner on public.form_fields;
create policy form_fields_owner on public.form_fields for all to authenticated using (exists(select 1 from public.form_jobs j where j.id = form_job_id and j.owner_id = auth.uid())) with check (exists(select 1 from public.form_jobs j where j.id = form_job_id and j.owner_id = auth.uid()));
drop policy if exists mapping_hints_institution_read on public.mapping_hints;
create policy mapping_hints_institution_read on public.mapping_hints for select to authenticated using (institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists mapping_hints_institution_write on public.mapping_hints;
create policy mapping_hints_institution_write on public.mapping_hints for insert to authenticated with check (institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists mapping_hints_institution_update on public.mapping_hints;
create policy mapping_hints_institution_update on public.mapping_hints for update to authenticated using (institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));

drop policy if exists institution_events_read on public.institution_events;
create policy institution_events_read on public.institution_events for select to authenticated using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists institution_events_admin_write on public.institution_events;
create policy institution_events_admin_write on public.institution_events for all to authenticated using (public.is_admin_for_institution(institution_id)) with check (public.is_admin_for_institution(institution_id));

drop policy if exists event_participants_self_or_admin on public.event_participants;
create policy event_participants_self_or_admin on public.event_participants for select to authenticated using (profile_id = auth.uid() or exists(select 1 from public.institution_events e where e.id = event_id and public.is_admin_for_institution(e.institution_id)));
drop policy if exists event_participants_self_update on public.event_participants;
create policy event_participants_self_update on public.event_participants for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists event_participants_admin_write on public.event_participants;
create policy event_participants_admin_write on public.event_participants for insert to authenticated with check (exists(select 1 from public.institution_events e where e.id = event_id and public.is_admin_for_institution(e.institution_id)));
drop policy if exists event_participants_admin_delete on public.event_participants;
create policy event_participants_admin_delete on public.event_participants for delete to authenticated using (exists(select 1 from public.institution_events e where e.id = event_id and public.is_admin_for_institution(e.institution_id)));

drop policy if exists career_rules_institution_read on public.career_rules;
create policy career_rules_institution_read on public.career_rules for select to authenticated using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists career_rules_admin_write on public.career_rules;
create policy career_rules_admin_write on public.career_rules for all to authenticated using (public.is_admin_for_institution(institution_id)) with check (public.is_admin_for_institution(institution_id));

drop policy if exists career_goals_owner on public.career_goals;
create policy career_goals_owner on public.career_goals for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists opportunities_institution_read on public.opportunities;
create policy opportunities_institution_read on public.opportunities for select to authenticated using (institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists opportunities_admin_write on public.opportunities;
create policy opportunities_admin_write on public.opportunities for all to authenticated using (institution_id is null or public.is_admin_for_institution(institution_id)) with check (institution_id is null or public.is_admin_for_institution(institution_id));

drop policy if exists career_recommendations_owner on public.career_recommendations;
create policy career_recommendations_owner on public.career_recommendations for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists promotion_dossiers_owner on public.promotion_dossiers;
create policy promotion_dossiers_owner on public.promotion_dossiers for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------- Storage: form uploads/outputs share the existing private buckets ----------
-- form uploads and CV imports land in the 'evidence' bucket under the owner's folder,
-- and generated form outputs / dossiers land in the 'generated' bucket, both already
-- policy-scoped to auth.uid() by 001_compulsory.sql.

-- ---------- Realtime ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.background_jobs; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.reconstruction_candidates; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.event_participants; exception when duplicate_object then null; end;
  end if;
end $$;
