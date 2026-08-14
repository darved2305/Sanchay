# Frontend design audit

The application is a Vite React SPA with shared public and authenticated shells. The backend/API, Supabase session handling, realtime invalidation, storage upload flow, appraisal flow, and admin actions are treated as functional authority and remain untouched.

| Surface | Existing issue | Refactor target | Functional boundary |
| --- | --- | --- | --- |
| Landing | Orange-heavy, generic utility-card layout | Warm canvas, editorial hero, lavender primary, restrained pastel feature rail | Navigation and login links remain live |
| Login/register | Dense white form and orange accent | Two-column calm auth composition with lavender focus and pastel benefit panel | Supabase auth, reset, registration validation unchanged |
| Faculty shell | Oversized header, 3xl sidebar, orange selection | Compact warm shell, lavender selection, consistent controls | Role routing, search, notifications, sign out unchanged |
| Faculty overview | Useful data presented as unrelated cards | One readiness hero plus calm data panels and quick actions | Dashboard API values remain dynamic |
| Activities | Legacy enterprise styling | Consistent activity cards, chips, modal controls | Activity CRUD and evidence attachment unchanged |
| Evidence | White grid and inconsistent status colors | Soft surfaces, semantic status chips, clearer hierarchy | Upload/finalize/attach/download/delete unchanged |
| Appraisal | Dense form-like presentation | Readiness-led appraisal workspace | Draft/update/submit/PDF API contracts unchanged |
| Reconstruct | Orange utility palette and hard-to-scan panels | Timeline-like review surface and canonical category colors | Proposal confirmation/edit/ignore behavior unchanged |
| Admin | Single-purpose dashboard styling | Review-oriented console with semantic statuses | Admin review/search/filter actions unchanged |
| Profile | Form is functional but visually legacy | Shared inputs, spacing, and save action | Profile read/write unchanged |

## Reusable opportunities

- Canonical brand tokens in `frontend/src/styles/brand.css`.
- Semantic utility bridge for legacy Tailwind markup during incremental page cleanup.
- Shared surface, control, and primary-action classes.
- Consistent lavender primary, mint success, butter warning, peach attention, and rose error semantics.

