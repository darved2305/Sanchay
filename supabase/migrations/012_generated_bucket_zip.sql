-- Bug found via live end-to-end testing of the Smart Academic Repository's
-- bulk ZIP export (product expansion §14): the 'generated' bucket's
-- allowed_mime_types (widened once already in 003_generated_bucket_mime_types.sql
-- for Any Form/Promotion Dossier) still didn't include application/zip, so
-- every bulk-download job failed at the final upload step with
-- InvalidMimeType. Same class of bug, same fix shape: widen the bucket
-- rather than route exports through a different bucket.

update storage.buckets set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip'
]::text[]
where id = 'generated';
