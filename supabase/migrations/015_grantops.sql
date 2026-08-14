-- GrantOps (product expansion §18-25): the research-funding journey from
-- opportunity discovery through eligibility, team formation, submission, and
-- post-award AcademicActivity credit. Reuses the Repository's document
-- classification (011_repository_classification.sql) for readiness matching
-- and the Professional Network (008_academic_network.sql) for team-formation
-- recommendations, rather than building parallel document/people systems.
-- `opportunities` (002_usps.sql) remains the generic career-recommendation
-- feed; a grant_opportunities row is the GrantOps-specific superset with
-- stage/eligibility/team-workspace structure a plain opportunity doesn't need.

do $$ begin create type public.grant_stage as enum (
  'discovered', 'interested', 'eligibility_check', 'team_formation', 'preparing',
  'internal_review', 'ready_to_submit', 'submitted', 'awarded', 'rejected',
  'active', 'completed', 'archived'
); exception when duplicate_object then null; end $$;

create table if not exists public.grant_opportunities (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null,
  agency text,
  description text,
  url text,
  deadline date,
  amount text,
  disciplines text[] not null default '{}',
  -- {min_designation_rank, requires_phd, min_publications, min_grants, notes[]}
  -- -- same "data-driven rules jsonb, not hardcoded Python" shape as
  -- career_rules.rules (002_usps.sql), so eligibility stays explainable and
  -- editable without a migration per grant.
  eligibility_rules jsonb not null default '{}'::jsonb,
  required_documents text[] not null default '{}',
  source text not null default 'manual',
  source_signal_id uuid references public.source_signals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists grant_opportunities_institution_idx on public.grant_opportunities(institution_id, deadline);
drop trigger if exists grant_opportunities_updated_at on public.grant_opportunities;
create trigger grant_opportunities_updated_at before update on public.grant_opportunities for each row execute function public.set_updated_at();

create table if not exists public.grant_workspaces (
  id uuid primary key default gen_random_uuid(),
  grant_opportunity_id uuid not null references public.grant_opportunities(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  stage public.grant_stage not null default 'discovered',
  notes text,
  submitted_at timestamptz,
  awarded_at timestamptz,
  award_amount text,
  -- Set once the awarded-grant proposal is created (never silent credit --
  -- same propose-then-confirm pattern as event_participants/Shared Academic
  -- Facts, §25). The activity itself carries status='proposed' until the
  -- faculty confirms it via the existing generic POST /activities/{id}/confirm.
  activity_id uuid references public.academic_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grant_opportunity_id, owner_id)
);
create index if not exists grant_workspaces_owner_idx on public.grant_workspaces(owner_id, stage);
drop trigger if exists grant_workspaces_updated_at on public.grant_workspaces;
create trigger grant_workspaces_updated_at before update on public.grant_workspaces for each row execute function public.set_updated_at();

create table if not exists public.grant_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grant_workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'invited',
  created_at timestamptz not null default now(),
  unique (workspace_id, profile_id)
);

create table if not exists public.grant_workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.grant_workspaces(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  due_date date,
  created_at timestamptz not null default now()
);

-- Faculty Action Inbox's "Send to GrantOps" action (013_action_inbox.sql,
-- product expansion §7/§19) links the created workspace back onto the inbox
-- item it came from, so "Related Emails" on a grant workspace is a real join,
-- not a second copy of the email.
do $$ begin
  alter table public.action_inbox_items
    add constraint action_inbox_items_grant_workspace_fk
    foreign key (related_grant_workspace_id) references public.grant_workspaces(id) on delete set null;
exception when duplicate_object then null;
end $$;

alter table public.grant_opportunities enable row level security;
alter table public.grant_workspaces enable row level security;
alter table public.grant_workspace_members enable row level security;
alter table public.grant_workspace_tasks enable row level security;

drop policy if exists grant_opportunities_institution_read on public.grant_opportunities;
create policy grant_opportunities_institution_read on public.grant_opportunities for select to authenticated using (
  institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id)
);
-- Grants can be added by an institution admin (curated catalog, like
-- opportunities) OR by the faculty who discovered/created it (e.g. via Action
-- Inbox "Send to GrantOps", §19) -- unlike opportunities, GrantOps sourcing
-- is not admin-only.
drop policy if exists grant_opportunities_write on public.grant_opportunities;
create policy grant_opportunities_write on public.grant_opportunities for all to authenticated using (
  created_by = auth.uid() or institution_id is null or public.is_admin_for_institution(institution_id)
) with check (
  created_by = auth.uid() or institution_id is null or public.is_admin_for_institution(institution_id)
);

drop policy if exists grant_workspaces_owner_or_member on public.grant_workspaces;
create policy grant_workspaces_owner_or_member on public.grant_workspaces for select to authenticated using (
  owner_id = auth.uid() or exists(select 1 from public.grant_workspace_members m where m.workspace_id = id and m.profile_id = auth.uid())
);
drop policy if exists grant_workspaces_owner_write on public.grant_workspaces;
create policy grant_workspaces_owner_write on public.grant_workspaces for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists grant_workspaces_owner_update on public.grant_workspaces;
create policy grant_workspaces_owner_update on public.grant_workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists grant_workspaces_owner_delete on public.grant_workspaces;
create policy grant_workspaces_owner_delete on public.grant_workspaces for delete to authenticated using (owner_id = auth.uid());

drop policy if exists grant_workspace_members_visible on public.grant_workspace_members;
create policy grant_workspace_members_visible on public.grant_workspace_members for select to authenticated using (
  profile_id = auth.uid() or exists(select 1 from public.grant_workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
drop policy if exists grant_workspace_members_owner_write on public.grant_workspace_members;
create policy grant_workspace_members_owner_write on public.grant_workspace_members for insert to authenticated with check (
  exists(select 1 from public.grant_workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
drop policy if exists grant_workspace_members_self_update on public.grant_workspace_members;
create policy grant_workspace_members_self_update on public.grant_workspace_members for update to authenticated using (
  profile_id = auth.uid() or exists(select 1 from public.grant_workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
) with check (
  profile_id = auth.uid() or exists(select 1 from public.grant_workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
drop policy if exists grant_workspace_members_owner_delete on public.grant_workspace_members;
create policy grant_workspace_members_owner_delete on public.grant_workspace_members for delete to authenticated using (
  exists(select 1 from public.grant_workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

drop policy if exists grant_workspace_tasks_visible on public.grant_workspace_tasks;
create policy grant_workspace_tasks_visible on public.grant_workspace_tasks for all to authenticated using (
  exists(
    select 1 from public.grant_workspaces w where w.id = workspace_id
    and (w.owner_id = auth.uid() or exists(select 1 from public.grant_workspace_members m where m.workspace_id = w.id and m.profile_id = auth.uid()))
  )
) with check (
  exists(select 1 from public.grant_workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.grant_workspaces; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.grant_workspace_tasks; exception when duplicate_object then null; end;
  end if;
end $$;
