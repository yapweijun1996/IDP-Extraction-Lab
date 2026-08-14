# SPEC.md

## Document version
- Version: v1.1 (aligned with current branch state)
- Last updated: 2026-08-14
- Source of truth: codebase (`package.json`, `vite.config.mjs`, `src/*`, `scripts/*`, `tests/*`)

## 1. Scope and boundaries

### 1.1 Scope
- Single-page static PWA.
- Browser-local BYOK extraction workflow.
- No ERPs, no DB writes, no server jobs, no automated HITL.

### 1.2 Deployment model
- Static deployment artifact is `dist/`.
- Primary target: GitHub Pages or equivalent static host.
- Runtime does not depend on backend services.

## 2. Functional requirements

### FR-001 Local extraction workflow
- Support selecting/uploading a document and starting extraction.
- Drive extraction through explicit runtime contracts.
- Output structured document fields and line items.
- Expose progress, errors, issues, and trace.

### FR-002 Evidence and traceability
- Capture evidence metadata for mapped field and row values where applicable.
- Missing evidence returns `null`/`needs_review` and does not fabricate values or highlights.

### FR-003 Visibility and interaction
- Locale support for `en`, `zh-CN`, `ms`, `ja`, `vi`.
- Desktop three-pane workspace controls and mobile tabbed views.
- Field editing supports add/remove/reorder/customize operations.

### FR-004 Provider integration
- Support Gemini and OpenAI provider selection.
- Support provider test and delete flows.
- Store BYOK keys encrypted locally; never persist plaintext keys in application state.

### FR-005 Offline and update behavior
- PWA caches shell and required runtime assets.
- Provider calls are network-only and never treated as cached responses.
- Update flow is explicit-confirmation based; reload occurs only after controlled handoff.

### FR-006 Run history and persistence
- Persist runs, documents, provider credentials metadata, and artifacts in local DB.
- Export of JSON run output is available.

## 3. Non-functional requirements

### NFR-001 Build and reproducibility
- `npm run build` must produce deployable `dist/`.
- `scan:dist` and `verify:standalone` validate static artifacts and repository portability.

### NFR-002 Quality and automation
- `npm test` covers runtime, validation, state, and UI modules.
- `qa:browser` and `qa:pwa-update` provide interactive and PWA update behavior checks.

### NFR-003 Security
- Provider endpoints are limited to official provider domains.
- Temporary build artifacts and local runtime files are excluded by `.gitignore`.
- Test keys are not written into source, trace exports, or deployment artifacts.

### NFR-004 Compatibility
- Primary compatibility target: modern Chromium-compatible browsers used by Playwright and local development.
- Build target: `es2022`.

## 4. Dependencies

### Runtime
- `pdfjs-dist@6.2.108`

### Development
- `vite@8.2.1`
- `vite-plugin-pwa@1.3.0`
- `playwright-core@1.62.1`
- `sharp@0.35.3`
- `fake-indexeddb@6.2.5`

## 5. Constraints and assumptions

- No backend server participates in extraction logic.
- No new UI framework migration is included in this change.
- No API abstraction refactor beyond structure and file moves.
- `.github/workflows/pages.yml` is currently absent in this repository, so `verify:standalone` remains partially blocked unless workflow is added or the script is updated.

## 6. Current implementation status

- Completed: source-layer reorganization, import and test path updates, build script alignment, README refactor.
- In progress: full deployment chain alignment for standalone verification.
- Pending: cleanup candidate confirmation and deletion under `docs/cleanup-plan.md`.
