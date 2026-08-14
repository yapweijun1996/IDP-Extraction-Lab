# EPIC.md

## EPIC-01: Source structure refactor

**Status:** Completed

Objective: Split the previous flat `src/` layout into domain layers and reduce coupling for easier maintenance.

Completed:
- Introduced `src/app`, `src/runtime`, `src/providers`, `src/validation`, `src/state`, `src/ui`, `src/i18n`, `src/contracts`.
- Moved entrypoint to `src/app/main.js`.
- Updated imports and runtime references.

Acceptance:
- Build runs successfully.
- No intentional behavior changes.
- Directory ownership and responsibilities are clear by domain.

## EPIC-02: Runtime and extraction integrity

**Status:** In progress

Objective: Keep extraction chain stable after refactor, including fail-closed mapping and evidence rules.

Completed:
- Preserved runtime, provider, and validation layering.
- Kept evidence-based behavior for highlights and mapping failures.
- Preserved localization/layout/thumbnail/render capabilities.

In progress:
- Documentation harmonization with current runtime behavior.

Acceptance:
- `npm run check` remains reproducible under supported BYOK runs.
- Core fail-closed behaviors (`mapping fail`, `inspect stop`, `needs_review`) remain unchanged.

## EPIC-03: Offline, PWA, and verification automation

**Status:** In progress

Objective: Keep offline and update behavior deterministic and verifiable.

Completed:
- PWA plugin integrated with explicit update registration.
- Provider requests configured as `NetworkOnly`.
- Browser and PWA-update QA scripts exist and are runnable.

Risk:
- `verify:standalone` requires `.github/workflows/pages.yml`; this repository currently lacks the file.

Acceptance:
- Offline/online behavior tests pass for shell usability, provider non-caching, and update lifecycle.

## EPIC-04: Repository hygiene and security boundaries

**Status:** In progress

Objective: Clarify cleanup candidates and guardrails while keeping a clean repository state.

Completed:
- Added `.gitignore` and documented cleanup candidates in `docs/cleanup-plan.md`.
- Preserved third-party notices and synthetic sample metadata.

In progress:
- Final decision process for deletions after dependency verification.

Acceptance:
- Repository status is stable in normal development workflows.
- Cleanup actions only happen after test/build/scan verification.

## EPIC-05: Documentation consistency

**Status:** In progress

Objective: Keep architecture, requirements, roadmap, and tasks aligned and readable.

Completed:
- Refined `README.md`.
- Added `DESIGN.md`, `SPEC.md`, `EPIC.md`, `ROADMAP.md`, `TASK.md`.

In progress:
- Keep all project markdown files consistently in English and synchronized with code state.

Acceptance:
- Same terminology and status appears across all planning documents.
