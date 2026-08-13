-- USP 6: Admin Request Autopilot + Department Reports.
-- Department Report generation is stateless (query + PDF, no persisted row
-- needed). "Respond to External Request" is the multi-faculty sibling of Any
-- Form Assistant and needs its own job-tracking table since it spans many
-- faculty records per run.

create table if not exists public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  job_id uuid references public.background_jobs(id) on delete set null,
  original_file_name text not null,
  storage_path text not null,
  output_storage_path text,
  department_filter text,
  academic_year_filter text,
  faculty_count integer not null default 0,
  fields_detected integer not null default 0,
  faculty_with_gaps integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists admin_requests_institution_idx on public.admin_requests(institution_id, created_at desc);

alter table public.admin_requests enable row level security;

drop policy if exists admin_requests_institution_admin on public.admin_requests;
create policy admin_requests_institution_admin on public.admin_requests for all to authenticated
  using (public.is_admin_for_institution(institution_id))
  with check (public.is_admin_for_institution(institution_id));
