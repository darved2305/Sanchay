-- Smart Academic Repository: document classification fields on the existing
-- evidence_files table (product expansion §8-14) + Student Outcome
-- Intelligence (§15-17), which reuses the same classification pipeline and
-- links into the LOR Studio student model (006_lor_studio.sql) rather than
-- creating a parallel one.

do $$ begin create type public.document_category as enum ('research', 'teaching', 'professional_development', 'academic_service', 'student_mentorship', 'administration', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.outcome_type as enum ('ojt', 'internship', 'placement', 'research_internship', 'apprenticeship', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.outcome_completion_status as enum ('pending', 'ongoing', 'completed'); exception when duplicate_object then null; end $$;

-- document_type is intentionally free text, not an enum: the taxonomy has
-- ~25 leaf values across 6 categories (spec §10) and admins/future document
-- kinds should not require a migration to add one, matching how goal_key on
-- career_rules and kind on opportunities are already handled as text.
alter table public.evidence_files add column if not exists document_category public.document_category;
alter table public.evidence_files add column if not exists document_type text;
alter table public.evidence_files add column if not exists classification_confidence numeric;
alter table public.evidence_files add column if not exists needs_confirmation boolean not null default false;
alter table public.evidence_files add column if not exists proposed_activity_id uuid references public.academic_activities(id) on delete set null;
alter table public.evidence_files add column if not exists extracted_text_full text;

create table if not exists public.student_outcomes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_records(id) on delete cascade,
  evidence_id uuid references public.evidence_files(id) on delete set null,
  company text,
  role text,
  outcome_type public.outcome_type not null default 'other',
  offer_date date,
  start_date date,
  end_date date,
  completion_status public.outcome_completion_status not null default 'pending',
  academic_year text,
  confidence numeric,
  created_by uuid not null references public.profiles(id) on delete restrict,
  -- Mentor credit: a faculty who is linked to this student (faculty_student_links)
  -- can confirm this outcome into a real academic_activities(category=mentorship)
  -- row. Never silent -- mirrors the event_participants confirmation pattern.
  mentor_confirmed_by uuid references public.profiles(id) on delete set null,
  mentor_activity_id uuid references public.academic_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_outcomes_student_idx on public.student_outcomes(student_id);
create index if not exists student_outcomes_company_idx on public.student_outcomes(company);
create index if not exists student_outcomes_academic_year_idx on public.student_outcomes(academic_year);
drop trigger if exists student_outcomes_updated_at on public.student_outcomes;
create trigger student_outcomes_updated_at before update on public.student_outcomes for each row execute function public.set_updated_at();

alter table public.student_outcomes enable row level security;

-- Same visibility shape as student_records: anyone in the institution can
-- read (admin/institution "Student Outcome Intelligence" view, spec §16),
-- but only a faculty linked to the student (or the record's creator) can write.
drop policy if exists student_outcomes_institution_read on public.student_outcomes;
create policy student_outcomes_institution_read on public.student_outcomes for select to authenticated using (
  exists(
    select 1 from public.student_records sr
    join public.profiles p on p.institution_id = sr.institution_id
    where sr.id = student_id and p.id = auth.uid()
  )
);
drop policy if exists student_outcomes_linked_faculty_write on public.student_outcomes;
create policy student_outcomes_linked_faculty_write on public.student_outcomes for insert to authenticated with check (
  created_by = auth.uid()
  and exists(select 1 from public.faculty_student_links l where l.student_id = student_id and l.faculty_id = auth.uid())
);
drop policy if exists student_outcomes_linked_faculty_update on public.student_outcomes;
create policy student_outcomes_linked_faculty_update on public.student_outcomes for update to authenticated using (
  exists(select 1 from public.faculty_student_links l where l.student_id = student_id and l.faculty_id = auth.uid())
) with check (
  exists(select 1 from public.faculty_student_links l where l.student_id = student_id and l.faculty_id = auth.uid())
);
