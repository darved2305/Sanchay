-- USP 10: LOR Studio. Grounded letter drafting over real recorded
-- faculty-student history -- no student login; students exist as records a
-- faculty member links themselves to.

do $$ begin create type public.lor_purpose as enum ('ms', 'job', 'scholarship', 'phd'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lor_status as enum ('draft', 'finalized'); exception when duplicate_object then null; end $$;

create table if not exists public.student_records (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  full_name text not null,
  roll_number text,
  program text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists student_records_institution_idx on public.student_records(institution_id);

create table if not exists public.faculty_student_links (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.student_records(id) on delete cascade,
  relationship text not null,
  course_or_project text,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  unique (faculty_id, student_id, relationship)
);
create index if not exists faculty_student_links_faculty_idx on public.faculty_student_links(faculty_id);
create index if not exists faculty_student_links_student_idx on public.faculty_student_links(student_id);

create table if not exists public.student_achievements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_records(id) on delete cascade,
  title text not null,
  description text,
  achieved_on date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists student_achievements_student_idx on public.student_achievements(student_id);

create table if not exists public.recommendation_letters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.student_records(id) on delete cascade,
  purpose public.lor_purpose not null,
  grounding_facts jsonb not null default '{}'::jsonb,
  draft_text text not null default '',
  status public.lor_status not null default 'draft',
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recommendation_letters_profile_idx on public.recommendation_letters(profile_id, created_at desc);

drop trigger if exists recommendation_letters_updated_at on public.recommendation_letters;
create trigger recommendation_letters_updated_at before update on public.recommendation_letters for each row execute function public.set_updated_at();

alter table public.student_records enable row level security;
alter table public.faculty_student_links enable row level security;
alter table public.student_achievements enable row level security;
alter table public.recommendation_letters enable row level security;

drop policy if exists student_records_institution_read on public.student_records;
create policy student_records_institution_read on public.student_records for select to authenticated using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists student_records_creator_write on public.student_records;
create policy student_records_creator_write on public.student_records for insert to authenticated with check (exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));

drop policy if exists faculty_student_links_owner on public.faculty_student_links;
create policy faculty_student_links_owner on public.faculty_student_links for all to authenticated using (faculty_id = auth.uid()) with check (faculty_id = auth.uid());

drop policy if exists student_achievements_linked_faculty on public.student_achievements;
create policy student_achievements_linked_faculty on public.student_achievements for select to authenticated using (exists(select 1 from public.faculty_student_links l where l.student_id = student_id and l.faculty_id = auth.uid()));
drop policy if exists student_achievements_linked_faculty_write on public.student_achievements;
create policy student_achievements_linked_faculty_write on public.student_achievements for insert to authenticated with check (exists(select 1 from public.faculty_student_links l where l.student_id = student_id and l.faculty_id = auth.uid()));

drop policy if exists recommendation_letters_owner on public.recommendation_letters;
create policy recommendation_letters_owner on public.recommendation_letters for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
