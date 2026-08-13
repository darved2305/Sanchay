-- Google OAuth callback support: encrypted token storage on the existing
-- oauth_connections table (migration 002 created the table with status
-- tracking only; tokens themselves were never persisted until now).

alter table public.oauth_connections
  add column if not exists encrypted_access_token text,
  add column if not exists encrypted_refresh_token text;
