# Sanchaya API

The API is a FastAPI service backed by the Supabase PostgreSQL database. It never falls back to an in-memory repository or a local uploads directory.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Apply `supabase/migrations/001_compulsory.sql` to the target Supabase project before starting the service. `/health` is process health; `/ready` is dependency readiness and returns 503 when environment/database/storage configuration is incomplete.

The API expects a Supabase access token in `Authorization: Bearer <jwt>`. Service-role access is used only for Storage operations and seed tooling; every business query is scoped to the authenticated profile or its institution.
