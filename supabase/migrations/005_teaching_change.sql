-- USP 7: Teaching Change Detector. Deterministic diff first (file hash +
-- line-level text diff), LLM interpretation only over the real computed
-- diff -- never invents an improvement that isn't in the uploaded material.

do $$ begin create type public.teaching_change_status as enum ('proposed', 'approved', 'dismissed'); exception when duplicate_object then null; end $$;

create table if not exists public.course_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_title text not null,
  academic_year text not null,
  created_at timestamptz not null default now()
);
create index if not exists course_snapshots_owner_idx on public.course_snapshots(owner_id, created_at desc);

create table if not exists public.course_files (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.course_snapshots(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  sha256 text not null,
  extracted_text text,
  created_at timestamptz not null default now()
);
create index if not exists course_files_snapshot_idx on public.course_files(snapshot_id);

create table if not exists public.teaching_change_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.background_jobs(id) on delete set null,
  snapshot_a_id uuid not null references public.course_snapshots(id) on delete cascade,
  snapshot_b_id uuid not null references public.course_snapshots(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists teaching_change_runs_owner_idx on public.teaching_change_runs(owner_id, created_at desc);

create table if not exists public.teaching_changes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.teaching_change_runs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  change_type text not null,
  description text not null,
  evidence jsonb not null default '{}'::jsonb,
  status public.teaching_change_status not null default 'proposed',
  activity_id uuid references public.academic_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists teaching_changes_run_idx on public.teaching_changes(run_id, status);

drop trigger if exists teaching_changes_updated_at on public.teaching_changes;
create trigger teaching_changes_updated_at before update on public.teaching_changes for each row execute function public.set_updated_at();

alter table public.course_snapshots enable row level security;
alter table public.course_files enable row level security;
alter table public.teaching_change_runs enable row level security;
alter table public.teaching_changes enable row level security;

drop policy if exists course_snapshots_owner on public.course_snapshots;
create policy course_snapshots_owner on public.course_snapshots for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists course_files_owner on public.course_files;
create policy course_files_owner on public.course_files for all to authenticated using (exists(select 1 from public.course_snapshots s where s.id = snapshot_id and s.owner_id = auth.uid())) with check (exists(select 1 from public.course_snapshots s where s.id = snapshot_id and s.owner_id = auth.uid()));
drop policy if exists teaching_change_runs_owner on public.teaching_change_runs;
create policy teaching_change_runs_owner on public.teaching_change_runs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists teaching_changes_owner on public.teaching_changes;
create policy teaching_changes_owner on public.teaching_changes for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
