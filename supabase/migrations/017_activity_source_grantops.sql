-- Bug found via live end-to-end testing of GrantOps award flow (product
-- expansion §25): grantops.py proposes an AcademicActivity with
-- source='grantops', but the activity_source enum (001_compulsory.sql) never
-- had that value, so every awarded-grant proposal failed at insert time.

alter type public.activity_source add value if not exists 'grantops';
