-- Sanchaya compulsory scope: Supabase/PostgreSQL source of truth.
-- Apply with `supabase db push` or the Supabase SQL editor.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$ begin create type public.user_role as enum ('faculty', 'admin', 'dept_admin', 'institution_admin', 'reviewer'); exception when duplicate_object then null; end $$;
do $$ begin create type public.activity_category as enum ('teaching', 'research', 'publication', 'project', 'grant', 'workshop_fdp', 'seminar', 'invited_talk', 'mentorship', 'committee', 'institutional_service', 'community_engagement', 'award', 'patent', 'reviewing', 'conference', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.activity_status as enum ('proposed', 'confirmed', 'archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.visibility_level as enum ('private', 'institution', 'network'); exception when duplicate_object then null; end $$;
do $$ begin create type public.activity_source as enum ('manual', 'cv_import', 'publication_sync', 'reconstruction', 'quick_capture', 'email_capture', 'batch_certificates', 'shared_fact', 'student_achievement', 'teaching_change', 'co_author', 'evidence_import'); exception when duplicate_object then null; end $$;
do $$ begin create type public.evidence_status_t as enum ('none_needed', 'pending', 'attached'); exception when duplicate_object then null; end $$;
do $$ begin create type public.evidence_source as enum ('upload', 'gmail_attachment', 'drive', 'generated'); exception when duplicate_object then null; end $$;
do $$ begin create type public.publication_candidate_status as enum ('pending', 'confirmed', 'rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.cycle_status as enum ('draft', 'open', 'closed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.appraisal_submission_status as enum ('draft', 'submitted', 'under_review', 'returned', 'approved', 'rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.review_action as enum ('comment', 'return', 'approve', 'reject'); exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text,
  city text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name),
  unique (institution_id, code)
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'faculty',
  full_name text not null,
  email text not null unique,
  phone text,
  photo_url text,
  bio text,
  institution_id uuid references public.institutions(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  research_interests text[] not null default '{}',
  teaching_interests text[] not null default '{}',
  expertise text[] not null default '{}',
  career_goals text,
  open_to_mentorship boolean not null default false,
  open_to_collaboration boolean not null default false,
  accepting_phd_inquiries boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.faculty_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  institution_id uuid references public.institutions(id) on delete set null,
  employee_code text,
  designation text,
  date_joined date,
  current_academic_year text,
  orcid_id text,
  scholar_url text,
  openalex_author_id text,
  qualifications jsonb not null default '[]'::jsonb,
  phd_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists faculty_profiles_employee_code_idx on public.faculty_profiles(institution_id, employee_code) where employee_code is not null and employee_code <> '';

create table if not exists public.academic_activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category public.activity_category not null,
  title text not null,
  description text,
  role text,
  organization text,
  location text,
  start_date date,
  end_date date,
  duration_hours numeric,
  academic_year text not null,
  doi text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  visibility public.visibility_level not null default 'private',
  status public.activity_status not null default 'confirmed',
  source public.activity_source not null default 'manual',
  source_ref jsonb not null default '{}'::jsonb,
  confidence numeric,
  evidence_status public.evidence_status_t not null default 'none_needed',
  confirmed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists academic_activities_owner_status_idx on public.academic_activities(owner_id, status);
create index if not exists academic_activities_owner_category_year_idx on public.academic_activities(owner_id, category, academic_year);
create index if not exists academic_activities_year_idx on public.academic_activities(academic_year);
create index if not exists academic_activities_title_trgm_idx on public.academic_activities using gin(title gin_trgm_ops);
create table if not exists public.activity_participants (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.academic_activities(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (activity_id, profile_id)
);

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text,
  source public.evidence_source not null default 'upload',
  extracted_title text,
  extracted_text_snippet text,
  doc_date date,
  organization text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists evidence_files_owner_idx on public.evidence_files(owner_id, created_at desc);
create table if not exists public.activity_evidence (
  activity_id uuid not null references public.academic_activities(id) on delete cascade,
  evidence_id uuid not null references public.evidence_files(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, evidence_id)
);

create table if not exists public.publication_records (
  id uuid primary key default gen_random_uuid(),
  doi text unique,
  title text not null,
  normalized_title_hash text,
  venue text,
  publisher text,
  publication_type text,
  year integer,
  month integer,
  citation_count integer,
  openalex_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists publication_records_title_year_idx on public.publication_records(normalized_title_hash, year) where doi is null;
create table if not exists public.publication_authors (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publication_records(id) on delete cascade,
  position integer not null,
  author_name text not null,
  orcid_id text,
  openalex_author_id text,
  affiliation text,
  profile_id uuid references public.profiles(id) on delete set null,
  unique (publication_id, position)
);
create table if not exists public.publication_candidates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  publication_id uuid not null references public.publication_records(id) on delete cascade,
  source text not null,
  match_score numeric,
  match_reasons jsonb not null default '{}'::jsonb,
  status public.publication_candidate_status not null default 'pending',
  activity_id uuid references public.academic_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, publication_id)
);

create table if not exists public.appraisal_templates (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name)
);
create table if not exists public.appraisal_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.appraisal_templates(id) on delete cascade,
  position integer not null,
  title text not null,
  description text,
  categories public.activity_category[] not null default '{}',
  required boolean not null default false,
  allow_free_text boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, position)
);
create table if not exists public.appraisal_cycles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  academic_year text not null,
  opens_at timestamptz,
  due_at timestamptz,
  status public.cycle_status not null default 'draft',
  template_id uuid not null references public.appraisal_templates(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, academic_year)
);
create table if not exists public.appraisal_submissions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.appraisal_cycles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status public.appraisal_submission_status not null default 'draft',
  submitted_at timestamptz,
  decided_at timestamptz,
  readiness numeric not null default 0,
  generated_pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, profile_id)
);
create index if not exists appraisal_submissions_status_idx on public.appraisal_submissions(status, updated_at desc);
create table if not exists public.appraisal_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.appraisal_submissions(id) on delete cascade,
  section_id uuid not null references public.appraisal_sections(id) on delete cascade,
  activity_id uuid references public.academic_activities(id) on delete set null,
  free_text text,
  position integer not null default 0,
  faculty_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, section_id, activity_id)
);
create table if not exists public.appraisal_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.appraisal_submissions(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  action public.review_action not null,
  section_id uuid references public.appraisal_sections(id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists appraisal_reviews_submission_idx on public.appraisal_reviews(submission_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  link_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_profile_unread_idx on public.notifications(profile_id, read_at, created_at desc);
create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  submission_id uuid references public.appraisal_submissions(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  created_at timestamptz not null default now()
);

drop trigger if exists institutions_updated_at on public.institutions;
create trigger institutions_updated_at before update on public.institutions for each row execute function public.set_updated_at();
drop trigger if exists departments_updated_at on public.departments;
create trigger departments_updated_at before update on public.departments for each row execute function public.set_updated_at();
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists faculty_profiles_updated_at on public.faculty_profiles;
create trigger faculty_profiles_updated_at before update on public.faculty_profiles for each row execute function public.set_updated_at();
drop trigger if exists academic_activities_updated_at on public.academic_activities;
create trigger academic_activities_updated_at before update on public.academic_activities for each row execute function public.set_updated_at();
drop trigger if exists evidence_files_updated_at on public.evidence_files;
create trigger evidence_files_updated_at before update on public.evidence_files for each row execute function public.set_updated_at();
drop trigger if exists publication_records_updated_at on public.publication_records;
create trigger publication_records_updated_at before update on public.publication_records for each row execute function public.set_updated_at();
drop trigger if exists publication_candidates_updated_at on public.publication_candidates;
create trigger publication_candidates_updated_at before update on public.publication_candidates for each row execute function public.set_updated_at();
drop trigger if exists appraisal_templates_updated_at on public.appraisal_templates;
create trigger appraisal_templates_updated_at before update on public.appraisal_templates for each row execute function public.set_updated_at();
drop trigger if exists appraisal_sections_updated_at on public.appraisal_sections;
create trigger appraisal_sections_updated_at before update on public.appraisal_sections for each row execute function public.set_updated_at();
drop trigger if exists appraisal_cycles_updated_at on public.appraisal_cycles;
create trigger appraisal_cycles_updated_at before update on public.appraisal_cycles for each row execute function public.set_updated_at();
drop trigger if exists appraisal_submissions_updated_at on public.appraisal_submissions;
create trigger appraisal_submissions_updated_at before update on public.appraisal_submissions for each row execute function public.set_updated_at();
drop trigger if exists appraisal_submission_items_updated_at on public.appraisal_submission_items;
create trigger appraisal_submission_items_updated_at before update on public.appraisal_submission_items for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  institution_row uuid;
  department_row uuid;
  institution_name text := nullif(trim(meta->>'institution'), '');
  department_name text := nullif(trim(meta->>'department'), '');
begin
  if institution_name is not null then
    insert into public.institutions(name) values (institution_name)
      on conflict (name) do update set name = excluded.name returning id into institution_row;
  end if;
  if institution_row is not null and department_name is not null then
    insert into public.departments(institution_id, name) values (institution_row, department_name)
      on conflict (institution_id, name) do update set name = excluded.name returning id into department_row;
  end if;
  insert into public.profiles(id, role, full_name, email, institution_id, department_id)
    values (new.id, 'faculty', coalesce(nullif(trim(meta->>'full_name'), ''), split_part(new.email, '@', 1)), new.email, institution_row, department_row)
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.faculty_profiles(profile_id, institution_id, employee_code)
    values (new.id, institution_row, nullif(trim(meta->>'employee_code'), ''))
    on conflict (profile_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin_for_institution(target_institution uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','dept_admin','institution_admin','reviewer') and institution_id = target_institution)
$$;

alter table public.institutions enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.faculty_profiles enable row level security;
alter table public.academic_activities enable row level security;
alter table public.activity_participants enable row level security;
alter table public.evidence_files enable row level security;
alter table public.activity_evidence enable row level security;
alter table public.publication_records enable row level security;
alter table public.publication_authors enable row level security;
alter table public.publication_candidates enable row level security;
alter table public.appraisal_templates enable row level security;
alter table public.appraisal_sections enable row level security;
alter table public.appraisal_cycles enable row level security;
alter table public.appraisal_submissions enable row level security;
alter table public.appraisal_submission_items enable row level security;
alter table public.appraisal_reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.generated_documents enable row level security;

drop policy if exists institutions_read_authenticated on public.institutions;
create policy institutions_read_authenticated on public.institutions for select to authenticated using (true);
drop policy if exists departments_read_authenticated on public.departments;
create policy departments_read_authenticated on public.departments for select to authenticated using (true);
drop policy if exists profiles_self_or_admin_read on public.profiles;
create policy profiles_self_or_admin_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin_for_institution(institution_id));
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists faculty_profiles_self_or_admin_read on public.faculty_profiles;
create policy faculty_profiles_self_or_admin_read on public.faculty_profiles for select to authenticated using (profile_id = auth.uid() or public.is_admin_for_institution(institution_id));
drop policy if exists faculty_profiles_self_update on public.faculty_profiles;
create policy faculty_profiles_self_update on public.faculty_profiles for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists activities_owner_or_admin on public.academic_activities;
create policy activities_owner_or_admin on public.academic_activities for all to authenticated using (owner_id = auth.uid() or exists(select 1 from public.profiles p where p.id = owner_id and public.is_admin_for_institution(p.institution_id))) with check (owner_id = auth.uid());
drop policy if exists participants_owner on public.activity_participants;
create policy participants_owner on public.activity_participants for all to authenticated using (exists(select 1 from public.academic_activities a where a.id = activity_id and a.owner_id = auth.uid())) with check (exists(select 1 from public.academic_activities a where a.id = activity_id and a.owner_id = auth.uid()));
drop policy if exists evidence_owner on public.evidence_files;
create policy evidence_owner on public.evidence_files for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists activity_evidence_owner on public.activity_evidence;
create policy activity_evidence_owner on public.activity_evidence for all to authenticated using (exists(select 1 from public.academic_activities a where a.id = activity_id and a.owner_id = auth.uid())) with check (exists(select 1 from public.academic_activities a where a.id = activity_id and a.owner_id = auth.uid()));
drop policy if exists publication_candidates_owner on public.publication_candidates;
create policy publication_candidates_owner on public.publication_candidates for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists publication_records_read_authenticated on public.publication_records;
create policy publication_records_read_authenticated on public.publication_records for select to authenticated using (exists(select 1 from public.publication_candidates c where c.publication_id = id and c.profile_id = auth.uid()) or exists(select 1 from public.academic_activities a where a.owner_id = auth.uid() and a.category = 'publication' and (a.doi is not null or a.metadata->>'publication_id' = id::text)));
drop policy if exists publication_authors_read_authenticated on public.publication_authors;
create policy publication_authors_read_authenticated on public.publication_authors for select to authenticated using (
  exists (
    select 1 from public.publication_candidates c
    where c.publication_id = publication_id and c.profile_id = auth.uid()
  )
  or exists (
    select 1 from public.academic_activities a
    where a.owner_id = auth.uid()
      and a.category = 'publication'
      and a.metadata->>'publication_id' = publication_id::text
  )
);
drop policy if exists cycles_institution_read on public.appraisal_cycles;
create policy cycles_institution_read on public.appraisal_cycles for select to authenticated using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists templates_institution_read on public.appraisal_templates;
create policy templates_institution_read on public.appraisal_templates for select to authenticated using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id));
drop policy if exists sections_cycle_read on public.appraisal_sections;
create policy sections_cycle_read on public.appraisal_sections for select to authenticated using (exists(select 1 from public.appraisal_templates t join public.appraisal_cycles c on c.template_id = t.id join public.profiles p on p.institution_id = c.institution_id where t.id = template_id and p.id = auth.uid()));
drop policy if exists submissions_owner_or_admin on public.appraisal_submissions;
create policy submissions_owner_or_admin on public.appraisal_submissions for all to authenticated using (profile_id = auth.uid() or exists(select 1 from public.profiles p where p.id = profile_id and public.is_admin_for_institution(p.institution_id))) with check (profile_id = auth.uid() or exists(select 1 from public.profiles p where p.id = profile_id and public.is_admin_for_institution(p.institution_id)));
drop policy if exists submission_items_owner_or_admin on public.appraisal_submission_items;
create policy submission_items_owner_or_admin on public.appraisal_submission_items for all to authenticated using (exists(select 1 from public.appraisal_submissions s where s.id = submission_id and (s.profile_id = auth.uid() or exists(select 1 from public.profiles p where p.id = s.profile_id and public.is_admin_for_institution(p.institution_id))))) with check (exists(select 1 from public.appraisal_submissions s where s.id = submission_id and (s.profile_id = auth.uid() or exists(select 1 from public.profiles p where p.id = s.profile_id and public.is_admin_for_institution(p.institution_id)))));
drop policy if exists reviews_owner_or_admin on public.appraisal_reviews;
create policy reviews_owner_or_admin on public.appraisal_reviews for select to authenticated using (exists(select 1 from public.appraisal_submissions s where s.id = submission_id and (s.profile_id = auth.uid() or reviewer_id = auth.uid() or exists(select 1 from public.profiles p where p.id = s.profile_id and public.is_admin_for_institution(p.institution_id)))));
drop policy if exists notifications_owner on public.notifications;
create policy notifications_owner on public.notifications for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists generated_owner_or_admin on public.generated_documents;
create policy generated_owner_or_admin on public.generated_documents for select to authenticated using (owner_id = auth.uid() or exists(select 1 from public.profiles p where p.id = owner_id and public.is_admin_for_institution(p.institution_id)));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('evidence', 'evidence', false, 26214400, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]),
  ('generated', 'generated', false, 10485760, array['application/pdf']::text[]),
  ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists evidence_objects_owner on storage.objects;
create policy evidence_objects_owner on storage.objects for all to authenticated using (bucket_id = 'evidence' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists generated_objects_owner on storage.objects;
create policy generated_objects_owner on storage.objects for select to authenticated using (
  bucket_id = 'generated'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1
      from public.profiles owner_profile
      where owner_profile.id::text = (storage.foldername(name))[1]
        and public.is_admin_for_institution(owner_profile.institution_id)
    )
  )
);
drop policy if exists avatar_objects_owner on storage.objects;
create policy avatar_objects_owner on storage.objects for all to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.appraisal_submissions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.appraisal_reviews; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;
