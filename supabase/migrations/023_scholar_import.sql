-- Google Scholar paste-import (Activities & Record page): publications are
-- auto-confirmed straight into academic_activities (no pending review step,
-- unlike the ORCID sync flow), so they need their own source tag.

alter type public.activity_source add value if not exists 'scholar_import';
