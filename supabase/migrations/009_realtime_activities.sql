-- academic_activities is the one table every pipeline in the product writes
-- into (Quick Add, CV Import, Reconstruct My Year confirm, Teaching Change
-- approve, publications sync, admin bulk actions) but it was never added to
-- the supabase_realtime publication, so none of those writes ever reached a
-- subscribed client -- the Activities page only updated when the tab that
-- performed the action manually invalidated its own query cache. Every other
-- open tab/device, and every background-job-driven insert the current tab
-- wasn't the one that triggered, went stale until a manual refresh.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.academic_activities; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.form_jobs; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.teaching_changes; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.career_recommendations; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.recommendation_letters; exception when duplicate_object then null; end;
  end if;
end $$;
