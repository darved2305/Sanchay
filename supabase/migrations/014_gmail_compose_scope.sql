-- Incremental OAuth scope for Faculty Action Inbox draft creation (product
-- expansion §6): gmail.compose is requested separately from the existing
-- gmail.readonly connection, reusing the exact same oauth_connections table
-- and authorize/callback machinery (007_oauth_tokens.sql,
-- connectors/google.py) rather than a parallel token-storage mechanism.
-- Never bundled into the read-only Reconstruct My Year connection.

alter type public.oauth_provider add value if not exists 'gmail_compose';
