# Handoff - Compulsory dynamic Supabase system
Written: 2026-08-12T22:59:30+05:30 by Codex

## Goal
Turn the existing faculty/admin frontend into a real Supabase-backed compulsory product: Auth, profiles, activities, evidence, publications, appraisal, admin review, realtime notifications, PDF export, RLS, and tests. Preserve the existing visual UI and do not implement or expand any USP.

## Done (verified)
- Current `main` and `origin/main` are both commit `076ae69` (`Complete compulsory dynamic system QA`).
- Hosted Supabase project `fcnmmxxnhrolgaxetnyz` has the migration applied and the idempotent seed run twice.
- Live Auth role routing, profile provisioning, ownership/RLS isolation, private Storage signed downloads, and seeded faculty/admin data were verified.
- Seeded hosted state is clean: 2 seed profiles, 9 confirmed seed activities, 1 open appraisal cycle, and 0 temporary QA profiles.
- Faculty profile, activity CRUD/filtering, dashboard aggregates, evidence upload/attach/download, publication candidate flow, appraisal generation/submit, admin review, notifications, PDF export, and 5-second polling fallback are implemented.
- Two-browser appraisal flow passed locally against hosted Supabase: submit → admin sees → return/comment → faculty sees returned → resubmit → approve → faculty sees Approved.
- Evidence browser round-trip passed: upload → private Storage → finalize → attach → reload → signed download.
- `uv run --with-requirements backend/requirements.txt pytest backend/tests -q`: 20 passed, 6 live-DB tests skipped.
- `cd frontend && npm run lint && npm run build`: passed; only the existing Vite large-chunk warning remains.
- `python3 qa/audit_p0.py`: clean. `git diff --check`: clean. Local `/health`, `/ready`, and frontend smoke checks returned 200.
- Truthful feature/page/test/deployment status is in [COMPULSORY_DYNAMIC_IMPLEMENTATION_AUDIT.md](COMPULSORY_DYNAMIC_IMPLEMENTATION_AUDIT.md).

## Not done / in progress
- Vercel frontend and Railway FastAPI deployment are not completed; local services are the verified runtime.
- Live publication-provider response still needs a real faculty ORCID and available ORCID/OpenAlex/Crossref provider response; connector and dedupe contracts are implemented.
- Raw PostgreSQL CLI access is not currently available from this network; future migration reconciliation needs a working pooler/IPv4 route or Supabase HTTPS Management API.
- No permanent evidence object is seeded; temporary evidence fixtures were uploaded, verified, and deleted.
- The following remain intentionally deferred: Reconstruct My Year, Form Assistant, Deadline Rescue, advanced Evidence Autopilot, Shared Academic Facts, Admin Request Autopilot, Teaching Change Detector, Promotion Dossier, Next Best Academic Move, Academic Network, Community, Messaging, LOR Studio, CV Import Bootstrap, Voice Dump, browser automation, coauthor propagation, student achievement automation, and career recommendations.

## Failed approaches - do not retry
- `supabase link` / direct database connection on port 5432 → pooler TLS timed out and the direct database hostname had no reachable IPv6 route. Use Supabase HTTPS APIs or a network with PostgreSQL access.
- Direct pooled PostgreSQL configuration on port 5432 → blocked by the current VPN/network. The working deployment shape is the transaction pooler on port 6543 with `statement_cache_size=0`; see `backend/app/core/db.py` and `.env.example`.
- Do not force-push or retry Git operations using `hetansh-titan` for this remote; that account is active again but GitHub reports the repository as not visible to it. The push was completed with `HetanshWaghela`.

## Decisions made (and why)
- Keep the existing Vite/React frontend and FastAPI backend; no visual rewrite.
- Supabase PostgreSQL/Auth/Storage/Realtime is the source of truth; no business data uses localStorage, sessionStorage, IndexedDB, or frontend mock arrays.
- Academic activities are the core object; appraisal sections are generated from confirmed activities.
- Realtime subscriptions invalidate shared query cache, with polling fallback every 5 seconds.
- Backend auth uses Supabase JWKS/ES256 verification and every query is principal/institution scoped; service-role access is limited to Storage/seed operations.
- Demo identities exist only in `scripts/seed_supabase.py` and the hosted database, not compulsory UI components.

## Gotchas for the next agent
- Do not stage `.agents/` or `skills-lock.json`; they are local skill-install artifacts. `HANDOFF.md` is also a scratch baton and should not be committed unless explicitly requested.
- Do not print, commit, or copy any Supabase service-role key, JWT secret, database password, seed password, or GitHub token. Use `.env.example` as the contract only.
- Backend reads a root `.env`; Vite reads `frontend/.env.local`. Required names and deployment values are documented in `.env.example`.
- Start backend from the repository root with `uv run --with-requirements backend/requirements.txt uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000` (or follow `backend/README.md`). Start frontend with `cd frontend && npm run dev -- --host 127.0.0.1 --port 5173`.
- Seed tooling is `python scripts/seed_supabase.py`; it requires environment-only `SEED_*` passwords and is idempotent. Never hardcode those values in frontend code.
- `SUPABASE_JWT_JWKS_URL` may be used instead of `SUPABASE_JWT_SECRET`; `/ready` deliberately reports missing required production configuration.
- The active `gh` account is restored to `hetansh-titan`; the successful push was made while temporarily switched to `HetanshWaghela`.

## Next step
Configure deployment environment variables from `.env.example`, deploy FastAPI to Railway first, verify `/health` and `/ready`, then point the Vercel frontend at the Railway API and run the browser smoke/realtime workflow again. Keep the compulsory-only scope and leave every USP visually intact/deferred.
