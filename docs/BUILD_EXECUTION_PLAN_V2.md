# Automated System for Career Advancements of Faculties of Higher Education

## BUILD EXECUTION PLAN — V2 (12–16 August 2026)

Five-day execution plan. All product, page, schema, API, realtime, job, and deployment detail lives in `PROJECT_V2.md` — this file only sequences the build.

- **Build window:** 12–16 August 2026 (Wed–Sun).
- **Team:** 3 full-stack engineers (FS1–FS3), 3 ML/automation engineers (ML1–ML3).
- **Deployment gates (hard):** **Aug 12 staging online · Aug 13 core backend live · Aug 14 hero automation live · Aug 15 production candidate · Aug 16 fix/test/final deploy only.**
- **End state:** deployed production system, rehearsed 6–7 minute demo on the evening of 16 August, with 2–3 hours of buffer.

---

## 1. Team & Vertical Ownership

Each engineer owns a vertical end-to-end (schema slice, API, UI or pipeline, tests, demo moment) and is its DRI: owners cut scope inside their vertical before deadlines move. Verticals follow the final UI architecture (faculty 6 pages, admin 5 pages — PROJECT_V2 §13/§17).

| Engineer | Vertical | Owns |
|---|---|---|
| **FS1** | Faculty product | Onboarding, My Profile, **Home**, **My Academic Record**, evidence UI, **Appraisal** UI, **Automations** page shells + all faculty workflow UIs (Reconstruct review, Any Form, Rescue, CV import, Teaching Change screens), faculty-side realtime integration, faculty polish |
| **FS2** | Admin + Community | **Admin Overview / Faculty / Appraisals / Institution / Requests & Reports** UIs + their API handlers, **Community** (people/connections/communities/feed), **Messaging** (realtime DM), notifications bell + realtime client library, admin delta view |
| **FS3** | Platform | Repo + CI/CD, Supabase projects + all migrations, auth + invites + role redirects, RLS, storage, ARQ job framework + `background_jobs`, PDF/DOCX generation pipeline, shared-facts + student-credit + mentor-links backend, seed + reset scripts, deployment (staging Day 1, prod Day 4), OpenAPI→TS codegen, contracts |
| **ML1** | Activity recovery | Google OAuth + Gmail/Calendar/Drive connectors, Reconstruct pipeline (harvest/extract/correlate/score/dedupe), publication sync (ORCID/OpenAlex/Crossref) + identity scoring, reviewer-work + invisible-service classifier packs, Deadline Rescue orchestrator |
| **ML2** | Document intelligence | Any Form (XLSX/DOCX/PDF parse→map→resolve→fill), canonical field catalog + resolvers + mapping hints, batch certificate extraction, CV Import, evidence metadata extraction + pending-evidence matcher, Admin Request Autopilot (multi-faculty mode) |
| **ML3** | Applied intelligence | LLMProvider + prompt/test infrastructure, embeddings, Quick Add (NL/voice) parser, people search + mentor/collaborator recommendations, Teaching Change Detector, career rules + Next Best Move + Promotion Dossier, LOR grounding + drafting |

**Cross-vertical seams (agreed pairs):** FS1↔ML1 (candidate review UI ↔ reconstruct API), FS1↔ML2 (form/CV/batch UI ↔ form jobs), FS2↔ML3 (people search ↔ matching; LOR UI shared with FS1), FS2↔ML2 (Requests & Reports ↔ multi-faculty form mode). FS3 supports everyone and owns shared files.

## 2. Priorities & Cut Order (shared definition)

- **P0 (never cut):** auth + role-based redirect; profile; Academic Record CRUD + proposals; evidence upload/attach; publication sync + confirm; appraisal draft→submit→review→PDF; admin console (search/sort/filter/review/PDF); realtime submission flow; notifications; seeded demo data; deployed staging + prod.
- **P1 (the demo):** Reconstruct My Year · Any Form XLSX · Deadline Rescue · Evidence Autopilot (batch + Proof Later + search) · Shared Academic Facts · Admin Request Autopilot + department report · Promotion Dossier + Next Best Move · Academic Network core · CV Import · Quick Add · onboarding.
- **P2 (stretch):** Teaching Change · LOR Studio · Any Form DOCX/PDF fill · Voice Dump · YoY delta view · Living CV extra formats · reactions/bookmarks · admin analytics.
- **Cut order (last→first):** LOR Studio → Teaching Change → voice (keep typed NL) → Any Form PDF overlay (companion mode stays) → dept report sections beyond publications/FDP → reactions/bookmarks (keep posts+comments) → delta view → Deadline Rescue UI (keep underlying jobs).
- **Never cut:** anything P0; Reconstruct (fixture mode minimum); Any Form XLSX; network search+connect+message; seeded demo data; backup video.

## 3. Contracts Frozen First (Day 1, by 18:00)

Authored/reviewed Day 1, then frozen; changes require a team-channel announcement + `pnpm gen:api` regeneration:

1. **Migration 001** — the full schema from PROJECT_V2 §26 (all tables Day 1; later tweaks are additive migrations).
2. **Enums** — `activity_category`, `activity_status`, `activity_source`, `job_status`, `submission_status`, `candidate_status`, etc.
3. **`background_jobs` envelope + `useJob` contract** (row shape, progress semantics, realtime channel).
4. **OpenAPI stubs for every endpoint** in PROJECT_V2 §28 (routers + typed schemas, 501 where unimplemented) → typed TS client Day 1 night.
5. **Candidate shapes** (`reconstruction_candidates` + `candidate_sources`, `publication_candidates`) — FS1's review UI and ML1's pipelines meet only here.
6. **Canonical field catalog v1** (`ml/schemas/canonical_fields.yaml`, ~60 fields Day 1, additive after).
7. **LLMProvider protocol** (signatures + Pydantic schemas + `FakeLLM`).
8. **Design tokens + shadcn setup** (`packages/config/src/tokens.ts`) — merged Day 1 morning; nobody hardcodes colors.
9. **Realtime channel names** per PROJECT_V2 §29.
10. **Seed fixture format** (`ml/fixtures/seed/*.yaml`).
11. **Sidebar/route map** per PROJECT_V2 §23 — no route invention mid-build.

## 4. Branch/Merge Strategy

- Trunk-based on `main`; always green, always deployable; squash merges.
- Branch naming `feat/<vertical>-<desc>`; PRs <600 lines target; 1 review required Days 1–2; module owners self-merge within their vertical Days 3–5 with post-merge review.
- **Day 1 merge order:** repo scaffold (FS3) → tokens (FS1) → migration 001 (FS3) → API stubs (FS3+all) → vertical work. Nobody branches off unmerged branches outside their own stack.
- CI on every PR: lint, typecheck, pytest, web build. Merge to `main` → auto-deploy staging + staging smoke.
- **Conflict avoidance:** module-directory ownership; shared files (`main.py`, migrations, tokens, shared types) change only via FS3 (tokens via FS1).

## 5. Daily Rhythm

- **09:00 standup (15 min):** yesterday / today / blocked; blockers get an unblocker on the spot.
- **14:00 integration checkpoint (10 min):** does main deploy? do today's seams connect? demo one integrated thing.
- **21:00 evening standup (15 min):** Day DoD review, cut decisions, next-day adjustments.
- **Continuous:** merge ≥2×/day. Staging is the shared truth — "works on my machine" doesn't count.

---

# DAY 1 — Wednesday 12 August: FOUNDATION → **staging online**

**Day goal: deployed staging skeleton — auth with role redirects, full schema, seeds, CI, frozen contracts — public staging URL by 23:00.**

### FS3 (critical path all day)
- Morning: repo + monorepo scaffold (pnpm workspaces + turbo; `apps/web` Next.js; `services/api` FastAPI; `packages/shared`, `packages/config`; `docker/api.Dockerfile`). Create Supabase staging+prod projects, Upstash Redis, Railway project (api+worker), Vercel project. GitHub Actions: `ci.yml`, staging auto-deploy.
- Afternoon: migration `001_init.sql` (full schema §26); signup trigger → `profiles`; FastAPI JWT dependency + role load + `/auth/me`; RLS policies (personal tables, submissions, messages/communities, admin scope); storage buckets + policies; ARQ framework + `background_jobs` + sweeper + `GET /jobs/:id` + one no-op demo job.
- Evening: OpenAPI stubs for all endpoints (owners PR their `schemas.py`); `pnpm gen:api` working; `scripts/seed.py` v1 (institutions, departments, 24 profiles, admin, template+cycle, communities); `/health` + `/ready`; `scripts/smoke.sh`. **Deploy; verify staging login as faculty AND admin lands on the correct home.**

### FS1
- Morning: design tokens + Tailwind + shadcn + base primitives (Button, Card, Input, Chip, EmptyState, Skeleton, PageHeader, faculty AppShell with the locked 6-item sidebar). Merge early.
- Afternoon: landing page, `/login`, `/register` on Supabase Auth; role-based redirect via `/auth/me`; onboarding shell (6 steps, steps 3–5 stubbed but navigable); `/faculty/profile` view/edit.
- Evening: `/faculty/home` v1 against the dashboard stub; `useJob` hook + `<JobProgress>`; notifications bell shell.

### FS2
- Morning: admin AppShell with the locked 5-item sidebar + routing; realtime client lib (`lib/realtime.ts`: subscribe + query-cache patching + 5s polling fallback); notifications bell + toasts wired to `notifications:{profile_id}`.
- Afternoon: `/admin/overview` action cards + `/admin/faculty` directory (search/sort/filter) against stubs→real as FS3 lands them.
- Evening: implement `/admin/overview` + `/admin/faculty` handlers (FS2 writes API inside their vertical on FS3's foundation).

### ML1
- Morning: Google Cloud project, consent screen (test mode), credentials; demo Google account created; `scripts/seed_google_fixture.py` drafted.
- Afternoon: `/integrations/google/connect|callback` + encrypted token storage (`oauth_connections`); connector skeletons with fixture-replay mode (`RECONSTRUCT_FAKE_SOURCES`).
- Evening: ORCID/OpenAlex/Crossref clients + normalizers with recorded cassettes; `publication_sync` job writing `publication_candidates` for a test ORCID.

### ML2
- Morning: fixtures — `Appraisal_2026.xlsx` (37 fields, styled/merged), `_v7` variant, DOCX request, fillable PDF, 12 certificates, 2 CVs, fixture email/calendar YAML for ML1.
- Afternoon: canonical field catalog v1 + resolver registry + 10 core resolvers tested against seeds.
- Evening: XLSX structure parser v1 (openpyxl → `form_fields`) with unit tests.

### ML3
- Morning: LLMProvider (protocol, Gemini structured outputs, Anthropic fallback, `FakeLLM`); prompt loader.
- Afternoon: `embed()` + `embedding_refresh` job (profile embeddings for seeds); pgvector search helper.
- Evening: NL activity parser v1 + `/activities/quick-add` endpoint + golden tests.

**APIs ready:** `/auth/me`, `/profile`, `/admin/overview`, `/admin/faculty`, `/jobs/:id`, `/health`, `/ready`, stubs for everything else.
**UI pages ready:** landing, login, register, onboarding shell, faculty shell + Home v1 + profile, admin shell + Overview + Faculty v1.
**Integration checkpoint:** login → role redirect → seeded shells on the staging URL.
**Staging state:** deployed, migrated, seeded, smoke passing.

### Day 1 Definition of Done
- [ ] Staging URL: register + login as faculty → `/faculty/home`; as admin → `/admin/overview`; shells show seeded data
- [ ] Migration 001 applied; seed idempotent; RLS on
- [ ] CI green; merge→staging→smoke passes
- [ ] All API stubs merged; `packages/shared` types generated
- [ ] No-op job runs with live progress in UI
- [ ] One real Gemini structured call verified from the worker
- [ ] Contracts §3 frozen and announced
**Cut if behind:** none allowed on Day 1 items — slip sleep, not staging.

---

# DAY 2 — Thursday 13 August: CORE PRODUCT → **core backend live**

**Day goal: the P0 loop works end-to-end on staging: activities → evidence → publications → appraisal submit → admin review (realtime) → PDF. Community schema live: connections + messages.**

### FS1
- Morning: **My Academic Record** UI — tabs (All/Teaching/Research/Mentoring/Service/Evidence), filters/search, create/edit (per-category metadata fields), detail drawer, confirm/archive; implements `/activities/*` handlers with FS3-reviewed service layer.
- Afternoon: evidence library — signed-URL upload w/ progress, grid + filters, attach/detach, download; Home inbox now fully live.
- Evening: publication candidates review ("Are these yours?", match reasons, bulk confirm); `<ProposalCard>` componentized (reused by reconstruct/shared-facts/batch/quick-add).

### FS2
- Morning: **Appraisals queue** (filters: cycle/department/year/status; sorts: name/employee code/submission date) + review screen (sections, items, evidence preview).
- Afternoon: review actions (comment/return/approve/reject) + `appraisal_reviews` API; realtime `submissions:institution` + `submission:{id}`; remind nudge.
- Evening: **Community part 1** — connection requests (send/respond, realtime), connections list, people directory with SQL filters; **Messaging** — conversations + messages API, RLS, realtime thread (two-browser tested).

### FS3
- Morning: appraisal engine — draft generation (cycle window → confirmed activities → template sections → items), readiness computation, submit validation + state machine.
- Afternoon: PDF pipeline (Jinja2 + WeasyPrint in worker); appraisal PDF template; `pdf_generate` job; signed-URL delivery.
- Evening: shared-facts backend — `institution_events` + `event_participants` fanout → proposed activities + notifications; student records + achievements + mentor-credit fanout; `admin_invites` flow. Authz pytest matrix. Support duty for the other five.

### ML1
- Morning: publication identity scoring (name variants/institution/co-author overlap/topic) + dedupe (DOI, title hash); bucketed candidates for FS1.
- Afternoon: Gmail/Calendar/Drive harvest against the real demo account (bounded queries); run `seed_google_fixture.py`; signals persisted as `candidate_sources`.
- Evening: extraction stage — rule filters + `classify_academic_activity` → typed CandidateSignals; reviewer-thanks + invisible-service packs included.

### ML2
- Morning: DOCX parser (tables/placeholders) + PDF AcroForm parser → unified `form_fields`.
- Afternoon: `map_form_fields` + mapping stage (catalog + hints); resolver execution → filled/ambiguous/missing; coverage; `form_analyze` end-to-end on the XLSX fixture (API-level).
- Evening: unresolved-question generation (plain language) + reusable-fact persistence; XLSX fill stage writing into the original workbook — round-trip test asserts styles/merges/formulas survive.

### ML3
- Morning: people search — embedding query + filter combination (`/community/people`); verified against seeds ("computer vision healthcare mumbai" → right people).
- Afternoon: mentor/collaborator recommendations job + stored reasons (`/community/recommendations`).
- Evening: quick-add polish (multi-activity split, relative dates); voice input component (Web Speech API) handed to FS1; career rules engine v1 (`/career/rules/progress` deterministic).

**APIs ready:** `/activities/*`, `/evidence/*`, `/publications/*`, `/appraisals/*` (minus rescue), `/admin/submissions`, review, remind, `/community/*` part 1, `/messages/*`, `/career/rules/progress`, `/forms` analyze (API-level).
**UI pages ready:** Record, Evidence tab, publication review, Appraisal (faculty), Appraisals queue + review (admin), Community part 1, Messages.
**Integration checkpoint:** the Day 2 DoD loop run live at 14:00 checkpoint.
**Staging state:** core backend live; P0 loop demoable.

### Day 2 Definition of Done
- [ ] On staging: create activity → upload+attach evidence → sync publications → confirm candidate → generate appraisal draft → submit → **admin sees it live** → return with comment → faculty sees live → resubmit → approve → download PDF
- [ ] Connect → accept → DM round-trip live between two browsers
- [ ] `form_analyze` on fixture XLSX: correct fields + ≥80% correct mappings (API-level)
- [ ] Reconstruct harvest+extract produces persisted signals from the demo Google account
- [ ] Quick-add golden case parses correctly
- [ ] E2E: appraisal loop + messaging in CI
**Cut if behind:** voice input; community polish; delta view.

---

# DAY 3 — Friday 14 August: HERO AUTOMATION → **hero automation live**

**Day goal: Reconstruct My Year (real Google account AND fixture mode) and Any Form XLSX (upload → questions → download) work end-to-end on staging. CV import + batch certificates land. Shared facts fan out.**

### ML1 (hero: Reconstruct)
- Morning: correlation — cross-source clustering (date-blocking × fuzzy title/org × embeddings) → `reconstruction_candidates` with linked sources; confidence buckets.
- Afternoon: dedupe vs. record + ignored; confirm flow (activity creation + evidence import from Drive/Gmail at confirm); run report with per-source coverage.
- Evening: runs against the demo account until demo-quality (target 8–12 candidates, ≥5 high bucket, the IEEE-talk 3-source correlation works); fixture mode produces the same set through the same pipeline; failure paths (expired token, partial source) render correctly.

### ML2 (hero: Any Form)
- Morning: `form_generate` end-to-end + evidence ZIP + field report; `waiting_for_user` → questions → generate wired with FS1's UI.
- Afternoon: **CV Import** — chunked extraction → drafts → dedupe vs. publication pipeline → bulk-confirm payload; `cv_import` job; both fixture CVs.
- Evening: **batch certificates** — OCR ladder → per-doc metadata → duplicate clustering → proposed activities; 12 fixture certificates. Version-proof check: `_v7` fixture reuses hints (measure analyze time + coverage on second run).

### FS1
- Morning: **Reconstruct UI** — source checklist, run start, live progress, candidate review (grouped, evidence chips, "why suggested" drawer, confirm/edit/ignore, bulk) on `<ProposalCard>`.
- Afternoon: **Any Form UI** — dropzone, analysis progress, mapping review + coverage bar ("37 detected · 31 filled · 3 confirm · 3 new"), questions panel, outputs card.
- Evening: onboarding completion — CV step wired to `cv_import` + bulk-confirm grid; ORCID + Google connect steps live; **Integrations page** (connected accounts, plain-word scopes, disconnect + delete-derived-data).

### FS2
- Morning: **Communities** — create/join/leave, community page, posts, comments, reactions, realtime on open community; feed with cursor pagination.
- Afternoon: **Institution page** — create event, add participants (picker + CSV), fanout status table; faculty-side shared-fact proposals via `<ProposalCard>` + notification; student achievements form → mentor-credit proposal.
- Evening: **Requests & Reports** shell — request intake (paste/upload) wired to ML2's multi-faculty mode (API), report builder form; admin analytics (real queries, charts only here); co-author propagation surfacing.

### FS3
- Morning: hardening — rate limits, upload validation (MIME/size/macro rejection), CORS lockdown, Sentry on web/api/worker, request-id logging; `/ready` checks real.
- Afternoon: `dept_report` job (aggregation → DOCX/PDF); `/export/my-data`; admin invites UI support for FS2.
- Evening: **seed v2** — full demo dataset (PROJECT_V2 §42): varied submissions, live communities, conversations, opportunities, pending proposals, 5 missing-evidence cases; `scripts/reset_demo.py`.

### ML3
- Morning: Teaching Change — snapshot + file ingestion (hash + text extraction), deterministic diff stage; API contract with FS1.
- Afternoon: `summarize_teaching_changes` on the CS402 fixture folders → typed changes; approve→activity flow.
- Evening: **Next Best Move** — rule gaps × opportunities with reasons (`/career/recommendations`); career page payload complete; opportunities admin CRUD (with FS2).

**APIs ready:** `/reconstruct/*`, `/forms/*` full, `/activities/import/cv`, `/evidence/batch|search`, `/teaching/*`, `/career/*`, `/admin/events*`, `/admin/students*`, `/admin/requests*` (intake), `/admin/reports/department`.
**UI pages ready:** Reconstruct workflow, Any Form workflow, onboarding complete, Integrations, Institution, Requests & Reports shell, Communities + feed, Career Growth v1.
**Integration checkpoint:** admin creates FDP event → 12 faculty get live proposals → one confirms (two browsers).
**Staging state:** hero automation live.

### Day 3 Definition of Done
- [ ] Reconstruct works on staging with the real Google account AND fixture mode
- [ ] Any Form XLSX: 37-field fixture → ≥30 auto-filled → 3 questions → downloaded file opens in Excel with formatting intact
- [ ] CV fixture → ≥40 drafts → bulk confirm
- [ ] 12 certificates → clustered proposals, correct metadata on ≥9
- [ ] Shared-fact fanout + confirm live
- [ ] Teaching compare detects the planted fixture changes
- [ ] E2E: reconstruct (fixture) + Any Form in CI
**Cut if behind:** teaching-change UI (keep seeded pre-run results); reactions/bookmarks; DOCX/PDF generate (companion mode).

---

# DAY 4 — Saturday 15 August: INTEGRATION + POLISH → **production candidate**

**Day goal: every P1 demo moment works and looks premium; Deadline Rescue, Career, Evidence Autopilot complete; prod deployed. No broken or fake UI. P1 feature freeze 21:00.**

### FS1
- Morning: **Deadline Rescue UI** — single guided progress screen over ML1's orchestrator; "Only 3 things still need you" checklist → lands on generated appraisal. **Career Growth** page final (goal, dossier progress, next moves, opportunities).
- Afternoon: Evidence Autopilot UX — pending-evidence chips, dashboard debt card, attach-suggestion flow, evidence search bar; Living CV export on Career/Profile.
- Evening: faculty polish sweep — every route: empty states, skeletons, error boundaries, 375px pass, motion, teacher-language copy review of every string.

### FS2
- Morning: admin delta view (YoY per faculty); department report UI → `dept_report` → download.
- Afternoon: Requests & Reports complete — request detail (parsed ask, per-faculty gaps, outputs, draft reply); community polish (profile pages, recommendation cards with reasons, empty states); message UX (unread badges, read receipts, enter-to-send).
- Evening: admin polish — action cards all live, snappy filters/sorts (indexes verified), submission viewer refinement, notification center.

### FS3
- Morning: **production environment** — prod Supabase migrated + seeded, prod Railway services, prod Vercel, domains/CORS, env parity audit; **first prod deploy of `main`**; smoke prod.
- Afternoon: performance pass — dashboard single-query aggregation, N+1 audit, pagination check, p95 vs. targets.
- Evening: backup/monitoring — DB snapshot schedule, `reset_demo.py` tested on prod-clone, uptime workflow, `docs/RUNBOOK.md`.

### ML1
- Morning: **Deadline Rescue orchestrator** — sequenced child jobs (pub sync → reconstruct → evidence scan → draft) with aggregate progress; idempotent re-runs.
- Afternoon: Reconstruct quality tuning on the demo account (thresholds, noise suppression, snippet quality); Google reconnect/expiry UX with FS1.
- Evening: nightly crons on; co-author matching precision pass (zero false-positive proposals in seed); freeze pipelines; write down demo-run parameters.

### ML2
- Morning: Any Form DOCX generate end-to-end; fillable-PDF fill; companion-mode rendering with explicit UI notice.
- Afternoon: **Proof Later matcher** (`evidence_pending_match`: new evidence ↔ pending activities); Admin Request Autopilot quality pass on the fixture request.
- Evening: fixture-cache warm-up (pre-analyze demo files on prod so demo runs are instant); prompt-cassette persistence for demo-critical calls.

### ML3
- Morning: Promotion Dossier PDF (criteria-organized activities + evidence + gaps); career dismiss persistence; opportunities seeded well.
- Afternoon: **LOR Studio** (if green): grounding retrieval → constrained draft → editor → DOCX/PDF export. Timebox to 15:00 — else cut per §2 and ML3 joins polish.
- Evening: recommendation/search quality pass (demo queries return intended seeds; reasons read well); voice quick-add cross-browser check (Chrome primary).

**APIs ready:** all §28 endpoints live except flagged P2 cuts.
**UI pages ready:** all 15 major pages complete and polished.
**Integration checkpoint:** full demo script walkthrough on staging at 14:00, gap list by 14:15.
**Staging state:** feature-complete. **Prod state:** deployed, migrated, seeded, smoked → **production candidate.**

### Day 4 Definition of Done
- [ ] Full demo script executable on staging by FS1 solo, no developer help
- [ ] Prod deployed, migrated, seeded, smoked
- [ ] Zero fake UI (20:00 cross-audit: each engineer audits someone else's vertical)
- [ ] P1 frozen 21:00; fixes only after
- [ ] Lighthouse ≥80/≥95 on Home + Community; 375px pass on faculty surfaces
- [ ] Runbook + fallback flags tested (`RECONSTRUCT_FAKE_SOURCES`, LLM fallback, polling)
**Cut if behind:** invoke §2 cut order at 09:00 sharp; polish beats breadth.

---

# DAY 5 — Sunday 16 August: FIX / TEST / FINAL DEPLOY ONLY

**Rule of the day: no new features. Fix, verify, rehearse. Freeze escalates through the day.**

### Morning (09:00–13:00) — verification
- **All:** triage the Day 4 audit board; fix `demo-blocker` and P1 bugs only (`polish`/`wontfix-hackathon` labeled).
- **FS1+FS2:** cross-browser (Chrome/Edge/Firefox/Safari) + mobile pass on demo-path screens; permission matrix manual test (faculty A ✗ faculty B's data; admin ✗ cross-institution); upload edge cases (25MB, wrong MIME, duplicate).
- **FS3:** full E2E green on staging; job-failure drills (kill worker mid-job → retry; revoke LLM key → fallback); load sanity (20 concurrent users on Home + list endpoints).
- **ML1/ML2/ML3:** run every demo pipeline 3× consecutively on prod-parity data; verify fixture fallbacks; warm caches for the exact demo files/accounts.

### Afternoon (13:00–17:00) — final production + assets
- 13:00 **final prod deploy** (`main` tagged `v1.0-demo`); prod migration check; `reset_demo.py` to pristine state; full smoke; **hard freeze except demo-blockers**.
- 14:00 **rehearsal #1 on prod** (presenter + timekeeper). Fix list.
- 15:00 **record backup demo video** (full script, prod, saved to two laptops + a phone).
- 15:30–17:00 submission assets: architecture + ER diagrams exported, screenshots of every demo beat, metrics slide (activities recovered, fields auto-filled, seeded scale). Rehearsal #2 with slides.

### Evening (17:00–21:00) — freeze + rehearse
- 17:00 **absolute code freeze**; `reset_demo.py` is the only allowed mutation.
- 17:30 rehearsals #2/#3 — one run **entirely in degraded mode** (fixture sources + polling) to prove the fallback path.
- 19:00 logistics: fresh browser profiles, bookmarked URLs, verified sessions, video on 3 devices, hotspot tested; `docs/DEMO_CHECKLIST.md` executed line by line.
- 20:00 **buffer (mandated 2–3h).** FS3 on-call on uptime + Sentry.

### Day 5 Definition of Done
- [ ] Prod URL: full demo script clean 3× in a row, once in degraded mode
- [ ] Backup video on 3 devices; screenshots + diagrams in deck
- [ ] Smoke green on prod; uptime green; Sentry quiet
- [ ] Demo checklist executed; reset script verified; both presenters rehearsed
- [ ] Repo tagged; README with URLs + demo accounts + architecture pointer

---

## 6. Dependency Map

```
Day1: repo(FS3) → tokens(FS1) → migration001(FS3) → {API stubs, seed v1}(FS3) → all verticals unblocked
LLMProvider(ML3, D1) → NL parser(ML3), classify(ML1), mapping(ML2)
activities API(FS1, D2 AM) → appraisal engine(FS3, D2), resolvers on real data(ML2, D2)
ProposalCard(FS1, D2 PM) → reconstruct UI, shared-facts UI, batch UI, quick-add UI (D3)
realtime lib(FS2, D1) → every realtime feature
publication candidates(ML1, D2) → co-author propagation(D3)
harvest(ML1, D2) → correlate/score(ML1, D3) → reconstruct demo
form_analyze(ML2, D2) → form UI(FS1, D3) → form_generate(ML2, D3)
shared-facts backend(FS3, D2) → Institution UI(FS2, D3)
career rules(ML3, D2) → Career page(FS1, D4) + dossier(ML3, D4)
seed v2(FS3, D3) → D4 polish + D5 rehearsal
prod env(FS3, D4 AM) → D5 everything
```

Standup rule: anything on this map slipping >4h is raised immediately and re-scoped or re-staffed (FS3 first responder, ML3 second after the Day 4 timebox).

## 7. Risk Playbook (build-time)

| Trigger | Response |
|---|---|
| Reconstruct correlation quality poor by Day 3 noon | Ship high-precision subset (certificates + reviewer emails + calendar-only); fixture mode carries breadth |
| Any Form mapping <80% on fixtures by Day 3 noon | Add per-fixture mapping hints (hints are a product feature); narrow demo to the two fixture files |
| Google OAuth/consent problems | Demo identities pre-added as test users; worst case fixture mode (identical UX) |
| Supabase Realtime unreliable | Polling fallback already in hooks; script says "moments later" |
| A vertical owner sick/stuck | FS3 absorbs platform-adjacent work; that vertical's P2 items cut per §2 |
| Behind on Day 4 morning | Invoke cut order at 09:00 standup; a smaller flawless demo wins |
| LOR Studio not smooth by Day 4 15:00 | Cut (it is the designated schedule-slack); Career page ships without section E's editor |

## 8. What MUST NEVER Be Cut (final restatement)

Deployed prod system with real auth + role redirects, real DB, real storage · activities + evidence · publication automation with confirm · appraisal submit → admin realtime review → PDF · admin search/sort/filter · Reconstruct My Year (fixture mode minimum, real pipeline) · Any Form XLSX end-to-end · Shared Academic Facts fanout · Network search + connect + message · seeded believable demo data · backup video.

## 9. Demo Script (target 6–7 min, two windows: faculty + admin)

1. **Cold open (30s):** "Every March, professors spend a week reconstructing a year of work into forms. We made the appraisal a by-product." — Dr. Sharma's Home: live inbox, 78% ready.
2. **Reconstruct My Year (90s):** run → live progress → IEEE invited talk assembled from Calendar + email + Drive certificate → "why suggested" → confirm 4 (one bulk), ignore 1.
3. **Any Form (90s):** drop `Appraisal_2026.xlsx` → "31 of 37 fields completed" → answer 3 questions → download → open in Excel: formatting intact. Version-proof beat: drop `..._v7.xlsx`, coverage instantly high.
4. **Appraisal + realtime admin (75s):** generate → submit → **appears on the admin screen without refresh** → admin returns one section with a comment → faculty toast live → fix → resubmit → approve → PDF.
5. **Community (60s):** search "computer vision healthcare mumbai" → connect with note → other window accepts → message lands <1s → post FDP opportunity in "AI in Education".
6. **Rapid-fire (45s):** quick-add a seminar by voice; admin's shared FDP event fanning out to 12 faculty; student achievement → mentorship credit; Career Growth: rule panel + Next Best Move; Living CV export already contains today's confirms.
7. **Close (20s):** architecture slide + "everything you saw is live data on a deployed system — here's the URL."

Fallbacks rehearsed: `RECONSTRUCT_FAKE_SOURCES=1`; pre-warmed form analyses; polling mode; backup video.
