# Compulsory Dynamic Implementation Audit

## 1. Executive Status

The compulsory implementation is present in the repository as a production-shaped Vite + FastAPI + Supabase system. The local source, contract tests, frontend build, unauthenticated API smoke checks, schema/migration files, seed tooling, RLS policies, storage integration, and realtime fallback are implemented.

The hosted Supabase project `fcnmmxxnhrolgaxetnyz` is now reachable through the authenticated Supabase Management API. The migration was applied, the idempotent seed was run twice, and live Auth/RLS/isolation checks passed. Raw Postgres CLI linking remains unavailable from the current network because the pooler TLS route times out and the direct database hostname has no reachable IPv6 route; this does not prevent the hosted Supabase project from serving the application.

| Measure | Result |
| --- | --- |
| Compulsory feature code paths implemented | 12 / 12 |
| Dynamic compulsory data paths | 12 |
| Partially runtime-verified | Evidence API metadata/attach flow, publication provider sync, backend-over-Postgres, and two-browser realtime workflow |
| Hardcoded compulsory business data in faculty/admin paths | 0 |
| Broken local checks | 0 |
| Live Supabase schema/seed/Auth/RLS verification | Passed |
| Live application deployment verification | Pending Vercel/Railway deployment |

## 2. Feature Matrix

| FEATURE | FRONTEND | BACKEND | DATABASE | REALTIME | TEST | DEPLOYABLE | STATUS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Email/password auth and role redirect | Supabase browser session, validation, logout, session restore | JWT verification, `/auth/me`, faculty/admin guards | Auth trigger provisions `profiles` and `faculty_profiles` | Session-safe query invalidation | Contract + protected-route tests; live role login | Yes, after env/migration | Implemented; live Auth smoke passed |
| Faculty profile | DB-backed read/edit form | `GET/PATCH /profile` | `profiles`, `faculty_profiles`, institutions, departments | Query invalidation | API contract coverage; live profile provisioning | Yes | Implemented; provisioning live passed |
| Academic activity CRUD | Activity record, filters, edit/archive, evidence attach | Owner-scoped CRUD and server query filters | `academic_activities`, participants, indexes | Cache invalidation/polling | Academic-year, permission, API contract coverage; live ownership RLS | Yes | Implemented; live ownership RLS passed |
| Faculty dashboard | Real counters, recent activity, appraisal state | `/dashboard/faculty` aggregate queries | Activities, cycles, submissions, notifications | Faculty subscription + 5-second fallback | Build and API contracts | Yes | Implemented |
| Publication discovery | Sync, candidate review, confirm/reject | ORCID + OpenAlex + Crossref connectors and dedupe | Publication records/authors/candidates; confirmed activity | Query invalidation | Dedupe contract test | Yes, provider config optional | Implemented; live provider pending |
| Evidence management | Upload, attach, list, download, delete | Private signed upload/download URLs and validation | Evidence metadata and activity links | Cache invalidation | MIME/size and storage contracts; live private storage primitive | Yes | Implemented; private Storage upload/signed download passed; API metadata flow pending |
| Self-appraisal generation | Readiness, draft, submit, feedback, PDF download | Section generation and state transitions | Templates, sections, cycles, submissions/items/reviews | Submission + notification subscriptions | Readiness/state tests | Yes | Implemented |
| Admin directory/overview | Server search, sort, filters, pagination | Institution-scoped queries and aggregates | Profiles, faculty profiles, cycles, submissions | Admin cache invalidation + polling | Admin authorization contracts; live institutional visibility | Yes | Implemented; live RLS visibility passed |
| Admin review workflow | Detail, comment, return, approve, reject | Persisted review actions and notifications | Reviews, submissions, notifications | Faculty/admin round-trip wiring | State/authorization contracts | Yes | Implemented; live two-browser pending |
| Notifications | Unread list and mark-read | Owner-scoped notification endpoints | `notifications` | Realtime subscription | Protected-route contract | Yes | Implemented |
| PDF/report export | Download action | ReportLab PDF from stored submission, Storage upload, signed URL | `generated_documents`, submission path | Query invalidation | PDF code path/build check | Yes | Implemented; live download pending |
| Deployment/observability | Runtime config error states and error boundary | `/health`, `/ready`, request IDs, structured logs | Supabase readiness check | Realtime fallback | Build, smoke, audit | Vercel + Railway + Supabase | Configured; deployment pending |

## 3. Page Matrix

| PAGE | DATA SOURCE | API | DATABASE TABLES | REALTIME | HARDCODE STATUS |
| --- | --- | --- | --- | --- | --- |
| Landing | Static marketing/design copy and login links | None | None | None | Static UI only; no business metrics |
| Login | Supabase Auth session | Supabase Auth + `/auth/me` | `auth.users`, provisioned profile rows | Auth-managed session persistence | No demo user data |
| Register | User-entered form values | Supabase Auth signup; `/profile` completion | Auth trigger, profiles, faculty profiles, institutions, departments | None | No static department/business records |
| Faculty Home | Dashboard aggregates | `/dashboard/faculty` | Activities, appraisal cycles/submissions, notifications | Submission/notification subscription; polling fallback | Dynamic |
| Profile | Profile query/form | `GET/PATCH /profile` | Profiles, faculty profiles, institutions, departments | Query invalidation | Dynamic |
| Academic Record | Activity query/form | `/activities*`, `/publications/*` | Activities, evidence links, publication tables | Cache invalidation | Dynamic |
| Evidence | Evidence query/upload UI | `/evidence*` + Supabase Storage signed URLs | Evidence files, activity evidence | Cache invalidation | Dynamic |
| Appraisal | Cycle/readiness/submission state | `/appraisals/*` | Templates, sections, cycles, submissions/items/reviews | Submission/notification subscription; polling fallback | Dynamic |
| Admin Overview | Institution aggregates | `/admin/overview` | Profiles, activities, submissions, notifications | Admin subscription; polling fallback | Dynamic |
| Admin Faculty | Server directory | `/admin/faculty` | Profiles, departments, faculty profiles, cycles/submissions | Admin subscription; polling fallback | Dynamic |
| Admin Appraisals | Server queue/detail/review | `/admin/submissions`, `/appraisals/submissions/*` | Submissions, items, reviews, notifications | Admin/faculty update channel | Dynamic |

## 4. What Is Now Fully Dynamic

- Authentication, active sessions, logout, password reset, and role-based routing use Supabase Auth.
- New faculty registration is provisioned by the database trigger and does not inherit seeded records.
- Profile fields are read from and written to PostgreSQL.
- Activities, filters, counts, recent activity, archive/edit operations, and publication confirmations are database-backed.
- Evidence metadata is persisted in PostgreSQL and files are stored in private Supabase Storage buckets.
- Publication candidates are fetched from configured ORCID/OpenAlex/Crossref connectors and require explicit confirmation.
- Appraisal readiness and sections are generated from confirmed activities.
- Appraisal submission, return, resubmission, approval, rejection, comments, timestamps, and notifications are persisted.
- Admin directory, overview metrics, server-side filtering, sorting, and pagination are institution-scoped database queries.
- PDF reports are generated from submission data and stored as private generated documents.

## 5. Remaining Hardcoded Data

No persistent compulsory business data remains hardcoded in faculty or admin application paths.

The following are intentionally retained outside compulsory dynamic paths:

| File/component | Value | Reason | Acceptable | Planned removal |
| --- | --- | --- | --- | --- |
| `frontend/src/data/reconstructData.js` and `ReconstructMyYear.jsx` | Static reconstruction demo fixture | USP explicitly deferred by the scope restriction | Yes, deferred USP only | Replace when that USP is scheduled |
| `frontend/src/pages/LandingPage.jsx` | Marketing copy, portrait asset, `—` placeholders | Static landing design; no false business metrics | Yes | None required for compulsory scope |
| `scripts/seed_supabase.py` | Demo faculty/admin identities and seed records | Idempotent real database seed, not frontend data | Yes | Keep as deployment seed configuration |

## 6. Intentionally Static UI

Category labels, sidebar labels, button labels, explanatory copy, landing-page marketing copy, icons, design tokens, empty-state text, and deferred navigation labels are static presentation content. They are not used as application records or dashboard values.

## 7. Disabled/Deferred Controls

- Google sign-in is visibly disabled as `Coming soon`; email/password is the only implemented authentication method.
- `Reconstruct My Year` remains visually intact as a deferred USP and is not part of today’s database implementation.
- Other deferred USP areas remain outside this change: Form Assistant, Deadline Rescue, advanced Evidence Autopilot, Shared Academic Facts, Admin Request Autopilot, Teaching Change Detector, Promotion Dossier, Next Best Academic Move, Academic Network, Community, Messaging, LOR Studio, CV Import Bootstrap, Voice Dump, browser automation, coauthor propagation, student achievement automation, and career recommendations.
- Reports, Calendar, and Messages shell destinations explicitly state that they are deferred outside compulsory scope.

## 8. Database Tables Implemented

`institutions`, `departments`, `profiles`, `faculty_profiles`, `academic_activities`, `activity_participants`, `evidence_files`, `activity_evidence`, `publication_records`, `publication_authors`, `publication_candidates`, `appraisal_templates`, `appraisal_sections`, `appraisal_cycles`, `appraisal_submissions`, `appraisal_submission_items`, `appraisal_reviews`, `notifications`, and `generated_documents`.

The migration also creates required enums, indexes, auth provisioning trigger, RLS policies, private Storage buckets, and relevant Realtime publication entries.

## 9. Supabase Configuration

- Auth: email/password browser client with session persistence and automatic refresh.
- RLS: enabled on all application tables; faculty ownership and institution-scoped admin policies are defined in `supabase/migrations/001_compulsory.sql`.
- Storage: private `evidence`, `generated`, and `avatars` buckets with size/type limits and owner-folder policies.
- Realtime: `appraisal_submissions`, `appraisal_reviews`, and `notifications` are added to the Realtime publication when available. The frontend falls back to polling every five seconds when the channel fails.
- Seed: `scripts/seed_supabase.py` is idempotent and takes passwords only from environment variables. Live seed accounts, institution, cycle, sections, and activities are present in project `fcnmmxxnhrolgaxetnyz`.

## 10. Tests

| Test | Result |
| --- | --- |
| Frontend `npm ci` | Passed |
| Frontend `npm run lint` | Passed |
| Frontend `npm run build` | Passed; only the existing Vite large-chunk warning remains |
| Backend Python compile | Passed |
| Backend unit/API contract suite | 20 passed, 6 live-database tests skipped because raw Postgres is unreachable from this network |
| Unauthenticated FastAPI smoke checks | Passed: protected endpoints return 401 |
| `/health` | Passed: 200 |
| `/ready` | Correctly returns 503 without configured Supabase/PostgreSQL dependencies |
| Repository P0 hardcode/mock audit | Passed: clean |
| `git diff --check` | Passed |
| Live Supabase migration and seed through authenticated Supabase API | Passed; migration applied and seed run twice without duplicates |
| Live Auth role login/profile provisioning | Passed; faculty and admin roles authenticated; new faculty received one empty profile |
| Live RLS isolation | Passed; faculty B read of faculty A activity returned 0, unauthorized update had no effect, admin saw 2 profiles/9 activities |
| Live private Storage upload/signed download | Passed; PDF object uploaded, signed URL returned HTTP 200, object cleaned up |
| Playwright/new-user/evidence/publication E2E | Not run: no configured live environment |
| Two-browser realtime appraisal recording | Not run: no configured live environment |
| Supabase CLI `link`/raw Postgres connection | Blocked by current network: pooler TLS timeout and direct IPv6 no route |

## 11. Deployment Checklist

- Copy `.env.example` to the frontend and backend deployment environments.
- Provide Supabase URL, anon key, service-role key, database URL, JWT secret or JWKS URL, and CORS origins.
- Migration `supabase/migrations/001_compulsory.sql` is applied to project `fcnmmxxnhrolgaxetnyz`; use the authenticated Management API or a network with PostgreSQL access for future migration-history reconciliation.
- Configure Supabase Auth email confirmation/password policy and verify the auth trigger.
- Run `python scripts/seed_supabase.py` once with deployment-only seed credentials.
- Deploy FastAPI from `backend/` using `backend/railway.toml`; verify `/health` and `/ready`.
- Deploy the Vite frontend using `frontend/vercel.json` and set `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.
- Verify provider connectivity for ORCID/OpenAlex/Crossref and run the live two-user workflow.

## 12. Known Issues

- Raw PostgreSQL access from this network is blocked: the Supabase pooler TLS connection times out and the direct project database hostname resolves to unreachable IPv6. Supabase HTTPS APIs remain reachable and were used for live schema, seed, Auth, and RLS verification.
- No live evidence object was seeded; the seed script currently seeds real database activity records and the appraisal template/cycle. Evidence round-trip remains deployment verification.
- No Playwright test project was introduced; live E2E and the two-browser realtime workflow remain deployment verification work.
- PDF generation uses ReportLab, which is backend-safe and stores the result in Supabase Storage; it has not been downloaded from a live bucket in this workspace.
- The API intentionally returns `/ready` as unavailable until all required external dependencies are configured; this is an explicit deployment signal, not an in-memory fallback.
