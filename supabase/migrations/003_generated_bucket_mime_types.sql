-- Bug found via live end-to-end testing of USP 2 (Any Form Assistant): the
-- 'generated' bucket only allowed application/pdf (set in 001_compulsory.sql),
-- but Any Form's completed output is an .xlsx file, and Promotion Dossier/CV
-- export outputs may also be non-PDF in the future. Widen the bucket's
-- allowed MIME types instead of routing generated documents through a
-- different bucket.

update storage.buckets set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]::text[]
where id = 'generated';
