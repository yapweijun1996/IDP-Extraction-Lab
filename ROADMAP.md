# ROADMAP.md

## Current state (2026-08-14)

The project is in the “refactor + documentation convergence” phase. Core code refactor work is complete; remaining work is release chain closure and documentation synchronization.

## Milestones

### Completed (M1)

- Layered source layout completed: `src/app`, `src/runtime`, `src/providers`, `src/validation`, `src/state`, `src/ui`, `src/i18n`, `src/contracts`.
- Entry and runtime wiring updated (`index.html` -> `src/app/main.js`).
- Vite asset mapping updated for contracts, validation, providers, i18n, and runtime resources.
- Tests updated to new import paths.
- `.gitignore` added; temporary-file cleanup plan documented.
- `README.md` rewritten and synced.

### In Progress (M2)

- Documentation convergence across design/spec/epic/roadmap/task.
- Standalone deployment verification dependency alignment (especially `verify:standalone` prerequisites).

### Pending (M3)

- Add/restore missing `.github/workflows/pages.yml` and keep verification constraints aligned.
- Clear temporary candidates in `docs/cleanup-plan.md` after explicit dependency checks.
- Re-evaluate module boundary decisions (`i18n.mjs` vs `localization.js`, `validation-core.js` vs `validator.mjs`).

## Near-term tasks (P0)

1. Bring standalone verification to a consistent pass by updating workflow dependency expectations or adding the missing workflow file.
2. Finalize `TASK.md` ownership, priorities, and expected completion windows.
3. Run and record a full verification pass (`npm run check`, `npm run qa:browser`, `npm run qa:pwa-update`) as a release audit snapshot.

## Mid-term tasks (P1)

1. Confirm and execute cleanup for high-probability temporary files (`tmp-desktop.png`, `tmp-mobile.png`, `vite-*.log`) through the documented gate.
2. Add cleanup decision notes into `docs/cleanup-plan.md` for each candidate.
3. Keep documentation and implementation in a single-source state.

## Long-term tasks (P2)

1. Decide whether localization and validation modules should be merged or stay separated.
2. Add a durable reproducibility log format for canary and QA outputs.

## Milestone completion criteria

- Refactor: no stale imports, passing compile/test paths.
- Release reproducibility: `verify:standalone`, `build`, `scan:dist`, `qa:browser`, `qa:pwa-update` pass as defined by local policy.
- Documentation consistency: all planning docs (including this roadmap) use synchronized status and scope language.
