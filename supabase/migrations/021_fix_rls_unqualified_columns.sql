-- SECURITY FIX: a systemic, pre-existing bug across this project's RLS
-- policies (found via routine schema inspection while building Professional
-- Network extensions, same class as 020's community_posts_read fix).
--
-- Root cause: many policies write a correlated EXISTS subquery like
--   exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_id)
-- The unqualified column on the right (`institution_id`, `student_id`,
-- `conversation_id`, `publication_id`, `workspace_id`, `id`...) does NOT bind
-- to the outer policy table as the author intended. Postgres resolves
-- unqualified names against the INNERMOST query scope first; since the
-- subquery's own aliased table (`p`, `l`, `m`, `c`...) usually has a column
-- of the same name, the reference binds there instead, producing either a
-- self-referential tautology (`p.institution_id = p.institution_id`, always
-- true) or a comparison between two unrelated columns of the same inner row
-- (`c.publication_id = c.id`). Confirmed for every policy below via
-- `select qual, with_check from pg_policies` against the live database
-- before writing this fix -- this is not a theoretical concern.
--
-- Impact: institution-scoping and ownership-linkage RLS checks across
-- career_rules, opportunities, grant_opportunities, appraisal_cycles,
-- appraisal_templates, institution_events, mapping_hints, student_records,
-- student_achievements, student_outcomes, messages, conversation_members,
-- publication_authors, publication_records, and grant_workspaces were
-- effectively bypassable via any direct RLS-governed access path (the
-- Supabase JS client with a user's own JWT, not the FastAPI backend, which
-- connects with a role that bypasses RLS and applies its own explicit
-- owner/institution filters in every query -- confirmed unaffected).
--
-- Fix shape: qualify the right-hand side with the outer table's real name
-- (Postgres RLS policies can reference the policy's own table by name
-- directly in qual/with_check) instead of leaving it unqualified. No
-- semantic change beyond restoring the originally-intended scoping.

-- ---------- institution-scoped reads (profiles p / institution_id pattern) ----------

drop policy if exists cycles_institution_read on public.appraisal_cycles;
create policy cycles_institution_read on public.appraisal_cycles for select to authenticated using (
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = appraisal_cycles.institution_id)
);

drop policy if exists templates_institution_read on public.appraisal_templates;
create policy templates_institution_read on public.appraisal_templates for select to authenticated using (
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = appraisal_templates.institution_id)
);

drop policy if exists career_rules_institution_read on public.career_rules;
create policy career_rules_institution_read on public.career_rules for select to authenticated using (
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = career_rules.institution_id)
);

drop policy if exists grant_opportunities_institution_read on public.grant_opportunities;
create policy grant_opportunities_institution_read on public.grant_opportunities for select to authenticated using (
  institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = grant_opportunities.institution_id)
);

drop policy if exists institution_events_read on public.institution_events;
create policy institution_events_read on public.institution_events for select to authenticated using (
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = institution_events.institution_id)
);

drop policy if exists mapping_hints_institution_read on public.mapping_hints;
create policy mapping_hints_institution_read on public.mapping_hints for select to authenticated using (
  institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = mapping_hints.institution_id)
);
drop policy if exists mapping_hints_institution_write on public.mapping_hints;
create policy mapping_hints_institution_write on public.mapping_hints for insert to authenticated with check (
  institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = mapping_hints.institution_id)
);
drop policy if exists mapping_hints_institution_update on public.mapping_hints;
create policy mapping_hints_institution_update on public.mapping_hints for update to authenticated using (
  institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = mapping_hints.institution_id)
);

drop policy if exists opportunities_institution_read on public.opportunities;
create policy opportunities_institution_read on public.opportunities for select to authenticated using (
  institution_id is null or exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = opportunities.institution_id)
);

drop policy if exists student_records_institution_read on public.student_records;
create policy student_records_institution_read on public.student_records for select to authenticated using (
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = student_records.institution_id)
);
drop policy if exists student_records_creator_write on public.student_records;
create policy student_records_creator_write on public.student_records for insert to authenticated with check (
  exists(select 1 from public.profiles p where p.id = auth.uid() and p.institution_id = student_records.institution_id)
);

-- ---------- faculty_student_links l / student_id pattern ----------

drop policy if exists student_achievements_linked_faculty on public.student_achievements;
create policy student_achievements_linked_faculty on public.student_achievements for select to authenticated using (
  exists(select 1 from public.faculty_student_links l where l.student_id = student_achievements.student_id and l.faculty_id = auth.uid())
);
drop policy if exists student_achievements_linked_faculty_write on public.student_achievements;
create policy student_achievements_linked_faculty_write on public.student_achievements for insert to authenticated with check (
  exists(select 1 from public.faculty_student_links l where l.student_id = student_achievements.student_id and l.faculty_id = auth.uid())
);

drop policy if exists student_outcomes_linked_faculty_write on public.student_outcomes;
create policy student_outcomes_linked_faculty_write on public.student_outcomes for insert to authenticated with check (
  created_by = auth.uid()
  and exists(select 1 from public.faculty_student_links l where l.student_id = student_outcomes.student_id and l.faculty_id = auth.uid())
);
drop policy if exists student_outcomes_linked_faculty_update on public.student_outcomes;
create policy student_outcomes_linked_faculty_update on public.student_outcomes for update to authenticated using (
  exists(select 1 from public.faculty_student_links l where l.student_id = student_outcomes.student_id and l.faculty_id = auth.uid())
) with check (
  exists(select 1 from public.faculty_student_links l where l.student_id = student_outcomes.student_id and l.faculty_id = auth.uid())
);

-- ---------- conversation_members m / conversation_id pattern ----------

drop policy if exists messages_participant_read on public.messages;
create policy messages_participant_read on public.messages for select to authenticated using (
  exists(select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.profile_id = auth.uid())
);
drop policy if exists messages_participant_write on public.messages;
create policy messages_participant_write on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists(select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.profile_id = auth.uid())
);

drop policy if exists conversation_members_participant on public.conversation_members;
create policy conversation_members_participant on public.conversation_members for select to authenticated using (
  exists(select 1 from public.conversation_members m2 where m2.conversation_id = conversation_members.conversation_id and m2.profile_id = auth.uid())
);

-- ---------- publication_candidates c / publication_id pattern ----------

drop policy if exists publication_authors_read_authenticated on public.publication_authors;
create policy publication_authors_read_authenticated on public.publication_authors for select to authenticated using (
  exists(select 1 from public.publication_candidates c where c.publication_id = publication_authors.publication_id and c.profile_id = auth.uid())
  or exists(
    select 1 from public.academic_activities a
    where a.owner_id = auth.uid() and a.category = 'publication' and a.metadata->>'publication_id' = publication_authors.publication_id::text
  )
);

drop policy if exists publication_records_read_authenticated on public.publication_records;
create policy publication_records_read_authenticated on public.publication_records for select to authenticated using (
  exists(select 1 from public.publication_candidates c where c.publication_id = publication_records.id and c.profile_id = auth.uid())
  or exists(
    select 1 from public.academic_activities a
    where a.owner_id = auth.uid() and a.category = 'publication'
      and (a.doi is not null or a.metadata->>'publication_id' = publication_records.id::text)
  )
);

-- ---------- grant_workspace_members m / workspace_id-vs-id mixup ----------

drop policy if exists grant_workspaces_owner_or_member on public.grant_workspaces;
create policy grant_workspaces_owner_or_member on public.grant_workspaces for select to authenticated using (
  owner_id = auth.uid()
  or exists(select 1 from public.grant_workspace_members m where m.workspace_id = grant_workspaces.id and m.profile_id = auth.uid())
);
