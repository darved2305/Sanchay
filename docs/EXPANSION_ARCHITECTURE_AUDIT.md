# Expansion Architecture Audit

Ground truth for the planned expansion (Faculty Action Inbox, Smart Academic Repository +
Student Outcomes, GrantOps, Adaptive Career Navigator, Faculty Professional Network,
Reconstruct performance redesign), read directly from the current codebase — no assumptions
carried over from the spec. Stack: FastAPI (`backend/app`, ~8.6k LOC) + React/Vite
(`frontend/src`, ~7.3k LOC) + Supabase Postgres (9 migrations, `supabase/migrations/`).

## Cross-cutting infrastructure

| Piece | Current state |
|---|---|
| **LLM provider** | `backend/app/services/llm.py` — single `LLMProvider` class wrapping **Groq** (OpenAI-compatible Chat Completions). `extract_structured()` uses forced tool-calling (`tool_choice` pinned to one function) so output is always schema-valid JSON, never prose to re-parse. `transcribe_image()` does vision OCR for scanned docs. Returns `None` on any failure/unconfigured key — every caller has a deterministic fallback, never a hard failure. Env: `GROQ_API_KEY`, `LLM_MODEL` (default `openai/gpt-oss-20b`), `LLM_VISION_MODEL`, `LLM_TIMEOUT_SECONDS`. **This is the correct abstraction to reuse for Action Inbox classification, Repository classification, and NL career-goal parsing — do not build a second LLM client.** |
| **Background jobs** | No task queue (no Celery/RQ/arq). Long-running work runs inline via `fastapi.BackgroundTasks` inside the request process, progress reported through one shared `background_jobs` table (`id, owner_id, kind, status, progress, progress_label, result jsonb, error`) that the frontend polls/subscribes to. One row shape, one progress-chip component (`services/jobs.py`: `create_job`/`update_job`/`get_job`). **Reused as-is** for Action Inbox mail classification jobs, Repository classification jobs, and delta-sync jobs — add new `kind` values, no new envelope.
| **Realtime** | Supabase Realtime via `postgres_changes` channels, one big channel per user (`frontend/src/lib/realtime.js`: `subscribeToFacultyUpdates`). Explicit allowlist of tables (`appraisal_submissions`, `notifications`, `academic_activities`, `background_jobs`, `form_jobs`, `teaching_changes`, `career_recommendations`, `recommendation_letters`, `connection_requests`, `messages`, `community_posts`). 5-second polling fallback if the channel drops (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`). New tables must be **added to this allowlist explicitly** (both the Postgres `supabase_realtime` publication in the migration, and this JS array) or they silently never update in realtime.
| **Vector / semantic search** | **Does not exist.** No pgvector extension, no embedding columns, no embedding calls anywhere in `backend/app`. Academic Network "recommendations" (`services/network.py`) are tag-overlap/SQL-filter based, explicitly *not* semantic — the code comment calls this out as an honest gap. Any spec requirement for "semantic search" or "embedding" is new infrastructure, not an extension.
| **OAuth / token storage** | `oauth_connections` table (migration `007`): `profile_id, provider (enum: gmail/google_calendar/google_drive), status, external_account_email, expires_at, encrypted_access_token, encrypted_refresh_token`. Encryption: Fernet key derived by SHA-256 of the Google OAuth client secret (no new secret needed). State-signing: HMAC-SHA256 signed `{user_id, provider, expiry, nonce}`, 10-minute TTL, verifies the OAuth redirect since there's no server session. Scopes already granted: `gmail.readonly`, `calendar.readonly`, `drive.readonly` — **read-only**. Action Inbox's "create Gmail draft" requirement needs `gmail.compose` or `gmail.modify`, which is a **new incremental scope** not currently requested; per spec §6 this must degrfully to a copy/in-app draft fallback when absent, which the existing "absent credentials → `not_configured`, never crash" pattern already models correctly.
| **Design tokens** | `frontend/src/styles/brand.css` (13.7KB) — the one and only token file, warm/lavender/mint/peach/butter/sky palette per spec §65. `frontend/src/App.css` and `index.css` are structural, not tokens. **No new design system** — every new screen must consume `brand.css` custom properties only.
| **Auth/permissions** | `core/auth.py` (`require_faculty`, `require_admin`), `core/permissions.py`, JWT via Supabase JWKS/ES256. Every existing router scopes by `owner_id = auth.uid()` (RLS) *and* repeats the same filter in the FastAPI query — belt-and-suspenders pattern to copy exactly for every new table.
| **Rate limiting** | slowapi `SlowAPIMiddleware`, default `120/minute` on every route (`rate_limit_default` setting) — applies automatically to new endpoints, no per-route work needed unless a route needs a tighter/looser limit.

## Feature-by-feature

### 1. Faculty Action Inbox — **does not exist**

| | |
|---|---|
| Current frontend | None. |
| Current API | None. |
| Current DB | None. |
| Current realtime | None. |
| Current jobs | None. |
| What can be reused | Gmail connector (`connectors/google.py::fetch_gmail_items`) already lists+fetches message metadata/snippets read-only and already filters Google's own automated notification mail. `LLMProvider.extract_structured` for classification+extraction in one call. `background_jobs` envelope for the classification run. Realtime allowlist pattern. `oauth_connections` table/token refresh logic. |
| What must be extended | Gmail fetch currently pulls `metadata` format only (Subject/Date/From headers + snippet) — Action Inbox's required extraction fields (deadline, requested_action, related_people, research_topics) need the **full message body**, not just the snippet, so the fetcher needs a `format=full` variant (or `format=full` for a second-pass fetch on emails that pass a cheap keyword prefilter, to stay within Gmail's rate limits). Reply drafting needs `gmail.compose` scope (new). |
| Performance problem | Reconstruct's Gmail fetch (`fetch_gmail_items`) does a full `newer_than:365d` list + up to 50 per-message detail fetches on every run, synchronously, no cursor. Action Inbox must **not** duplicate this fetch — see Reconstruct section; the two features should share one Gmail harvest, not each independently re-scan the mailbox. |
| Notes | This is the largest net-new feature. Needs new tables (`action_inbox_items` at minimum) and a new router. |

### 2. Smart Academic Repository (Evidence upgrade) — **partially exists, classification layer is entirely missing**

| | |
|---|---|
| Current frontend | `EvidencePage.jsx` + `evidence.py` router — upload, list with filters (`q`, `year`, `mime_group`, `tag`, `activity_id`, `org`), attach/detach to an activity, signed download, delete. Cursor-based pagination (`services/pagination.py`). |
| Current API | `POST /evidence/upload-url` (client uploads directly to Supabase Storage via signed URL) → `POST /evidence/{id}/finalize` (verifies the object landed, records `size_bytes`) → attach/detach/list/download/delete. |
| Current DB | `evidence_files(id, owner_id, storage_path, file_name, mime_type, size_bytes, sha256, source, extracted_title, extracted_text_snippet, doc_date, organization, tags, created_at, updated_at)`, `activity_evidence(activity_id, evidence_id)` join table. |
| Current realtime | None (not in the realtime allowlist). |
| Current jobs | None. |
| What can be reused | The entire upload/storage/signed-URL/finalize pipeline is production-shaped and correct — **do not rebuild it**. The `evidence_files` schema already has `sha256`, `extracted_title`, `extracted_text_snippet`, `doc_date`, `organization`, `tags` columns sitting **unpopulated** — a code comment in `finalize_evidence` literally says "Extraction/embedding workers can enrich these nullable fields later." This is exactly the hook point for the classification pipeline; no schema migration needed for the core fields, only additions (`document_type`, `confidence`, `related_activity_id` proposal state, `related_student_id`). `services/document_text.py` exists (used by CV Import / Any Form) — check it for reusable text-extraction before writing a new PDF/DOCX/XLSX parser. `services/evidence_match.py::find_evidence_matches` already does activity-matching for the "Proof Later" USP — this is the direct ancestor of §12's "automatic activity matching," extend rather than replace. |
| What must be extended | No `sha256` computation happens today (`finalize_evidence` only reads `size`, never hashes) — dedupe (spec §9) needs this added at finalize time. No document-type taxonomy/classification exists — this is 100% new logic layered on the existing `extracted_title`/`tags` columns. Bulk ZIP download (§14) is entirely new (Storage doesn't support server-side zip; needs an async job that streams objects into a zip and stores it in the `generated` bucket, using the existing `background_jobs` envelope). |
| Performance problem | None currently (no batch processing exists yet to have a performance problem). |
| Notes | Student Outcome Intelligence (spec §15–17) is a specialization of this same pipeline (same classifier, different taxonomy branch) — must not become a parallel upload path. |

### 3. GrantOps — **does not exist**

| | |
|---|---|
| Current frontend | None (Career Growth page lists `opportunities` generically, no grant-specific stage/workspace UI). |
| Current API | `opportunities` table/endpoints (`career.py`) are the closest existing concept — generic `kind, title, description, tags, deadline, url`, institution-scoped or global, matched to career-rule gaps via `services/career.py::match_opportunities`. |
| Current DB | `opportunities(id, institution_id, kind, title, description, tags[], deadline, url, created_by, created_at)` — no stage/workflow columns, no eligibility, no team, no documents, no tasks. |
| Current realtime | None. |
| Current jobs | None. |
| What can be reused | `opportunities` table as the seed/source-of-record for `kind='grant'` rows feeding into a new `grant_opportunities`/`grant_workspaces` structure — reuse rather than duplicate the base "what grants exist" list. `career.py::match_opportunities`'s reason-string pattern (never an opaque score) is the right template for eligibility reasoning. Evidence Repository (once built) for the "required documents already on file" matching (§22). |
| What must be extended | Everything past "list of opportunities" — stages, eligibility rules engine, team formation (needs Professional Network), grant workspace, awarded→AcademicActivity proposal flow (same "propose, never silently credit" pattern already used by `event_participants`/Shared Academic Facts). |
| Notes | Grant eligibility rules should live in a data-driven table analogous to `career_rules` (institution-scoped `rules jsonb`), not hardcoded Python, matching the existing pattern exactly. |

### 4. Adaptive Career Navigator — **substantial existing engine, needs NL-goal + dynamic-signal layers added**

| | |
|---|---|
| Current frontend | `CareerGrowthPage.jsx`. |
| Current API | `career.py` — `/career/rules` (list institution goal catalog), `/career/goals` (get/set **one** active goal from that fixed catalog), `/career/progress` (evaluate rule thresholds against confirmed activities), `/career/recommendations` (match opportunities to rule gaps, dismissible), `/career/dossier` (PDF export). Admin CRUD for `career_rules`. |
| Current DB | `career_rules(institution_id, goal_key, goal_label, description, rules jsonb)` — **admin-authored, fixed catalog only**, not user-authored free text. `career_goals(profile_id, career_rule_id, is_active)` — one active goal per faculty, foreign-keyed to the fixed catalog (**no room for a custom NL goal today** — this is a hard schema gap, not a UI gap). `career_recommendations(profile_id, opportunity_id, reason, gap_key, dismissed)`. `promotion_dossiers` snapshot history. |
| Current realtime | `career_recommendations` is in the realtime allowlist. |
| Current jobs | None (dossier PDF generation is synchronous, small enough not to need one). |
| What can be reused | `evaluate_career_rules`/`match_opportunities` (`services/career.py`) — deterministic, explainable, threshold-based progress evaluation with **zero fake percentages already** (spec §32/§67 is already satisfied by the existing design: "5/5 ✓", not "94%"). This engine is exactly right and should be the milestone-evaluation core for custom goals too, not replaced. |
| What must be extended | `career_goals` needs to support a **user-authored goal** independent of `career_rules` (NL-parsed `{goal_type, title, target_date, measurable_outcomes[], milestones[]}`), while keeping the existing rule-catalog path for admin/institution-defined promotion goals — these are two goal *sources* feeding one goal *model*, not a replacement. The "opportunities for your goal" recommendation surface currently only pulls from `opportunities`; spec §31/§34 requires it to also pull from Action Inbox items, GrantOps, and Professional Network — this is new correlation logic once those features exist, and should be event-driven (react to new signals) rather than a recompute-on-load, matching spec §62. |
| Notes | Do not build a second "goals" concept — extend `career_goals`/`career_rules` in place. |

### 5. Faculty Professional Network — **most of the spec's Feature 5 already exists as "Academic Network" (USP 9), live-verified**

| | |
|---|---|
| Current frontend | `CommunityPage.jsx`. |
| Current API | `network.py` (`/community/*`, `/messages/*`) — `people` search (name/bio/expertise/research-interest, `open_to` filter), `recommendations` (intent-scoped: mentor/phd_supervisor/collaborator, **with explainable `reasons[]`, not a score** — already matches spec §40 exactly), connection requests (send/list/accept/decline → `notifications`), `connections` list, `communities` (create/join/leave), `feed` (global + community + connection-scoped visibility), posts (`kind`: post/question/opportunity/announcement — **not yet** the full spec §37 taxonomy), comments, reactions (single `post_reactions` type — spec §38 wants Like/Insightful/Celebrate distinctions, currently just one), direct messaging (conversations, messages, unread counts, mark-read). |
| Current DB | `connection_requests`, `connections`, `communities`, `community_members`, `community_posts` (`kind` enum), `post_comments`, `post_reactions`, `direct_conversations`, `conversation_members`, `messages`. Profile fields already include `open_to_mentorship`, `open_to_collaboration`, `accepting_phd_inquiries`, `research_interests`, `expertise`, `bio`, `photo_url` (on `profiles`, from `001_compulsory.sql`). |
| Current realtime | `connection_requests` (both directions), `messages` (unfiltered — RLS still scopes what's delivered), `community_posts` are all live in the allowlist and migration publication. Dedicated `useConversationRealtime` hook for sub-second per-conversation delivery. |
| Current jobs | None needed (all synchronous, appropriately). |
| What can be reused | Nearly everything structurally — this was **live-verified with two real accounts** per `FINAL_PRODUCT_IMPLEMENTATION_AUDIT.md` (connect→accept→realtime notification, messaging with unread counts, community create→join→post→cross-user feed→reactions). The realtime wiring pattern here is the reference implementation for every other realtime feature added. |
| What must be extended | No `follows` table (connect-only today, spec §36 wants separate follow). No collaboration-specific post type/workspace (spec §39/§42 "Looking for Collaborators" + Collaboration Workspace) — `post_kind` enum needs a new value plus a structured payload (research area, looking-for, skills-needed) rather than free `body` text only. No `open_to_grant_collaboration`/`open_to_reviewing` flags on `profiles` (only 3 of the spec's 5 flags exist). Reaction types are single, not multi-type. No `collaboration_workspaces`/`collaboration_members` tables. |
| Notes | This is the lowest-risk feature to extend — treat it as "add columns/tables to a working system," not a rebuild. |

### 6. Reconstruct My Year performance redesign — **currently a full synchronous re-scan every run; this is the most architecturally significant gap**

| | |
|---|---|
| Current frontend | `ReconstructMyYear.jsx`. |
| Current API | `reconstruct.py` — `/reconstruct/sources` (connection status), `/reconstruct/oauth/{provider}/start|callback|disconnect`, `POST /reconstruct/runs` (kicks off a full run via `BackgroundTasks`), `/reconstruct/runs/{id}`, `/reconstruct/runs/{id}/candidates`, confirm/ignore candidate. |
| Current DB | `reconstruction_runs(profile_id, job_id, academic_year, sources_used[], candidate_count, confirmed_count)`, `reconstruction_candidates(run_id, profile_id, category, title, organization, start_date, confidence, status, metadata, activity_id)`, `candidate_sources(candidate_id, source_type, source_ref, snippet, raw)`. **No `source_signals` table, no `activity_clusters` table, no sync cursor/history-token storage anywhere in the schema.** |
| Current jobs | One `background_jobs` row per run, via `BackgroundTasks` (in-process, not a separate worker). |
| Current pipeline (confirmed by reading `_run_reconstruction` + `connectors/google.py` line by line) | Every single `POST /reconstruct/runs` call: (1) lists **all** Gmail messages `newer_than:365d` (up to 50) and fetches metadata for each individually — no stored cursor, no `historyId`; (2) lists **all** Calendar events on the primary calendar (up to 100) — no `syncToken`; (3) lists **all** non-trashed Drive files (up to 100) — no `startPageToken`; (4) runs the full harvested set through `is_academic_signal` + `run_pipeline` (LLM correlation) **from scratch**, with no persisted classification/embedding to skip already-seen items; (5) the *only* dedupe is a `lower(title)` string match against existing `academic_activities` titles, which prevents re-proposing a title twice but does **not** prevent re-fetching, re-classifying, or re-correlating the same raw item on every run. This matches the spec's "CURRENT PROBLEM" description exactly — confirmed, not assumed. |
| Fixture mode | `RECONSTRUCT_FAKE_SOURCES=true` → `fixture_harvest()` returns a fixed 6-item demo set (the IEEE-talk 3-source correlation demo). Useful as a deterministic test fixture for validating the *new* incremental architecture without live Google credentials — reuse for benchmarking. |
| LLM/correlation | `services/reconstruct.py` (not yet read in full this pass — contains `is_academic_signal` keyword prefilter and `run_pipeline` which calls `LLMProvider`). Deterministic-before-LLM is already the pattern (`is_academic_signal` filters before any LLM call), consistent with spec §54. |
| What can be reused | The classify→correlate→candidate→confirm *shape* is correct and matches the target architecture's back half exactly (`SOURCE SIGNAL STORE → CLASSIFY/CORRELATE → candidates`). `oauth_connections` token refresh logic. The `background_jobs` progress envelope. The keyword-prefilter-before-LLM pattern in `is_academic_signal`. |
| What must be built (net new, this is real infrastructure work) | `source_signals` table with `(profile_id, source, external_id)` uniqueness + `content_hash` for the "never reprocess unchanged" rule; Gmail `historyId` cursor storage (extend `oauth_connections` or a new sync-state table) + delta fetch via `history.list`; Calendar `syncToken` storage + delta fetch; Drive `startPageToken`/`changes.list` + delta fetch; `activity_clusters` table for persistent correlation results so opening Reconstruct is a **read**, not a recompute; a cache-first `GET` endpoint that returns already-persisted candidates immediately, with the harvest/classify/correlate work moved to a background sync path (webhook-driven where possible, polled on a schedule otherwise) instead of running synchronously inside the user's `POST /runs` click. |
| Notes | This is the single largest and riskiest piece of the whole expansion — it changes the shape of a working, live-verified pipeline, touches encrypted OAuth token handling, and needs real before/after timing evidence (spec §59/§75), not just code review, to claim done. |

## Student records — correction: already exists (LOR Studio, USP 10); Student Outcomes should extend it, not duplicate it

Migration `006_lor_studio.sql` already defines `student_records(institution_id, full_name, roll_number, program, created_by)`, `faculty_student_links(faculty_id, student_id, relationship, course_or_project, start_date, end_date)`, and `student_achievements(student_id, title, description, achieved_on, created_by)` — institution-scoped read, faculty-link-scoped write. §15–17's Student Outcome Intelligence should add a `student_outcomes` table referencing `student_records` + `evidence_files` (document-derived: company, role, outcome_type, offer_date/start/end, completion_status) rather than inventing a parallel student model. §17's "mentor credit" flow (student outcome → confirm → `AcademicActivity`) has a direct precedent already built: `event_participants` + Shared Academic Facts (institution admin creates an event, faculty gets a *proposal*, faculty confirms → becomes a real `academic_activities` row, never silent). Model student-outcome mentor credit the same way rather than inventing a new confirmation pattern.

### Addendum — Phase A verification (this session)

`source_signals`/`activity_clusters`/`source_sync_state` (migration `010_signal_layer.sql`) applied live to the hosted Supabase project (`llpjrfugwktlaizmxrtq`, confirmed via direct `psql` connectivity through the transaction pooler — unlike prior sessions on this codebase, raw Postgres access **is** reachable from this environment/network). `services/signals.py` (`compute_content_hash`, `upsert_signal`, `mark_classified`, `unprocessed_signals`) was live-verified end-to-end against a real seeded faculty profile: fresh insert → re-upsert with identical content before classification (correctly still "needs processing") → `mark_classified` → re-upsert identical content (correctly `changed=False`, the "never reprocess unchanged" guarantee) → content change (correctly flips back to `changed=True` and re-enters the unprocessed queue) → cleanup verified zero rows left behind. 4 new pure-function unit tests pass (`backend/tests/test_signal_layer.py`); full suite is 67 passed / 6 skipped (was 63/6 before this session).

## Notifications — small, already the right shape to extend

`notifications.py` (46 lines): owner-scoped list + mark-read, `notifications(profile_id, kind, title, body, link_path)`. Already used by connection requests/acceptance, messages, appraisal review. New `kind` values (grant deadline, action-inbox item, collaboration interest) are additive — no structural change needed. Already in the realtime pattern.

## What genuinely doesn't exist anywhere (net-new for this expansion)

- Any LLM-driven email classification beyond raw harvest (Action Inbox core).
- Any document classification/taxonomy engine (Repository core).
- Any student-outcome tables.
- Any grant workflow/stage/eligibility/team tables (GrantOps core).
- Any NL career-goal parsing.
- `source_signals` / `activity_clusters` / any sync-cursor persistence (Reconstruct performance core).
- pgvector / embeddings anywhere.
- `follows`, collaboration-post structured payload, `collaboration_workspaces`.
- Gmail write scope (`compose`/`modify`) — currently read-only only.

## What this means for sequencing

The six goals are **not** equally sized. Professional Network and Career Navigator are extensions of live, working, previously-verified systems — lower risk, mostly additive schema + new endpoints on existing patterns. Action Inbox, Repository classification, GrantOps, and the Reconstruct rebuild are net-new subsystems each requiring new tables, new routers, new frontend pages, and (for Reconstruct) a rework of a working live pipeline's internals with real performance evidence. Given the shared-infrastructure mandate (§2: one signal store, not six engines), the *dependency order* that avoids rework is: **shared source-signal/classification layer first** (this is what both Action Inbox and the Reconstruct rebuild need, and Repository's classification pipeline is the same shape a third time) → **Repository classification** (self-contained, no dependency on the others) → **Action Inbox** (depends on the signal layer) → **GrantOps** (depends on Repository for readiness-matching and Professional Network for team formation) → **Career Navigator NL-goal + cross-feature signal wiring** (depends on Action Inbox + GrantOps existing) → **Professional Network extensions** (independent, can happen anytime) → **Reconstruct migrated onto the shared signal layer last**, once that layer is proven by Action Inbox.
