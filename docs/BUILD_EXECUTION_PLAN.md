# BUILD_EXECUTION_PLAN.md

Five-day execution plan for Sanchaya (see `PROJECT.md` for all product/architecture detail). Build window: **12-16 August 2026**. Final deployed, rehearsed demo by the evening of 16 August with 2-3 hours of buffer.

---

## 1. Team & Vertical Ownership

Each engineer owns a vertical end-to-end (schema slice, API, UI or pipeline, tests, and its demo moment). Owners are DRIs: they cut scope inside their vertical before asking to move deadlines.

| Engineer | Vertical | Owns |
|---|---|---|
| **FS1** | Faculty product | Onboarding, profile, dashboard, activities, evidence library, appraisal UI, Living CV, Proof Later, faculty-side polish |
| **FS2** | Admin + Network | Admin console, submissions review, analytics/delta, Teacher Network (people/connections/feed/communities), messaging, realtime wiring, department report, notifications UI |
| **FS3** | Platform | Repo, CI/CD, Supabase project + all migrations, auth, RLS, storage, jobs framework (ARQ + `background_jobs`), PDF pipeline, shared-facts + student-credit backend, seed system, deployment, OpenAPI→TS codegen, contracts |
| **ML1** | Activity recovery | Google OAuth + Gmail/Calendar/Drive connectors, Reconstruct pipeline (harvest/extract/correlate/score/dedupe), publication sync (ORCID/OpenAlex/Crossref) + identity matching, Reviewer Karma patterns, Deadline Rescue orchestrator |
| **ML2** | Document intelligence | Any Form (XLSX/DOCX/PDF parse→map→resolve→fill), canonical field catalog + resolvers, batch certificates, CV Import, email-capture extraction, Duplicate Ask Deflector, Admin Mail mode |
| **ML3** | Applied intelligence | LLMProvider + prompt infrastructure, NL/voice quick-add parser, embeddings + people search + recommendations, Teaching Change Detector, career rules + Next Best Move, browser workflows (P2) |

**Cross-cutting pairs:** FS1↔ML1 (candidate review UI ↔ candidate API), FS1↔ML2 (form UI ↔ form jobs), FS2↔ML3 (people search UI ↔ matching), FS3 supports everyone.

## 2. Priorities (shared definition)

- **P0 (never cut):** auth+roles, profile, activities CRUD+categories, evidence upload/attach, publication sync via ORCID/OpenAlex/Crossref with confirm flow, appraisal draft→submit→review→PDF, admin console (search/sort/filter/review/PDF), realtime submission status, seeded demo data, deployed system.
- **P1 (the demo):** Reconstruct My Year, Any Form (XLSX first), quick-add NL+voice, batch certificates, CV import, shared facts, student→faculty credit, teaching change, career next move, Teacher Network (search/connect/message/feed/communities), Living CV, Deadline Rescue, co-author propagation, admin delta.
- **P2 (stretch):** Any Form PDF overlay, Admin Mail → Done, browser workflows, department report, Proof Later matcher, Teaching Impact Pack, data export.
- **Cut order when behind (last→first):** browser workflows → Admin Mail → PDF overlay (companion mode stays) → Teaching Impact Pack → dept report → voice (keep typed NL) → teaching change (keep seeded snapshots + pre-run results) → Deadline Rescue UI (keep the underlying jobs) → feed reactions/bookmarks (keep posts+comments). **Never cut:** anything P0, Reconstruct (fixture mode minimum), Any Form XLSX, network search+connect+message.

## 3. Contracts Frozen First (Day 1, by 18:00)

Everything below is authored/reviewed on Day 1 and frozen. Changes after freeze require a team-channel announcement + regeneration of `packages/shared`.

1. **Migration 001** - full schema from PROJECT.md §Database Schema (FS3 writes it Day 1; yes, all tables on Day 1 - column tweaks later are additive migrations).
2. **Enums:** `activity_category`, `activity_status`, `activity_source`, `job_status`, submission status, candidate status.
3. **`background_jobs` envelope + `useJob` hook contract** (job row shape, progress semantics, realtime channel).
4. **OpenAPI stubs for every endpoint** in PROJECT.md §API Contract (FastAPI routers with typed schemas returning 501 where unimplemented) → `pnpm gen:api` gives frontends real types Day 1 night.
5. **Candidate shape** (`reconstruction_candidates` + `candidate_sources`) - the FS1 review UI and ML1 pipeline meet only at these tables/endpoints.
6. **Canonical field catalog v1** (`ml/schemas/canonical_fields.yaml`) - ML2 authors ~60 fields Day 1, extends freely after (additive).
7. **LLMProvider protocol** (method signatures + Pydantic schemas) - ML3 lands it Day 1 so ML1/ML2 code against it immediately (with a `FakeLLM` fixture provider for tests).
8. **Design tokens + shadcn setup** (`packages/config/tokens.ts`) - FS1 lands Day 1 morning; nobody hardcodes colors.
9. **Realtime channel names** per PROJECT.md §Realtime Events.
10. **Seed fixtures format** (`ml/fixtures/seed/*.yaml`) so anyone can add demo data without touching seed code.

## 4. Branch/Merge Strategy

- Trunk-based on `main`; always green, always deployable. Squash merges.
- Branch naming `feat/<vertical>-<desc>`, `fix/...`. PRs small (<600 lines diff target); 1 review required Days 1-2 (contracts era), module owners self-merge within their vertical Days 3-5 with post-merge review.
- **Merge order discipline Day 1:** repo scaffold (FS3) → tokens/design (FS1) → migration 001 (FS3) → API stubs (FS3+all) → everything else. Nobody branches off unmerged branches except within their own stack.
- CI on every PR: lint, typecheck, pytest, web build. Merge to `main` auto-deploys staging + runs staging smoke.
- **Conflict avoidance:** module directory ownership (`modules/forms` = ML2 only, etc.); shared files (`main.py`, migrations, tokens, shared types) change only via FS3 (or FS1 for tokens).

## 5. Daily Rhythm

- **09:00 standup (15 min):** yesterday / today / blocked. Blockers assigned an unblocker on the spot.
- **14:00 integration checkpoint (10 min):** does main deploy? do today's cross-vertical seams connect? demo one integrated thing.
- **21:00 evening standup (15 min):** Day DoD review against this document, cut decisions, next-day adjustments.
- **Continuous:** merge at least twice daily; staging is the shared truth - "works on my machine" doesn't count.

---

# DAY 1 - Tuesday 12 August: FOUNDATION

**Day goal: a deployed staging skeleton with auth, schema, seeded data, CI, and frozen contracts before sleep. There is a public staging URL by 23:00.**

### FS3 (critical path all day)
- **Morning:** Create GitHub repo + monorepo scaffold (pnpm workspaces, turbo, `apps/web` via create-next-app, `services/api` FastAPI skeleton, `packages/*`, `docker/api.Dockerfile`). Create Supabase staging+prod projects, Upstash Redis, Railway project (api+worker services), Vercel project. Wire GitHub Actions: `ci.yml` (lint/type/test/build), staging auto-deploy.
- **Afternoon:** Migration `001_init.sql` - the full schema. Auth: signup trigger → `profiles`; JWT verification dependency in FastAPI; role loading; RLS policies for personal tables + submissions + messages/communities. Storage buckets + policies. `background_jobs` framework: ARQ setup, job creation helper, sweeper, `/jobs/:id`, one demo no-op job.
- **Evening:** OpenAPI endpoint stubs for ALL modules (with FS1/FS2/ML owners submitting their schemas as PRs to `schemas.py` files); `pnpm gen:api` codegen working; `scripts/seed.py` v1 (institutions, departments, 24 profiles, admin, appraisal template+cycle, communities); `/health` + `/ready`; smoke script. **Deploy everything; verify the staging URL logs in.**

### FS1
- **Morning:** Design tokens + Tailwind config + shadcn setup + base primitives (Button, Card, Input, Chip, EmptyState, Skeleton, PageHeader, AppShell with faculty nav). Merge early - everyone builds on this.
- **Afternoon:** Auth pages (login/register) on Supabase Auth; onboarding shell (steps: essentials → CV upload placeholder → ORCID → Google - later steps stubbed but navigable); profile page (view/edit) against `/profile`.
- **Evening:** Faculty dashboard v1 against `/profile/dashboard` (stub returns seeded-real counts once FS3's endpoint lands); `useJob` hook + `<JobProgress>` component (poll + realtime).

### FS2
- **Morning:** Admin AppShell + routing; notifications bell + toast system + `notifications` realtime subscription (this is the realtime backbone everyone reuses).
- **Afternoon:** Admin overview page (action cards) + faculty directory (search/sort/filter) against stubs→real endpoints as FS3 lands them.
- **Evening:** Implement `/admin/overview`, `/admin/faculty` API handlers (FS2 writes API for their own vertical throughout, on FS3's foundation). Realtime helper lib (`lib/realtime.ts`: subscribe + query-cache patching + polling fallback).

### ML1
- **Morning:** Google Cloud project, OAuth consent screen (test mode) + credentials; demo Google account created; `scripts/seed_google_fixture.py` drafted.
- **Afternoon:** OAuth connect/callback endpoints + encrypted token storage (`oauth_connections`); connectors skeleton (gmail/gcal/gdrive clients with fixture-replay mode behind `RECONSTRUCT_FAKE_SOURCES`).
- **Evening:** ORCID/OpenAlex/Crossref clients + normalizers with recorded cassettes; `publication_sync` job writing `publication_candidates` for a hardcoded test ORCID.

### ML2
- **Morning:** Fixture authoring: `Appraisal_2026.xlsx` (37 fields, styled/merged), `..._v7` variant, DOCX request, fillable PDF, 12 sample certificates, 2 sample CVs, fixture email/calendar YAML for ML1.
- **Afternoon:** Canonical field catalog v1 (~60 fields) + resolver registry interface + 10 core resolvers (profile fields, publication counts/lists, FDP list) tested against seeded data.
- **Evening:** XLSX structure parser v1 (openpyxl → `form_fields` on the fixture workbook) with unit tests.

### ML3
- **Morning:** LLMProvider: protocol, Gemini implementation with structured outputs, Anthropic fallback, `FakeLLM` for tests; prompt loader (`ml/prompts`).
- **Afternoon:** Embedding pipeline: `embed()` + `embedding_refresh` job (profile embeddings for all seeded faculty); pgvector search helper.
- **Evening:** NL activity parser v1 (`parse_natural_language_activity` prompt + schema + golden tests); `/capture/quick-add` endpoint.

### Day 1 Definition of Done
- [ ] Staging URL: register, log in as faculty and admin, see role-correct shells with seeded data
- [ ] Migration 001 applied; seed idempotent; RLS on
- [ ] CI green; merge→staging deploy→smoke passes
- [ ] All API stubs merged; `packages/shared` types generated
- [ ] Job framework runs the no-op job with live progress in UI
- [ ] LLMProvider callable from worker (one real Gemini structured call verified)
- [ ] Contracts §3 all frozen and announced

---

# DAY 2 - Wednesday 13 August: CORE PRODUCT

**Day goal: the P0 product loop works end-to-end on staging: activities → evidence → publications → appraisal submit → admin review (realtime) → PDF. Community schema live with connections + messages.**

### FS1
- **Morning:** Activities module UI complete: list (filters/search), create/edit form (category-specific metadata fields via per-category field configs), detail view, confirm/archive, timeline. Implements `/activities/*` API handlers with FS3-reviewed service layer.
- **Afternoon:** Evidence library: signed-URL upload flow with progress, grid/list with filters, attach/detach from activities, download. Dashboard cards now fully live (counts from real queries).
- **Evening:** Publication candidates UI: "Are these yours?" review list with match reasons, confirm/reject (bulk confirm), publications view. Proposed-activity review pattern componentized (`<ProposalCard>`, reused by reconstruct/shared-facts/student-credit/quick-add).

### FS2
- **Morning:** Submissions list (filters: cycle/department/year/status; sorts: name/employee code/submission date) + submission detail viewer (sections, items, evidence links).
- **Afternoon:** Review actions (comment/return/approve/reject) + `appraisal_reviews` API; realtime: `submissions:institution` channel on admin list, `submission:{id}` on faculty view; reminder nudge.
- **Evening:** Community backend+UI part 1: connection requests (send/respond, realtime notification), connections list, people directory with SQL filters (embedding search tomorrow). Direct messages: conversations + messages API, RLS, conversation UI with realtime delivery (two-context tested).

### FS3
- **Morning:** Appraisal engine: draft generation service (cycle window → confirmed activities → sections by category mapping → `appraisal_submission_items`), readiness computation, submit validation + state machine.
- **Afternoon:** PDF pipeline: Jinja2 + WeasyPrint in worker; appraisal PDF template (clean, tokens-consistent); `pdf_generate` job; signed-URL delivery. 
- **Evening:** Shared academic facts backend: `institution_events` + `event_participants` fanout → proposed activities + notifications; admin events API. Student records + achievements + mentor-credit fanout. Authz test matrix (pytest) covering faculty/admin isolation. Support duty all day for the other five.

### ML1
- **Morning:** Publication identity scoring (name variants/institution/co-author overlap/topic similarity) + dedupe (DOI, normalized-title hash); candidates land bucketed for FS1's UI. OpenAlex author disambiguation endpoint.
- **Afternoon:** Gmail/Calendar/Drive harvest queries implemented against the real demo account (bounded query set per PROJECT.md); run `seed_google_fixture.py` to populate it; signals persisted as `candidate_sources`.
- **Evening:** Extraction stage: rule filters + `classify_academic_activity` on harvested signals → typed CandidateSignals. Reviewer-thanks patterns (Reviewer Karma) included.

### ML2
- **Morning:** DOCX parser (tables + placeholder detection) and PDF AcroForm parser → unified `form_fields`.
- **Afternoon:** `map_form_fields` prompt + mapping stage (catalog + hints injection); resolver execution → filled/ambiguous/missing; coverage computation; `form_analyze` job end-to-end on the XLSX fixture (API-level, UI tomorrow).
- **Evening:** Unresolved question generation (plain-language prompt) + answer persistence + reusable facts (Duplicate Ask Deflector storage). XLSX fill stage: write values into the original workbook preserving formatting; round-trip unit test asserting styles/merges/formulas survive.

### ML3
- **Morning:** People search: embedding query + filter combination (`/community/people`); tested against seeded profiles ("computer vision healthcare mumbai" returns the right seeds).
- **Afternoon:** Mentor/collaborator recommendations job + reasons; `/community/recommendations`.
- **Evening:** Quick-add polish: multi-activity utterances split correctly; relative-date resolution ("today", "last week"); voice input component (Web Speech API) handed to FS1's quick-add modal. Career rules engine v1: rule definition JSON + deterministic progress evaluation (`/career/rules/progress`).

### Day 2 Definition of Done
- [ ] On staging: create activity → upload+attach evidence → sync publications → confirm candidate → generate appraisal draft → submit → **admin sees it appear live** → return with comment → faculty sees live → resubmit → approve → download PDF
- [ ] Connection request + accept + DM round-trip live between two browsers
- [ ] `form_analyze` on fixture XLSX returns correct field list + ≥80% correct mappings (API-level)
- [ ] Reconstruct harvest+extract produces persisted CandidateSignals from the demo Google account
- [ ] Quick-add "Conducted a 2-hour seminar on GenAI today for TE IT" → correct proposed activity
- [ ] E2E specs for the appraisal loop and messaging pass in CI

---

# DAY 3 - Thursday 14 August: HERO AUTOMATION

**Day goal: both hero flows work end-to-end on staging: Reconstruct My Year (real Google account AND fixture mode) and Any Form XLSX (upload → questions → download). CV import and batch certificates land. Shared facts fan out.**

### ML1 (hero: Reconstruct)
- **Morning:** Correlation stage: cross-source clustering (date-blocking + fuzzy title/org + embeddings) → `reconstruction_candidates` with linked sources; confidence scoring + buckets.
- **Afternoon:** Dedupe vs. existing activities + ignored candidates; confirm flow: activity creation + evidence import (Drive/Gmail attachment → Storage) at confirm time; run report with per-source coverage.
- **Evening:** Full runs against the demo account until the candidate set is demo-quality (target: 8-12 candidates, ≥5 high bucket, the IEEE-talk 3-source correlation works); fixture mode (`RECONSTRUCT_FAKE_SOURCES=1`) produces the same candidates through the same pipeline; failure paths (expired token, partial source) render correctly.

### ML2 (hero: Any Form)
- **Morning:** `form_generate` end-to-end + evidence ZIP + field report; wire `waiting_for_user` → questions → generate flow with FS1's UI.
- **Afternoon:** CV Import: chunked extraction prompt → activity drafts → dedupe vs. publication pipeline → bulk-confirm payload; `cv_import` job; run on both fixture CVs.
- **Evening:** Batch certificates: OCR ladder (PyMuPDF text → vision-LLM fallback) → per-doc metadata extraction → duplicate clustering → proposed activities with confidence; run on the 12 fixture certificates. Version-proof check: `_v7` fixture reuses mappings via hints (measure: analyze time + coverage on second run).

### FS1
- **Morning:** Reconstruct UI: source checklist + run start, live progress, candidate review screen (grouped, evidence chips, "why suggested" drawer, confirm/edit/ignore, bulk-confirm) on `<ProposalCard>`.
- **Afternoon:** Any Form UI: upload dropzone, analysis progress, mapping review table + coverage bar, unresolved questions panel, outputs download card. 
- **Evening:** Onboarding completion: CV upload step wired to `cv_import` + bulk-confirm grid; ORCID + Google connect steps live; integrations settings page (connected accounts, scopes in plain words, disconnect + delete-derived-data).

### FS2
- **Morning:** Communities: create/join/leave, community page, posts (composer with kind selector), comments, reactions, realtime on open community. General feed (connections + communities + institution) with cursor pagination.
- **Afternoon:** Admin events UI: create institution event, add participants (picker + CSV), see fanout status; faculty-side shared-fact proposals appear via `<ProposalCard>` + notification. Student achievements admin form → mentor-credit proposal flow.
- **Evening:** Admin analytics (completion by department, category counts - real queries, Recharts only here); co-author propagation surfacing (uses ML1's author matching + shared-facts fanout).

### FS3
- **Morning:** Email-in capture: dedicated Gmail capture account + `email_capture_poll` job (2 min cron) → hand attachment/body to ML2's extractor → proposed activity + notification; per-faculty token addressing (`+token`).
- **Afternoon:** Hardening pass: rate limits live, upload validation (MIME/size/macro rejection), CORS lockdown, Sentry wired on all three surfaces, request-id logging; `/ready` checks real.
- **Evening:** Seed v2: full demo dataset per PROJECT.md §Seed Data (submissions in varied states, communities alive, conversations, opportunities, pending proposals, missing-evidence cases); `reset_demo.py` (snapshot/restore of demo state).

### ML3
- **Morning:** Teaching change: snapshot + file ingestion (hash, text extraction) API/UI contract with FS1; deterministic diff stage.
- **Afternoon:** `summarize_teaching_changes` on real diffs of the CS402 fixture folders → typed changes; approve→activity flow; teaching page UI support (pairing with FS1 on a simple runs/results screen).
- **Evening:** Next Best Move: recommendations job joining rule gaps × opportunities with reasons; career page payload (`/career/recommendations` + progress). Opportunities admin CRUD (with FS2).

### Day 3 Definition of Done
- [ ] Demo path 2 (Reconstruct, per PROJECT.md demo script) works on staging with the real Google account AND in fixture mode
- [ ] Demo path 3 (Any Form XLSX) works: 37-field fixture → ≥30 auto-filled → 3 questions → downloaded file opens in Excel with formatting intact
- [ ] CV fixture upload → ≥40 drafts → bulk confirm
- [ ] 12 certificates batch → clustered proposals with correct metadata on ≥9
- [ ] Admin creates FDP event with 12 participants → each faculty gets a live proposal → confirm works
- [ ] Teaching compare on fixture course folders detects the planted changes (3 new labs + assessment change)
- [ ] E2E specs: reconstruct (fixture mode) + Any Form pass in CI

---

# DAY 4 - Friday 15 August: DIFFERENTIATION + POLISH

**Day goal: every P1 demo moment works and looks premium. No broken or fake UI anywhere. Feature freeze for P1 at 21:00.**

### FS1
- **Morning:** Living CV: export formats (Full CV PDF + 100/250-word bios) from confirmed activities; profile export card. Proof Later: evidence-pending chips, dashboard debt card, attach-suggestion toasts (ML2 matcher).
- **Afternoon:** Faculty-surface polish sweep: every route gets designed empty states, skeletons, error boundaries, 375px responsiveness, motion (list transitions, proposal confirm animation), teacher-language copy review of every string.
- **Evening:** Deadline Rescue UI: single guided progress screen over ML1's orchestrator; readiness checklist; "5 things need you" flow.

### FS2
- **Morning:** Admin delta view (H17): year-over-year new/changed queries + clean presentation. Department report generator: range+sections → `dept_report` job → DOCX/PDF download.
- **Afternoon:** Network polish: profile pages (publications summary, open-to flags, connect state machine), recommendation cards with reasons, feed/community empty states, message UX (unread badges, read receipts, enter-to-send).
- **Evening:** Admin console polish: action cards all live, filters/sorts snappy (indexes verified), submission viewer refinement, nudge flow; notification center page.

### FS3
- **Morning:** Production environment: prod Supabase migrated + seeded, prod Railway services, prod Vercel, domains/CORS, env parity audit; deploy `main` to prod for the first time; smoke prod.
- **Afternoon:** Performance pass: dashboard endpoint single-query aggregation, N+1 audit (SQLAlchemy echo review on hot endpoints), pagination everywhere, p95 check against targets. Data export endpoint (Career Passport).
- **Evening:** Backup safety: DB snapshot schedule, `reset_demo.py` tested against prod-clone, uptime workflow, on-call runbook (`docs/RUNBOOK.md`: restart procedures, provider status links, fallback flags).

### ML1
- **Morning:** Deadline Rescue orchestrator: sequenced child jobs (pub sync → reconstruct → evidence scan → draft) with aggregate progress; idempotent re-runs.
- **Afternoon:** Reconstruct quality tuning on the demo account (thresholds, suppression of noisy candidates, snippet quality); Google reconnect/expiry UX with FS1.
- **Evening:** Nightly sync crons enabled; co-author matching precision pass (no false-positive proposals in seed); freeze ML1 pipelines, write down demo-run parameters.

### ML2
- **Morning:** Any Form DOCX generate end-to-end; fillable-PDF fill; companion-mode fallback rendering (clean generated report) with the explicit UI notice.
- **Afternoon:** Proof Later matcher (new captured evidence ↔ pending-evidence activities); email-capture extraction quality pass on fixture forwards.
- **Evening (stretch, only if green):** Admin Mail → Done: pasted-email parse → multi-faculty Any Form run → filled sheet + per-faculty gaps + draft reply. Otherwise: fixture-cache warm-up (pre-analyze demo files on prod so demo runs are instant) and prompt-cassette persistence for demo-critical calls.

### ML3
- **Morning:** Career page final: rule progress ring + recommendations with deadlines; dismiss persistence. Opportunities seeded well.
- **Afternoon (stretch):** Browser workflow: mock portal deployed, two authored workflows, run-with-screenshots + approval pause. Timebox to 15:00 - if not smooth by then, feature-flag OFF and pivot to helping polish (this is the designated schedule-slack).
- **Evening:** Embedding/recommendation quality pass (search demo queries return the intended seeds, reasons read well); voice quick-add cross-browser check (Chrome primary, note Safari caveat in UI).

### Day 4 Definition of Done
- [ ] Full demo script (all 7 beats) executable on **staging** by FS1 solo, no developer intervention
- [ ] Prod deployed, migrated, seeded, smoked
- [ ] Zero fake UI: every button works or is disabled with explanation (team sweep at 20:00: each engineer audits someone else's vertical)
- [ ] All P1 features frozen at 21:00; only fixes after
- [ ] Lighthouse ≥80/≥95 on dashboard + network pages; 375px pass on faculty surfaces
- [ ] Runbook + fallback flags documented and tested (`RECONSTRUCT_FAKE_SOURCES`, LLM fallback, realtime polling)

---

# DAY 5 - Saturday 16 August: STABILITY, DEPLOYMENT, PRESENTATION

**Rule of the day: no new features. Fix, verify, rehearse. Code freeze escalates through the day.**

### Morning (09:00-13:00) - verification
- **All:** Bug triage board from Day 4 sweep; fix P0/P1 bugs only (labels: `demo-blocker`, `polish`, `wontfix-hackathon`).
- **FS1+FS2:** Cross-browser (Chrome/Edge/Firefox/Safari) + mobile pass on demo-path screens; permission matrix manual test (faculty A cannot see faculty B's data; admin cannot cross institution); upload edge cases (25MB, wrong MIME, duplicate).
- **FS3:** Full E2E suite green against staging; job-failure drills (kill worker mid-job → retry works; LLM key revoked → fallback engages); load sanity (k6 or simple script: 20 concurrent users on dashboard + list endpoints).
- **ML1/ML2/ML3:** Run every demo pipeline 3× consecutively on prod-parity data; verify fixture fallbacks; warm caches for the exact demo files/accounts.

### Afternoon (13:00-17:00) - production + assets
- 13:00: **Final prod deploy** (`main` tagged `v0.1-demo`); prod migration; `reset_demo.py` to pristine demo state; full smoke; **hard code freeze except demo-blockers.**
- 14:00: **Full demo rehearsal #1 on prod** (presenter + timekeeper; script from PROJECT.md §Demo Script). Fix list from rehearsal.
- 15:00: **Record backup demo video** (full script, prod, screen-recorded, downloaded to two laptops + a phone).
- 15:30-17:00: PPT/submission assets: architecture + ER mermaid diagrams exported, screenshots of every demo beat, metrics slide (activities recovered in reconstruct run, fields auto-filled count, seeded scale), problem→principle→demo narrative. Second rehearsal with slides.

### Evening (17:00-21:00) - freeze + rehearse
- 17:00: **Absolute code freeze.** Prod DB state locked; `reset_demo.py` is the only allowed mutation.
- 17:30: **Rehearsal #2 and #3** on prod, including fallback drill (run one rehearsal entirely in fixture mode + polling mode to prove degraded path).
- 19:00: Demo logistics: both laptops configured (fresh browser profiles, bookmarked URLs, logged-in sessions verified, video downloaded, hotspot tested as network backup); `docs/DEMO_CHECKLIST.md` executed line by line.
- 20:00: **Buffer (the mandated 2-3 hours).** Team dinner. On-call: FS3 monitors uptime workflow + Sentry.

### Day 5 Definition of Done
- [ ] Prod URL: full demo script runs clean 3× in a row, once in degraded mode
- [ ] Backup video on 3 devices; screenshots + diagrams in the deck
- [ ] Smoke passing on prod; uptime monitor green; Sentry quiet
- [ ] Demo checklist executed; reset script verified; both presenters rehearsed
- [ ] Repo tagged, README with URLs + demo accounts + architecture pointer

---

## 6. Dependency Map (what blocks what)

```
Day1: repo(FS3) → tokens(FS1) → migration001(FS3) → {API stubs, seed v1}(FS3) → all verticals unblocked
LLMProvider(ML3, Day1) → NL parser(ML3), classify(ML1), mapping(ML2)
activities API(FS1, Day2 AM) → appraisal engine(FS3, Day2), resolvers realdata(ML2, Day2)
ProposalCard(FS1, Day2 PM) → reconstruct UI, shared facts UI, batch certs UI, quick-add UI (Day3)
notifications+realtime lib(FS2, Day1) → all realtime features
publication candidates(ML1, Day2) → co-author propagation(Day3)
harvest(ML1, Day2) → correlate/score(ML1, Day3) → reconstruct demo
form_analyze(ML2, Day2) → form UI(FS1, Day3) → form_generate(ML2, Day3)
shared facts backend(FS3, Day2) → events UI(FS2, Day3), co-author fanout
seed v2(FS3, Day3) → Day4 polish + Day5 rehearsal
prod env(FS3, Day4 AM) → Day5 everything
```

Standup rule: anything on this map slipping >4h is raised immediately and either re-scoped or re-staffed (FS3 is first responder, ML3 is second after their Day-4 timebox).

## 7. Risk Playbook (build-time)

| Trigger | Response |
|---|---|
| Reconstruct correlation quality poor by Day 3 noon | Ship high-precision subset only (certificates + reviewer emails + calendar-only candidates); fixture mode carries the demo breadth |
| Any Form mapping accuracy <80% on fixtures by Day 3 noon | Add per-fixture mapping hints (legitimate: hints are a product feature); narrow demo to the two fixture files |
| Google OAuth verification/consent problems | All demo identities are pre-added test users; worst case fixture mode (identical UX) |
| Supabase Realtime unreliable | Polling fallback already in hooks; demo unaffected (2-5s instead of instant; script wording says "moments later") |
| A vertical owner is sick/stuck | FS3 absorbs platform-adjacent work; P2 items in that vertical are cut first per §2 cut order |
| Behind on Day 4 morning | Invoke cut order immediately at 09:00 standup; polish beats breadth - a smaller flawless demo wins |

## 8. What MUST NEVER be cut (final restatement)

Deployed prod system with real auth, real DB, real storage; activities+evidence; publication automation with confirm; appraisal submit→admin realtime review→PDF; admin search/sort/filter; Reconstruct My Year (fixture mode minimum, real pipeline); Any Form XLSX end-to-end; Teacher Network search+connect+message; seeded, believable demo data; backup video.
