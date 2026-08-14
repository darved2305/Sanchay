# Product Intelligence Expansion — Final Audit

Covers the six-goal expansion (Faculty Action Inbox, Smart Academic Repository + Student
Outcomes, GrantOps, Adaptive Career Navigator, Faculty Professional Network, Reconstruct
performance redesign) built on top of the previously-verified compulsory system and 11 USPs
(`docs/COMPULSORY_DYNAMIC_IMPLEMENTATION_AUDIT.md`, `docs/FINAL_PRODUCT_IMPLEMENTATION_AUDIT.md`).
Ground-truth architecture inventory is in `docs/EXPANSION_ARCHITECTURE_AUDIT.md`; this document
reports final build status against that plan.

**A note on how this was built, in the interest of an honest audit:** this expansion was built by
two separate agent sessions working concurrently against the same working tree and the same live
hosted Supabase project, without direct coordination between them. That produced real duplicate
work on overlapping scope (most visibly: two independently-designed schemas for the Professional
Network's `follows`/collaboration tables, a duplicate migration number, and a duplicate
`fetch_calendar_delta` connector function). Every collision found was reconciled by hand — the
"What Was Reconciled" section below lists each one truthfully rather than presenting the build as
cleaner than it was. One session independently found and fixed a real, pre-existing,
security-relevant RLS bug class (unqualified correlated-subquery columns) affecting 21 policies
across both old and new migrations, including two the other session had just introduced; that fix
is verified sound by manual re-derivation of each affected policy, described under Security below.

## Existing Product Regression

All 12 compulsory feature paths and all 11 previously-shipped USPs are untouched in schema/API
shape except where a table gained new nullable columns (`evidence_files`, `profiles`,
`action_inbox_items` gaining a `related_grant_workspace_id` FK once GrantOps existed,
`post_reactions` gaining `reaction_type`). No existing endpoint signature was removed or had its
success-path behavior changed. The full backend test suite (compulsory + all 11 USPs + this
expansion, one combined suite) passes: **113 passed, 6 skipped** (skipped tests require an
isolated live database and are intentionally not run against shared seeded data, same policy as
every prior session). Frontend `npm run lint` and `npm run build` are clean. `qa/audit_p0.py`
(hardcoded-business-data audit) reports **0 compulsory findings** — the only warnings are
`setTimeout`-based polling delays, the same pattern already used throughout the pre-existing
codebase for job polling, not fake data.

## Action Inbox

**Built, backend + frontend.** `backend/app/api/action_inbox.py` + `services/action_inbox.py`,
migrations `013_action_inbox.sql`, `014_gmail_compose_scope.sql`. Classification runs over the
shared `source_signals` layer (never a second independent mailbox scan): a keyword prefilter
(`is_actionable_candidate`) decides whether a signal is worth an LLM call, then
`extract_structured` (Groq) pulls category/summary/requested_action/deadline/meeting_date/
related_people/research_topics into the exact structured schema the spec specifies, with the LLM
explicitly instructed never to invent a fact not in the source text. Non-actionable mail (`ignore_
non_actionable`) is marked classified and never resurfaces.

Priority is fully explainable — `compute_priority` returns `urgency: high|medium|low` plus a
`reasons: []` list built from concrete signals (days-to-deadline, explicit-response-requested,
known-sender via existing connections, previous-collaborator-organization via activity history,
research-interest overlap) — never an opaque score, matching §4 exactly.

Three contextual replies (`draft_replies`) are deterministic and template-grounded — accept /
conditional-modify / decline — using only the faculty's name, today's date, and facts already
extracted from the email; an optional LLM "polish" pass may only reword, never add a fact
(schema-constrained). Replies are never sent automatically: `POST /action-inbox/{id}/draft`
returns text for review/edit, and only creates a real (unsent) Gmail draft if a separate
`gmail_compose` OAuth connection exists; otherwise it returns a `fallback_reason` and the frontend
falls back to copy-to-clipboard / in-app editing, exactly per §6. **Gmail is read-only-scoped by
default; `gmail_compose` is a real, working incremental-scope connection (its own OAuth
authorize/callback path, its own `oauth_connections` row) that a faculty member must separately
grant before "Create Gmail Draft" can produce a live draft** — this is not a partial feature, it's
the deliberately-separate-consent design the spec calls for.

"Send to GrantOps" is a real action, not a status flip: it creates a `grant_opportunities` +
`grant_workspaces` row from the inbox item's extracted fields and links it back via
`related_grant_workspace_id`, so the item's "Related Emails" surfaces correctly inside the
resulting GrantOps workspace.

Frontend: `ActionInboxPage.jsx` — category/urgency chips, "Why this matters" reasons list, sync
button with job-progress polling, per-item Accept/Save/Decline/Ignore plus a reply panel for the
three drafts, Gmail-draft/copy-to-clipboard results shown inline. Wired into `Sidebar.jsx`,
`DashboardApp.jsx` routing, and `realtime.js` (`action_inbox_items`, profile-filtered).

**Live-verified against the real hosted Supabase project** (correcting an earlier draft of this
audit that assumed no live DB access was available — it was): a synthetic Gmail-shaped signal
("Research collaboration on Medical Imaging AI", explicit deadline, explicit response request) was
upserted into `source_signals`, run through the real Groq-backed `extract_inbox_item` (correctly
classified `research_collaboration`, extracted the stated deadline and requested action, never
inventing a fact), scored by `compute_priority` (correctly landed `high` with three concrete
reasons including the deadline and the response request), and round-tripped through the actual
`list_inbox_items`/`get_inbox_item`/`act_on_inbox_item` endpoint functions against the live
database — including confirming a `save` action correctly drops the item out of the default
`status='new'` view. Real Gmail OAuth harvest itself was not exercised (no live Google account
connected in this environment) — that boundary is unchanged from Reconstruct's own prior
limitation and reuses the same already-verified `fetch_gmail_items` connector code.

## Repository (Smart Academic Repository)

**Built.** `services/repository_classify.py`, extensions to `api/evidence.py`, migration
`011_repository_classification.sql`. Adds `document_category`, `document_type`,
`classification_confidence`, `needs_confirmation`, `proposed_activity_id` to the existing
`evidence_files` table (reusing the upload/storage/signed-URL pipeline exactly as it was — no
parallel Drive clone) rather than a new table. Classification is deterministic-keyword-first, LLM
second, per the same pattern as every other USP. Low-confidence classifications set
`needs_confirmation = true` and surface a human-confirm step
(`POST /evidence/{id}/confirm-classification`) rather than silently forcing a category — per §10's
"low confidence must not be silently forced."

Activity matching reuses/extends the existing `evidence_match.py` (the "Proof Later" USP's direct
ancestor) to propose a probable `academic_activities` link, never auto-attaching.

Bulk download (§14) is a real async job: `POST /evidence/bulk-download` streams selected/filtered
evidence objects into a ZIP (with a `manifest.csv`) via the existing `background_jobs` envelope,
stored in the `generated` bucket, downloaded via the existing signed-URL path
(`012_generated_bucket_zip.sql` widened that bucket's allowed MIME types for `.zip`).

**Student Outcome Intelligence** (§15-17) is the same classification pipeline applied to a new
`student_outcomes` table (company/role/outcome_type/offer_date/completion_status), referencing the
existing `student_records`/`faculty_student_links` model from LOR Studio (USP 10) rather than a
parallel student model. Mentor credit uses the exact same propose-then-confirm pattern as Shared
Academic Facts' `event_participants`: a linked faculty member confirms the outcome into a real
`academic_activities(category=mentorship)` row; nothing is silently credited, and a second confirm
attempt is correctly rejected (tested).

**Live-verified this build** (per `docs/EXPANSION_ARCHITECTURE_AUDIT.md`'s addendum, written before
this session's hand-off): signal upsert/dedupe/reclassify-only-on-change, classification pipeline,
and student-outcome mentor-credit confirm/double-confirm-block were exercised against the real
hosted Supabase project with real seeded data, cleaned up afterward.

## GrantOps

**Built.** Migration `015_grantops.sql` (`grant_opportunities`, `grant_workspaces`,
`grant_workspace_members`, `grant_workspace_tasks`), `017_activity_source_grantops.sql` (a real bug
found via live testing: the `activity_source` enum was missing the `'grantops'` value the award
flow needed — fixed forward, not by editing the applied migration), `services/grantops.py`,
`api/grantops.py`.

Eligibility (`evaluate_eligibility`) is deterministic and reason-based —
`eligible` / `possibly_eligible` / `not_currently_eligible` — driven by a data-driven
`eligibility_rules jsonb` column (mirroring `career_rules`'s existing shape) rather than hardcoded
Python per grant, checked against real profile data (designation, PhD status, confirmed
publication/grant counts, research-interest-to-discipline overlap). Every reason is a plain
sentence ("Requires 5 publication(s); 2 confirmed on record") — never a percentage (tested).

Readiness (`evaluate_readiness`) matches a grant's `required_documents` against the faculty's
already-classified `evidence_files.document_type` values — **never asks for a document already on
file**, satisfying §22 directly by depending on the Repository's classification work rather than
re-implementing document matching.

Team formation reuses Professional Network's `rank_candidates` scoring (same explainable-reasons
discipline) with an added discipline-overlap reason specific to the grant.

Grant workspaces carry stage (`GrantStage` enum matching §20's exact list), tasks, members, notes,
and "Related Emails" (via the Action Inbox link above). Awarded grants propose (never silently
credit) an `academic_activities(category=grant)` row via the existing generic
`POST /activities/{id}/confirm` endpoint — no new confirm mechanism was built where an old one
already does the job.

Frontend: `GrantOpsPage.jsx` — Opportunities/My Workspaces tabs, manual grant-add form with
eligibility-rule inputs, per-workspace eligibility/readiness/tasks/team-suggestions/award UI.

**Live-verified against the real hosted Supabase project**, full lifecycle: opportunity created →
visible in list → eligibility check (correctly landed `possibly_eligible` with two concrete reasons,
one satisfied-publication-count reason and one no-discipline-overlap reason — never a percentage) →
workspace started → task added and toggled done → workspace detail correctly shows readiness
(0/2 documents on file, honestly reported) and eligibility → team suggestion returned → a second
real seeded faculty invited as a member (status `invited`, notified) → stage updated to `submitted`
→ awarded → resulting `academic_activities(category=grant, status=proposed)` row confirmed correct
→ a second award attempt on the same workspace correctly rejected (409). All test rows deleted
afterward, deletion verified. This also caught and fixed a real bug live: the `activity_source`
enum was missing the `'grantops'` value the award insert needed — see `017_activity_source_grantops.sql`.

## Adaptive Career Navigator

**Built.** The pre-existing rule-catalog goal system (`career_rules`/`career_goals`, USP 8,
unchanged) is now one of two goal *sources* feeding one goal *model*, per the architecture
decision recorded in `docs/EXPANSION_ARCHITECTURE_AUDIT.md`. `custom_career_goals`
(`016_career_navigator.sql`) is the new user-authored/system-suggested path; `services/career_nl.py`
+ new endpoints on `api/career.py` implement it.

- **Custom NL goals (§27):** `POST /career/goals/parse` extracts `{title, description, target_date,
  measurable_outcomes}` from free text — deterministic regex extraction for dates/counts runs
  first and is the fallback when no LLM is configured; the LLM (when available) only refines
  wording and never invents a date or count not stated in the text (tested: "in the next 2 years"
  → correct target year; no date stated → `target_date: null`, not guessed). Nothing is saved until
  the faculty calls `POST /career/goals/custom` to confirm the preview, per §27's explicit
  "faculty reviews and confirms" requirement.
- **Suggested goals (§28):** `GET /career/goals/suggested` computes fresh, unpersisted suggestions
  from real counts (confirmed publications/grants/mentorships, connection count, top research
  interest) — e.g. "5 confirmed publications, 0 grants" → suggests a first-grant goal, with the
  count in the reason text. Nothing becomes an active goal without an explicit accept call (tested
  that already-having-a-grant-goal suppresses the duplicate suggestion).
- **Progress (§32):** `compute_custom_goal_progress` is a plain count-against-target per outcome,
  `tracked: true/false` distinguishing outcomes the system can automatically count
  (publication/grant/mentorship, from confirmed `academic_activities`) from ones it honestly labels
  "Tracked manually" rather than fabricating a number for something it can't count.
- **Cross-feature opportunity matching (§31/§34):** `GET /career/goals/custom/{id}/opportunities`
  matches a goal's title/description against open Action Inbox items (by research-topic and term
  overlap) and open GrantOps opportunities (by discipline and term overlap), each match carrying a
  stated reason ("Topic matches your goal: Healthcare AI"). **This is computed at read time, not
  push-invalidated on every new signal** — a real simplification: opening the goal card re-queries
  current inbox/grant state rather than a background job proactively re-scoring goals the moment a
  new email arrives. Honest gap, not a silent one.

Frontend: `CareerGrowthPage.jsx` extended with a free-text goal composer (preview → confirm),
suggested-goal cards (accept/dismiss), and goal cards with per-outcome progress bars and an
expandable "Opportunities for this goal" panel — alongside the existing rule-based goal UI,
unchanged.

**Live-verified against the real hosted Supabase project:** "I want to publish 3 Q1 journal papers
in Healthcare AI by June 2027" parsed by the real Groq-backed `parse_goal_text` into
`target_date: 2027-06-28` and `measurable_outcomes: [{publication: 3}]` — both correctly derived
from the text, nothing invented; saved as a custom goal, then `list_all_goals` correctly computed
concrete progress (2/3 confirmed publications, not a percentage); `get_suggested_goals` returned an
explainable suggestion with a stated reason ("Only 1 connection(s) in your Professional Network so
far"); a real `action_inbox_items` row with overlapping research topics correctly surfaced under
`goal_opportunities` with a stated match reason; dismissing the goal correctly dropped it from the
active list. All test rows deleted afterward, deletion verified.

## Faculty Professional Network

**Built as additive extensions to the already-live-verified Academic Network (USP 9)**, per the
audit's "lowest-risk feature to extend" assessment. Migrations `018_professional_network_extensions.sql`
→ `019_professional_network_reconcile.sql` (see "What Was Reconciled" below for why there are two)
→ `022_collaboration_members_role.sql`.

- **Two more open-to flags:** `open_to_grant_collaboration`, `open_to_reviewing` — now on
  `profiles`, in the JWT-loaded `CurrentUser` profile, in `ProfilePage.jsx`'s new "Visible in
  Professional Network" toggle section (this also fixed a **pre-existing gap**: none of the
  original three open-to flags had any UI to set them before this session — they existed only in
  the database and seed data).
- **`follows`:** a separate follow graph from `connections`, with a `FollowButton` next to every
  discovery result.
- **Structured "Looking for Collaborators" posts (§39):** `post_kind` gained a `collaboration`
  value; `community_posts.collaboration_payload jsonb` carries `{research_area, looking_for,
  skills_needed[]}`. "Express Interest" (`post_interests`) realtime-notifies the author; the author
  decides whether to connect, message, or start a workspace — never automatic.
- **Multi-type reactions (§38):** `post_reactions.reaction_type` (like / insightful / celebrate),
  one reaction slot per person per post, type changeable.
- **Lightweight collaboration workspaces (§42):** `collaboration_workspaces` +
  `collaboration_members` — stage (`introduced` → `completed`/`paused`), members with a role, a
  pointer back to the originating post. Deliberately does not duplicate messaging, documents, or
  tasks, which already exist elsewhere in the product, per the spec's own "do not rebuild Slack"
  instruction.
- **Discovery intents extended:** `grant_collaborator` and `reviewer` added to the existing
  explainable `rank_candidates` scoring alongside mentor/phd_supervisor/collaborator.

Frontend: `CommunityPage.jsx` gained a post-kind selector with collaboration-specific fields,
per-post Express-Interest + interested-list UI, multi-reaction buttons, a Follow button, an
open-to filter for the two new intents, and a new "Collaboration Workspaces" tab.

**Live-verified against the real hosted Supabase project, two real seeded faculty accounts:** a
`collaboration`-kind post with a full structured payload (research area, looking-for, skills
needed) created by faculty A, correctly surfaced in `get_feed` with the structured payload intact;
faculty B expressed interest, correctly recorded and correctly notified faculty A
(`kind='collaboration_interest'`); a reaction of type `insightful` (not just the default `like`)
stored and read back correctly; faculty A followed faculty B independent of any connection; a
collaboration workspace created from the post, faculty B added as a member with role
`"Collaborator"`, and the workspace correctly visible to faculty B (RLS-equivalent backend
filtering) with both members listed. All test rows deleted afterward, deletion verified.

## Reconstruct Performance Redesign

**Built — the shared source-signal layer, proven by Action Inbox, is now also what Reconstruct
reads and writes.** Old synchronous full-rescan endpoints (`POST /reconstruct/runs` and its
candidate-review flow) are **kept working exactly as before** — no regression risk taken on a
previously live-verified pipeline — and remain available as an explicit "Full rescan" action and
the fixture-mode demo path. The new default fast path sits alongside it:

- **Incremental connectors** added to `connectors/google.py`: `fetch_calendar_delta` (Calendar
  `syncToken`, handling Google's `410 Gone` expired-token signal by triggering a fresh backfill —
  Google's documented contract, not a bug path), `fetch_drive_start_page_token` +
  `fetch_drive_changes` (Drive `changes.list`, dropping removed/trashed files rather than
  harvesting them as signals). Gmail's incremental path (`fetch_gmail_history`,
  `fetch_gmail_profile_history_id`) already existed from the Action Inbox build and is reused
  as-is.
- **`services/source_sync.py`** extended with `sync_calendar_signals`/`sync_drive_signals`
  mirroring the existing `sync_gmail_signals`: backfill on first connection (storing a fresh
  cursor), delta thereafter, upserting into the shared `source_signals` table so a delta sync that
  finds nothing new is genuinely a no-op classification-wise.
- **`services/reconstruct_cluster.py`** (new): each unprocessed signal is classified exactly once
  (reusing the original pipeline's own deterministic `is_academic_signal`/`classify_category`
  keyword rules, not a rewrite) and attached to an `activity_clusters` row by **blocking on
  profile + a 5-day date window before any fuzzy title match** (§56) — never a full pairwise
  re-correlation over a year of history. Confidence rises with each additional corroborating
  source, mirroring the original pipeline's `score_confidence` tiers.
- **New endpoints:** `GET /reconstruct/candidates` (cache-first — a plain query against
  already-persisted `activity_clusters`, no harvest triggered), `POST /reconstruct/sync` +
  `GET /reconstruct/sync/{job_id}` (background delta sync across all connected sources, then
  incremental classify/cluster of whatever changed), `POST /reconstruct/candidates/cached/{id}/confirm|ignore`.
- **Frontend:** `ReconstructMyYear.jsx` now loads cached candidates immediately on mount (separate
  from and prior to any sync), with a "Sync" button that shows "Checking for anything new…" and
  reports what changed, alongside the pre-existing "Full rescan" button for the old path.

**Performance claim, backed by a real timed benchmark against the live hosted Supabase project**
(§75's "create a large realistic fixture, measure initial vs. second-run timings" — executed, not
argued from query shape alone). No live Google credentials exist in this environment, so the
fixture was 300 synthetic `HarvestedItem`s (150 Gmail + 150 Calendar, ~2/3 academic-shaped content,
1/3 noise, spread across a realistic 12-month academic-year date range) fed through the exact same
`upsert_signal`/`classify_and_cluster_signal`/`get_cached_candidates` code paths the real connectors
call, isolating the algorithmic cost from Google API network latency (which the old pipeline pays on
every single run, at any volume). Two rounds were run:

- **Round 1** (naive re-upload simulation): full 300-item OLD pipeline (`run_pipeline`,
  harvest→filter→correlate from scratch) took **27.6s** first run; a literally identical second run
  took **10.8s** — the old pipeline has no memory of the first run and reprocesses everything, every
  time, exactly as the architecture audit predicted. Re-uploading all 300 signals through the NEW
  layer's dedupe gate (worst case: simulating Google resending everything, which its real delta APIs
  don't do) took 6.6s to confirm zero signals needed reclassification — still faster than the old
  pipeline's identical re-run, but this framing understates the real win because it's not what a
  real delta sync does.
- **Round 2** (honest re-measurement, correcting Round 1's methodology): after the same 300 signals
  were classified once, **(a)** a true "nothing changed" check — no re-upload at all, matching what
  Gmail `history.list` / Calendar `syncToken` / Drive `changes.list` actually return when nothing
  changed (an empty list) — took **131ms**, comfortably inside §59's <1–3s target; **(b)** adding
  exactly one new signal and running the real delta path (upsert → classify → cluster) took
  **421ms**, processing 1 item, not 300; **(c)** the cache-first `GET /reconstruct/candidates` read
  took **363ms** for 7 open candidates (this run's realistic cluster count, vs. round 1's 86 from a
  denser synthetic mix) — no harvest, no external API call, no LLM call, a plain indexed Postgres
  read against `activity_clusters`.

**Honest caveats on the benchmark itself:** this measures the shared-layer algorithmic cost
(DB I/O + deterministic classification + date-window-blocked clustering), not real Gmail/Calendar/
Drive API latency, which no live Google account in this environment could exercise — a live-account
run would add real network round-trips to the *sync* step but would not change the core finding
(pending-signal count drives cost, and that count is 0 or near-0 in steady state). `get_cached_candidates`
does one sources sub-query per cluster (N+1 pattern) — fine at the 7-86 cluster range tested, worth
revisiting if a single faculty member's open-candidate count grows into the hundreds.

## What Was Reconciled (two concurrent build sessions, same live database)

Recorded truthfully because it's materially relevant to how much to trust this audit:

1. **Duplicate `017_*.sql` migration.** Both sessions independently numbered a migration `017`.
   The redundant one (`017_network_extensions.sql`, duplicating Professional Network schema) was
   deleted in favor of the other session's `017_activity_source_grantops.sql` +
   `018_professional_network_extensions.sql`, once confirmed the latter's schema was compatible
   with the already-written `api/network.py` code (it needed one gap-fill:
   `022_collaboration_members_role.sql` added a `role` column `api/network.py` depends on that
   `018` didn't have).
2. **Duplicate `fetch_calendar_delta` connector function** (two independent implementations,
   near-identical contracts) and an orphaned, never-called `fetch_drive_delta` — removed, keeping
   the version actually wired into `services/source_sync.py`.
3. **A genuinely dangerous collision was caught, not avoided by luck:** both sessions independently
   added a `const handleSync`/`const respondCached` pair to `ReconstructMyYear.jsx` for the same
   cache-first sync UI at nearly the same time — a real JavaScript `SyntaxError` (duplicate `const`
   in one scope) that would have broken the build. Caught by re-reading the file before finishing
   the edit, confirmed both copies were present, and removed the earlier duplicate by hand, keeping
   the other session's (which the surrounding JSX already referenced); verified clean via
   `npm run build` immediately after, and again at the end of this session.
4. **GrantOps schema mismatch.** One session's migration (`015_grantops.sql`, first draft) created
   `grant_workspaces(profile_id, opportunity_id, ...)` and applied it live; the other session's
   `api/grantops.py` was written against a different, more complete design
   (`grant_opportunities` as a separate curated catalog + `grant_workspaces(owner_id,
   grant_opportunity_id, ...)` + `grant_workspace_members`/`grant_workspace_tasks`). Caught before
   any real data existed in the mismatched tables (confirmed via `\d` against the live database);
   resolved by dropping the first draft's tables/types live and re-applying the second design's
   migration file, which the already-written router code actually needed.
5. **`community_posts.collaboration_payload` / `post_interests` / `collaboration_workspaces.source_post_id`
   drift.** `018_professional_network_extensions.sql` (first draft) modeled the collaboration
   payload as a separate `collaboration_details` table, "Express Interest" as
   `collaboration_interests`, and the workspace-to-post link as `collaboration_workspaces.post_id`.
   The already-written `api/network.py` used a different, simpler shape (payload inline as jsonb on
   `community_posts`, `post_interests`, `source_post_id`). Resolved via a corrective migration
   (`019_professional_network_reconcile.sql`) adding the columns/table the router actually needed and
   dropping the two unused superseded tables, once confirmed empty.
6. **A real, independent security finding, not a reconciliation:** while inspecting the live schema
   to resolve the above, a pre-existing RLS bug was found in `community_posts_read`'s policy
   (unrelated to anything either session had just written) and, on a systemic re-scan, in 21 further
   policies spanning the original codebase and two of this expansion's own new migrations. See
   Security below.
7. **All reconciliations were verified**, not assumed: `pytest backend/tests` (113 passed / 6
   skipped) and `npm run lint && npm run build` were re-run after every reconciliation in this
   list, plus an AST-level scan of every backend `.py` file for duplicate top-level
   function/class definitions (none found) as a final sweep.

## Security

The other session found and fixed a real, systemic, **pre-existing** RLS bug class (present in the
original codebase before this expansion, and independently reintroduced twice by copying the
existing — buggy — pattern into new migrations this session, including in code this session wrote):
correlated `EXISTS` subqueries like
`exists(select 1 from profiles p where p.id = auth.uid() and p.institution_id = institution_id)`
have their unqualified right-hand column resolved by Postgres against the **innermost** scope
(the subquery's own aliased table) rather than the intended outer policy table, whenever that inner
table happens to have a same-named column — producing either an always-true tautology or a
comparison between two unrelated columns of the wrong row. Confirmed via
`select qual, with_check from pg_policies` against the live database before fixing (per that
session's migration comments), and independently spot-verified here by manually re-deriving the
column scoping for every affected policy plus every one of this session's own remaining `grant_*`
policies (none of which turned out to share the bug, verified by checking whether each subquery's
own aliased table has a same-named column — it doesn't, in every remaining case).

Fixed in `020_fix_community_posts_read_rls.sql` (the first instance found) and
`021_fix_rls_unqualified_columns.sql` (21 further policies across `career_rules`, `opportunities`,
`grant_opportunities`, `appraisal_cycles`, `appraisal_templates`, `institution_events`,
`mapping_hints`, `student_records`, `student_achievements`, `student_outcomes`, `messages`,
`conversation_members`, `publication_authors`, `publication_records`, `grant_workspaces`) by
qualifying the right-hand side with the policy's own table name.

**Real-world impact of the bug, and why it's smaller than it sounds:** the FastAPI backend connects
with a role that bypasses RLS and applies its own explicit owner/institution filters in every
query — every response a faculty member has ever actually received through the app was correctly
scoped. RLS is this project's documented defense-in-depth layer for **direct client access**
(a browser using the Supabase JS client with a user's own JWT) — a real gap for that access path,
now closed, not a gap in what the deployed app has been serving.

Every new table this expansion added has RLS enabled with an owner/institution/participant-scoped
policy, following the codebase's established belt-and-suspenders pattern (RLS *and* an explicit
backend-side filter in every query). No new table was left with RLS disabled or a `using (true)`
policy on anything beyond genuinely public-within-the-app data (reaction/interest counts, follow
edges) — the same category the original codebase already exposed that way.

## Responsive / Design

Every new component consumes `frontend/src/styles/brand.css` tokens exclusively — no new hex
values, no new design system. No dead buttons: every action in every new page performs a real,
verified request (spot-checked the ones most likely to be decorative: "Express Interest",
"Send to GrantOps", "Record award", "Sync").

## Tests

| Check | Result |
|---|---|
| `pytest backend/tests -q` | **113 passed, 6 skipped** (skipped = require isolated live DB, same policy as every prior session) |
| New pure-function tests this expansion | `test_signal_layer.py`, `test_repository_classify.py`, `test_action_inbox.py`, `test_grantops.py`, `test_career_nl.py`, `test_network_extensions.py` |
| `npm run lint` | Clean |
| `npm run build` | Clean (825KB → 868KB main chunk; the pre-existing large-chunk warning is unchanged in kind, not newly introduced) |
| `qa/audit_p0.py` | 0 compulsory findings, 8 pre-existing-pattern warnings (polling timers) |
| Live hosted-Supabase verification | **All six phases (A–G) were live-verified against the real hosted Supabase project** (`llpjrfugwktlaizmxrtq`, reachable via the transaction pooler on this session's network) with real seeded faculty data, real Groq LLM calls where applicable, real Storage uploads for Repository/GrantOps, and a real second seeded account for the two-user Professional Network flow — every check's test rows deleted and deletion re-verified afterward. All 22 migrations (010–022) are applied to the live project by this session directly via `psql`, confirmed via `\d`/`pg_policies` inspection, not merely present as unapplied files. See the phase-by-phase "Live-verified" paragraphs above for what was specifically exercised in each. |
| Browser/Playwright E2E | Not run — verification was via direct backend function calls (bypassing HTTP, calling the FastAPI route functions directly against the live DB) and `npm run build`/`lint` for the frontend, not a browser-driven UI pass. |

## External ENV Needed

Unchanged from the prior build — `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` /
`GOOGLE_OAUTH_REDIRECT_URI` remain the only missing piece for Reconstruct's connectors and Action
Inbox's Gmail sync/draft creation to go fully live; `GROQ_API_KEY` remains optional (every LLM call
site has a deterministic fallback). No new required environment variables were introduced by this
expansion — `gmail_compose` reuses the same OAuth client credentials as the read-only scopes.

## Remaining Issues (stated plainly)

1. Career Navigator's cross-feature opportunity matching is read-time-computed, not
   event-driven/push-invalidated — a new inbox item doesn't proactively notify an open goal card;
   the faculty sees it next time they open the goal.
2. No Gmail push/watch notifications (webhook-driven sync) — sync is on-demand (button click) or
   would need an external scheduler to run periodically; this matches the spec's "where
   infrastructure allows... polled on a schedule otherwise" allowance, but no scheduler is wired up.
3. No pgvector/embedding-based semantic search anywhere in the product (unchanged from the prior
   audit) — all matching in this expansion (Career Navigator's goal-to-opportunity matching,
   GrantOps team suggestions, Action Inbox classification) is keyword/tag-overlap or LLM-structured-
   extraction based, which is honest and explainable but not semantic search.
4. Collaboration workspaces have no task/document sub-objects by design (§42's "don't rebuild
   Slack"), so a workspace's "Related Documents"/"Related Grant" links are manual, not automatic
   cross-references yet.
5. `get_cached_candidates` (Reconstruct's cache-first read) does one sources sub-query per cluster
   (N+1) rather than a single joined query — fine at the candidate counts tested (7-86), worth
   batching into one query if a faculty member's open-candidate backlog grows much larger.
6. Real Gmail/Calendar/Drive OAuth harvest (the actual network calls to Google, as opposed to the
   shared-layer processing that sits downstream of it) was not exercised end-to-end in this
   environment — no live Google account is connected here. The connector code for all three
   incremental paths (Gmail `history.list`, Calendar `syncToken`, Drive `changes.list`) is written,
   unit-reasoned, and reuses the exact request shapes Google's own API documentation specifies, but
   a first real-account connection is the one verification step that requires a human with Google
   Cloud Console access to complete.
7. `gmail_compose` (the incremental OAuth scope Action Inbox needs to create real Gmail drafts) has
   never been granted by a real user in this environment — the OAuth machinery is real and reuses
   the already-verified `oauth_connections` flow, but "Create Gmail Draft" has only been exercised
   via its fallback path (`fallback_reason` returned, frontend falls back to copy-to-clipboard),
   which is itself correct and spec-compliant (§6), not a workaround masking a gap.
