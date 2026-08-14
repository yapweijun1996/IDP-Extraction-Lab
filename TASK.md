# TASK.md

## Task overview

- Last updated: 2026-08-14
- Purpose: Keep structure refactor, architecture, and delivery status synchronized with source truth.

## Completed tasks

### T-001 Source refactor
- Goal: Complete directory split and path migration.
- Status: Completed
- Acceptance: `src` is fully organized by functional layer and old imports are migrated.

### T-002 Entrypoint and Vite asset alignment
- Goal: Align `index.html` and Vite asset mapping.
- Status: Completed
- Acceptance: `isolatedAssets` and `generateBundle` use layer paths while preserving runtime compatibility output names.

### T-003 Test reference migration
- Goal: Update all test references to new module paths.
- Status: Completed
- Acceptance: Runtime/provider/i18n/ui/validation/state tests reference `src/*` locations.

### T-004 .gitignore and artifact hygiene
- Goal: Ignore build and local temporary artifacts.
- Status: Completed
- Acceptance: `.gitignore` includes `node_modules`, `dist`, logs, temporary files.

### T-005 First documentation pass
- Goal: Refresh README and add cleanup documentation.
- Status: Completed
- Acceptance: README rewritten; `docs/cleanup-plan.md` created.

### T-006 Planning docs creation
- Goal: Add DESIGN/SPEC/EPIC/ROADMAP/TASK documentation.
- Status: Completed
- Acceptance: Core planning documents added and aligned.

## In-progress tasks

### T-007 Deployment chain alignment (blocker)
- Goal: Complete prerequisites for `verify:standalone`.
- Status: In progress (blocked)
- Dependency: `.github/workflows/pages.yml` missing in this repository.
- Notes: `scripts/verify-standalone.mjs` checks this file and key workflow strings.

### T-008 Documentation sync (roadmap/task)
- Goal: Keep documentation wording and status aligned across planning artifacts.
- Status: In progress
- Dependency: completion of deployment alignment and cleanup decisions.

### T-009 Pre-cleanup confirmation
- Goal: Review `docs/cleanup-plan.md` candidates before deletion.
- Status: In progress
- Dependency: confirm no debugging or external references depend on those files.

## Pending tasks

### T-010 Module boundary review
- Goal: Decide whether to merge `i18n.mjs` and `localization.js`.
- Status: Pending
- Deliverable: Boundary decision and rationale.

### T-011 Verification evidence capture
- Goal: Capture and archive current validation results (`npm test`, `npm run build`, `npm run scan:dist`, `npm run qa:*`).
- Status: Pending
- Deliverable: Timestamped verification log (non-sensitive).

### T-012 Task ownership and planning metadata
- Goal: Add owner / priority / estimate fields if required by team workflow.
- Status: Pending

## Blockers

1. Missing `.github/workflows/pages.yml` blocks strict pass for `verify:standalone`.
2. Cleanup deletions require dependency confirmation.
3. Any cleanup involving files outside `.gitignore` must be validated with test/build/scan.

## Recommended next steps

1. Address the deployment blocker by adding the workflow file or adjusting verification constraints.
2. Run a full verification sweep and record results.
3. Execute cleanup gate for confirmed temporary files.
4. Keep this task board synchronized with README and planning docs after each state change.
