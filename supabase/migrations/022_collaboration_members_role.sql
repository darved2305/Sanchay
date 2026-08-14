-- api/network.py's add_collaboration_member/get_collaboration_workspace read
-- and write a `role` column on collaboration_members (e.g. "co-PI",
-- "domain specialist") that 018_professional_network_extensions.sql's table
-- definition doesn't have -- added here rather than reopening an
-- already-applied migration file.

alter table public.collaboration_members add column if not exists role text;
