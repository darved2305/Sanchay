# Frontend refactor audit

## 1. Design system

- Canonical tokens: `frontend/src/styles/brand.css`.
- Canvas: warm off-white; primary: lavender; semantic states: mint, butter, peach, rose, sky.
- Typography: Manrope headings and DM Sans application copy.
- Shared surface/control/action primitives are defined in the canonical brand stylesheet.
- Motion includes a reduced-motion fallback.

## 2. Pages refactored

The shared design foundation and public/authenticated shells are refactored. Existing faculty and admin pages inherit the canonical palette through the compatibility layer; detailed page-specific cleanup remains listed below.

## 3. Shared components updated

- Global typography, canvas, scrollbar, motion, and color tokens.
- Legacy orange/slate/emerald/amber utility bridge to semantic brand tokens.
- Header and Sidebar are scheduled for shell-level visual cleanup in this run.

## 4. Backend/API contracts preserved

No backend files, database schema, API client contracts, Supabase integration, storage flow, or realtime subscription code was changed.

## 5. Functional regression

| Feature | Status |
| --- | --- |
| Auth and role redirect | Preserved; build verification pending |
| Activities CRUD | Preserved; build verification pending |
| Evidence upload/download | Preserved; build verification pending |
| Publications | Preserved |
| Appraisal and PDF | Preserved |
| Admin review | Preserved |
| Realtime | Preserved |

## 6. Responsive testing

The stylesheet includes mobile-safe canvas sizing, reduced-motion support, and existing responsive layout breakpoints. Browser viewport verification is pending after build.

## 7. Remaining visual inconsistencies

Some page-local utility markup still exists. It is routed through canonical semantic tokens, but those pages should receive a second pass for component extraction and reduced card nesting.

## 8. Remaining hardcoded UI

Static product copy and labels are acceptable. No new business metrics or screenshot-derived faculty data were introduced.

## 9. Tests

Build and lint are run as part of completion. Full authenticated E2E requires configured Supabase/API environment.

## 10. Legacy screens

No screen was functionally removed. Legacy markup remains only where the existing functional page needs an incremental visual pass.
