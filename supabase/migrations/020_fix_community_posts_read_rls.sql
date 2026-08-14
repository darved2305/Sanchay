-- Security fix found via routine schema inspection while building Professional
-- Network extensions: community_posts_read (008_academic_network.sql) wrote
-- its correlated subquery as
--   exists(select 1 from community_members m where m.community_id = community_id and m.profile_id = auth.uid())
-- Postgres resolves the unqualified `community_id` against the innermost
-- scope first -- since community_members also has a community_id column, it
-- bound to m.community_id, not the intended outer community_posts.community_id,
-- producing the tautology `m.community_id = m.community_id` (confirmed via
-- `select qual from pg_policies`). Net effect: any authenticated faculty who
-- is a member of at least one community could read posts belonging to ANY
-- community via direct RLS-governed access (e.g. the Supabase JS client),
-- not just ones they'd joined. The backend's own get_feed query in
-- api/network.py was never affected (it filters membership explicitly in its
-- own SQL and connects with a role that bypasses RLS), but RLS is this
-- project's documented defense-in-depth layer for direct client access, so
-- this was a real gap, not just a style issue.

drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts for select to authenticated using (
  community_id is null
  or exists(select 1 from public.community_members m where m.community_id = community_posts.community_id and m.profile_id = auth.uid())
);
