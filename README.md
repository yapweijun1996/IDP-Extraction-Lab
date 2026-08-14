# IDP Extraction Lab - Static BYOK PWA

## Purpose and scope

IDP Extraction Lab is a browser-first document extraction experiment built as a static Vite PWA for local and GitHub Pages style hosting.

- No backend server is required at runtime.
- No CFML, Node process, Python service, or `.env` is used during execution.
- The project is self-contained: provider runtime (`vendor/`), public sample PDF (`samples/`), and build pipeline definitions in source.
- Only a synthetic sample PDF is included in source for public builds.

## Current architecture (source of truth)

```text
PDF/image + extraction contract
  -> PDF.js rendering in browser
  -> dedicated browser Worker
  -> selected BYOK provider (Gemini or OpenAI)
  -> deterministic validation and contract mapping
  -> restricted inspect_region remediation loop
  -> deterministic crop + enhanced view
  -> targeted reread + evidence-gated reconciliation
  -> structured JSON output and encrypted IndexedDB persistence
```

The UI remains the source of extraction intent and builds `idp_extraction_contract_v1` from user field choices. Provider output is not trusted as-is:

- Output must pass allowlist mapping to the active contract.
- Unknown keys are dropped.
- Missing keys remain `null`.
- Invalid mappings are treated as closed-fail (no fabricated values).

## Dependency structure and runtime flow

- `src/app/` — app entry, orchestration, and user interactions.
- `src/runtime/` — browser runtime worker bridge and telemetry.
- `src/providers/` — provider client, contract validation, and page normalization.
- `src/validation/` — schema compatibility and structured JSON checks.
- `src/state/` — local state persistence and encryption state.
- `src/ui/` — rendering modules, thumbnails, highlights, and icon registry.
- `src/i18n/` — localization dictionaries and locale wiring.
- `src/contracts/` — prompt and worker action contracts.

`index.html` points to `./src/app/main.js`.

## Security model (experimental)

This is an internal experiment, not a production secret-management architecture.

- Provider endpoints are fixed to official Gemini/OpenAI domains.
- BYOK keys are entered in the UI and stored encrypted in IndexedDB with AES-GCM.
- No plaintext keys are written to URL, UI config snapshots, exported traces, Service Worker cache, GitHub Actions, or source control.
- Device unlock behavior protects against casual local DB inspection only; it does not replace a full secret-management system.

IndexedDB databases used: `idp-extraction-lab-v1`

- `vault` (crypto key and metadata)
- `provider_credentials` (encrypted BYOK records)
- `documents` (encrypted docs and metadata)
- `runs` (results/config/status)
- `artifacts` (inspection/correction artifacts)

## Feature behavior summary

- UI localization: `en`, `zh-CN`, `ms`, `ja`, `vi`.
- Desktop layout: three-pane local layout controller with min widths and persisted state in `localStorage` (`idp-extraction-lab-layout-v1`).
- Thumbnails: low-resolution progressive queue with current-page priority.
- Provider settings: local modal with scroll/content separation and fixed actions.
- Highlights: only rendered for valid in-bounds bboxes; fields without provenance are shown as not localized.
- Offline behavior: shell remains usable, extraction and provider tests are disabled, and provider calls are never reported successful while offline.

## Build/runtime constraints

- File size per input: 20 MB
- Max pages: 50
- Primary render: 144 DPI
- Inspection render: 400 DPI default, 500 DPI max
- Zoom max: 4x
- Two inspections per unresolved issue
- Maximum 6 regions per decision
- Max iterations: 5
- Max model calls: 60
- Run timeout: 10 minutes

## Tooling and dependencies

From `package.json`:

- Runtime: `pdfjs-dist@6.2.108`
- Dev tooling: `vite@8.2.1`, `vite-plugin-pwa@1.3.0`, `playwright-core@1.62.1`, `sharp@0.35.3`, `fake-indexeddb@6.2.5`

### Scripts

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run qa:browser`
- `npm run qa:pwa-update`
- `npm run scan:dist`
- `npm run verify:standalone`
- `npm run check` (`verify:standalone && test && build && scan:dist`)

## Local development

```powershell
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm ci
npm run dev
```

Open the local Vite URL. XOR Gateway is the default provider and uses its embedded demo credential, so it does not require a user API key. Gemini and OpenAI require a locally encrypted BYOK key. Then use:

- `Test connection`
- `Run Extraction`

Both actions perform real provider calls.

## Verification status

Recommended command set:

```powershell
npm test
npm run build
npm run scan:dist
npm run verify:standalone
npm run qa:browser
npm run qa:pwa-update
npm run check
```

`verify:standalone` currently requires `.github/workflows/pages.yml` and currently expects certain workflow fields in the repository.

## PWA behavior

- Static shell + sample/runtime assets are prepared in build output.
- Provider POST requests are `NetworkOnly` and not cached by Workbox.
- Update lifecycle is user-confirmed (`registerType: "prompt"`) and never auto-reloads during active work.

## Repository hygiene

`.gitignore` tracks local and temporary artifacts:

- `node_modules/`, `dist/`, `.vite/`, `coverage/`
- logs and temporary screenshots

Refer also:

- [`docs/cleanup-plan.md`](/C:/Users/tno/Documents/GitHub/IDP-Extraction-Lab/docs/cleanup-plan.md)
- [`THIRD_PARTY_NOTICES.md`](/C:/Users/tno/Documents/GitHub/IDP-Extraction-Lab/THIRD_PARTY_NOTICES.md)

## Deployment notes

- Static output is produced to `dist/`.
- For a standalone repository, keep the runtime/config/docs files at root and use `.gitignore` for local artifacts.
- Run `npm run check` in the new repository before first push.

## Out of scope

- ERP posting/integration automation
- Golden scoring claims for production accuracy
- Customer private documents in public build
- Production-grade credential custody architecture
- CI-backed accuracy simulation

## Historical notes

- Synthetic sample canary and internal validation results are already recorded during development.
- These results are useful for regression checks only and are not a guaranteed production accuracy claim.
