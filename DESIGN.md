# DESIGN.md

## Design goals

IDP Extraction Lab is a static, browser-first PWA with an offline-first workflow. The main goal is to reduce maintenance friction while preserving existing extraction behavior.

- Run document extraction locally in the browser.
- Provide BYOK (Bring Your Own Key) provider calls.
- Keep the codebase behavior-compatible during refactoring.
- Keep the project reproducible through local-only scripts and deterministic builds.

## High-level architecture

```text
index.html + idp-lab.css + src/app/main.js
  -> application orchestration (fields, document, result, layout, locale, providers)

PDF documents
  -> PDF rendering + thumbnails (src/ui/*)

Extraction contract + prompts (src/contracts/*)
  -> runtime-worker (src/runtime/runtime-worker.js)

Provider adapters (src/providers/*)
  -> Gemini / OpenAI

Validation and structured mapping (src/validation/*)
  -> verified result + evidence

State and persistence (src/state/*)
  -> IndexedDB (vault / runs / documents / traces / provider credentials)

PWA service worker + offline support (vite-plugin-pwa + src/runtime/telemetry.mjs)
  -> shell caching + explicit update + network-only provider POST
```

## Source-layer layout

- `src/app/`
  - Application entry and orchestration.
  - Contains: `main.js`
- `src/runtime/`
  - Worker bridge, runtime worker, and telemetry.
  - Contains: `runtime-client.mjs`, `runtime-worker.js`, `telemetry.mjs`
- `src/providers/`
  - Provider configuration, request/response integration, and normalization.
  - Contains: `contract.mjs`, `provider-client.js`, `provider-page-normalizer.js`
- `src/validation/`
  - Structured response checks and mapping.
  - Contains: `validation-core.js`, `validator.mjs`, `structured-json.js`
- `src/state/`
  - Local state and secure persistence.
  - Contains: `layout-state.mjs`, `vault.mjs`
- `src/ui/`
  - Rendering, icons, thumbnail queue, and highlight components.
  - Contains: `pdf-renderer.mjs`, `thumbnail-queue.mjs`, `highlight-bbox.mjs`, `icons.mjs`, `g3tooltip.js`
- `src/i18n/`
  - UI localization and locale helpers.
  - Contains: `i18n.mjs`, `localization.js`
- `src/contracts/`
  - Prompt and inspection-action contracts.
  - Contains: `extraction-prompt.js`, `inspection-action-config.js`

## Responsibility boundaries

- `src/app/main.js`
  - UI model definition, document loading, extraction start, result rendering, and error display.
  - Delegates protocol-specific logic to runtime/provider/validation modules.

- `src/runtime/`
  - `runtime-client.mjs`: worker lifecycle and messaging.
  - `runtime-worker.js`: extraction orchestration.
  - `telemetry.mjs`: trace and privacy-safe telemetry.

- `src/providers/`
  - Owns provider request contracts and normalization.
  - Validation must pass allowlisted mapping before values enter the result model.

- `src/validation/`
  - Owns structured schema compatibility, field mapping, and mapping failures.
  - Failures resolve to `null`/`needs_review` instead of synthetic inference.

- `src/state/`
  - Owns layout persistence, vault crypto key handling, and run/document artifacts.
  - Explicitly avoids storing plaintext keys in local state.

## Data flow and failure behavior

- Success path
  1. User defines fields and extraction contract.
  2. Runtime worker builds prompt context and invokes provider.
  3. Provider response is validated and mapped.
  4. Evidence-aware result object is produced.
  5. UI renders results and persists run data locally.

- Failure path
  - Mapping/validation failures are treated as closed-fail.
  - Missing or conflicting evidence never generates fake highlights.
  - Issues and traces are exposed in the issues drawer and trace panel.

## Security and boundary design

- BYOK is local by design and does not introduce backend secret management.
- Provider endpoints are fixed to official Gemini/OpenAI domains.
- Provider POST requests are `NetworkOnly`, not stored in the runtime cache.
- PWA updates use `registerType: "prompt"`; user confirmation is required before activation.
- `.github/workflows/pages.yml` is still required by verification and currently missing in this repository, so it is a deploy chain blocker.

## Architectural decisions

- Keep mixed `.js` / `.mjs` extension pattern to avoid large import churn.
- Keep a directory-based layered layout rather than adding import aliases.
- Keep worker and runtime asset output names stable to maintain existing runtime path expectations.
