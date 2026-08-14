-- Adaptive Career Navigator (product expansion §26-33): user-authored and
-- system-suggested career goals, as a second goal *source* alongside the
-- existing institution-authored career_rules/career_goals catalog
-- (002_usps.sql, USP 8), which is left unchanged. A faculty member's active
-- goals are the union of at most one active rule-catalog goal (unchanged
-- semantics) plus any number of active custom_career_goals rows.

do $$ begin create type public.custom_goal_status as enum ('active', 'dismissed', 'completed'); exception when duplicate_object then null; end $$;

create table if not exists public.custom_career_goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  target_date date,
  -- [{key, label, target}] -- key is a loose activity_category-shaped token
  -- ("publication", "grant", "mentorship", "collaboration", "patent", "other");
  -- progress is a plain count against target, never a fabricated percentage.
  measurable_outcomes jsonb not null default '[]'::jsonb,
  raw_text text,
  source text not null default 'custom', -- custom | suggested
  status public.custom_goal_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_career_goals_profile_idx on public.custom_career_goals(profile_id, status);
drop trigger if exists custom_career_goals_updated_at on public.custom_career_goals;
create trigger custom_career_goals_updated_at before update on public.custom_career_goals for each row execute function public.set_updated_at();

alter table public.custom_career_goals enable row level security;
drop policy if exists custom_career_goals_owner on public.custom_career_goals;
create policy custom_career_goals_owner on public.custom_career_goals for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.custom_career_goals; exception when duplicate_object then null; end;
  end if;
end $$;
