# QA checks

Install the backend test dependencies in the backend environment, then run:

```bash
python -m pytest backend/tests -q
python qa/audit_p0.py
```

The helper/API tests skip when the backend app or its test dependencies are not
present. Live checks also skip unless `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL` are set. Seed idempotency is
additionally opt-in with `QA_ALLOW_SEED_TEST=1` and must target an isolated
test database. Ownership API tests use a real test fixture supplied through
`QA_SECURITY_FIXTURE_FACTORY` or `QA_SECURITY_DATASET_JSON`; they never seed
fake records in the application.

Useful optional settings:

- `QA_APP_MODULE=app.main:app` (or the repository's equivalent app module)
- `QA_HELPER_MODULES=app.modules.activities.service,...`
- `QA_SEED_COMMAND='python backend/scripts/seed.py'`

The P0 audit reports source locations and exits nonzero only for compulsory
hardcode/storage/dead-action violations; deferred USP files and test fixtures
are excluded.
