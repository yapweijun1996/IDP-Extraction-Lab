# IDP Extraction Lab - Static BYOK PWA

## Purpose and scope

This repository is an isolated browser experiment for prompt-driven document extraction. It is a fully static Vite PWA intended for GitHub Pages. It does not depend on CFML, a Node server process, Python, `.env`, ERP APIs, Golden data, or backend jobs at runtime.

The repository is self-contained: the browser agrun bundle is stored in `vendor/`, the public synthetic PDF is stored in `samples/`, and the Pages workflow is stored in `.github/workflows/pages.yml`. A checkout can build without any parent-directory files.

Only the synthetic `SYN_USD_PO_TEST001.pdf` is included in the public build. The difficult Golden PDF, Golden JSON, customer documents, server runs and credentials are excluded.

## Architecture

```text
Local PDF/image + dynamic field contract
  -> PDF.js / Canvas page rendering
  -> dedicated browser Worker
  -> selected BYOK provider (Gemini or OpenAI)
  -> deterministic validation
  -> restricted agrun inspect_region decision
  -> deterministic crop + enhanced view
  -> targeted reread + evidence-gated reconciliation
  -> stable JSON + encrypted IndexedDB persistence
```

The UI remains the source of extraction intent. It creates `idp_extraction_contract_v1`; users do not write JSON Schema manually. One provider is selected for each run. There is no automatic fallback.

The primary prompt describes requested keys, labels, types and required state without embedding the contract object as copyable JSON. The response schema remains a separate Provider setting. A deterministic compatibility layer accepts either the canonical nested page envelope or a flat business-value object, but maps only keys allowlisted by the active contract. Unknown keys are discarded; missing keys remain `null`. Provider output that cannot be mapped safely is rejected. A malformed or incompatible primary response receives one bounded structured-output retry before the run fails closed.

Source localization is part of the extraction contract, not an optional UI decoration. Every line item requires one verified row bbox, and every non-null document or total field requires field provenance. Missing locations create deterministic `row_evidence_missing` or `field_evidence_missing` issues. Issues are grouped per row before agrun sees them, so several bad cells do not create duplicate row-localization requests. agrun decides first; a justified visual issue that remains after STOP receives one bounded mandatory check. Existing valid row/field bbox hints are cropped directly, while targets without coordinates receive one strict same-provider locator request.

Coordinates use Gemini-style `box_2d=[ymin,xmin,ymax,xmax]` integers from 0 to 1000 at the Provider boundary and normalized `{x,y,width,height}` internally. Reversed, out-of-range, zero-area, page-escaping and over-50%-page regions are rejected. A newly located row is committed only when two derived views consistently confirm at least two row anchors at confidence `>= 0.90`. A known row region may populate previously missing identity fields, but an existing non-null S/N or Stock Code cannot be overwritten. Failed or exhausted localization remains `Needs Review` and never produces a guessed highlight.

Before a paid extraction starts, the Worker validates the same shared `inspect_region` agrun action definition that is registered for the run. A malformed action contract therefore fails before the first Provider generation. The action is restricted to visually resolvable deterministic issues, the current page, allowlisted fields and a compact region; otherwise it must stop.

PDF thumbnails use a separate low-resolution, single-concurrency background queue. The current page is rendered immediately, requested pages are promoted, and the remaining pages progressively change from waiting/loading to ready. Document-generation and page-request guards prevent stale renders from a previous document or slower page request from replacing the current preview.

The desktop workspace has a local-only layout controller. At viewports `>= 1200px`, the two separators resize the Fields, Document and Result panes with keyboard or pointer input while enforcing 280px, 420px and 360px minimums. The Layout menu can hide or restore panes; at least one pane must remain visible. Its checkboxes control panel visibility only; they never select, clear, reorder or otherwise mutate extraction fields. Tablet and mobile keep the existing tabbed workspace and do not expose desktop resizing. Widths and visibility are stored only in `localStorage` under `idp-extraction-lab-layout-v1`; the state contains no document, result, credential or trace data. Reset Layout restores the 26/44/30 default.

Provider settings open as a centered three-layer modal: on desktop the modal is capped at 720px wide and 80vh high, with a sticky header and footer around an independently scrolling configuration area. Save, connection test and key deletion remain fixed in the footer; local encrypted data and run history remain in the scrollable content. On narrow mobile viewports the modal uses the full `100dvh` with safe-area padding. This is a presentation-only change; provider configuration, BYOK encryption, focus trapping, Escape handling and backdrop-close behavior are unchanged.

The interface is localized locally (without a translation service) in English (`en`, the fixed default), Mandarin (`zh-CN`), Malay (`ms`), Japanese (`ja`) and Vietnamese (`vi`). The selected UI locale is stored only as `idp-extraction-lab-language-v1`. Switching language updates labels, status text, accessibility names and validation messages in place; it does not change field keys, field order, extraction values, custom prompts, provider configuration, JSON, provenance or Worker/Provider prompts. Missing dictionary entries fall back to English. The language selector remains usable in the offline shell.

The closed language control displays the local globe SVG while retaining a native `<select>` for keyboard, touch and screen-reader access. Locale names remain visible when the native option list is opened. The PWA uses a user-confirmed update lifecycle: a waiting hashed bundle shows an “Update available” prompt, **Update now** activates it behind a loader, and only then does the page reload. Background checks are throttled when the page becomes visible; no silent refresh can interrupt an extraction run. Failed activation leaves a visible retry action.

The official IDP Extraction Lab brand artwork is `assets/idp-extraction-lab-logo.png`. The same source image is used for the web favicon, top-bar brand mark, Apple touch icon, and generated 192px/512px PWA icons (including maskable variants). It is a static local asset and is never sent to a Provider.

All non-brand UI controls and status indicators use the local inline SVG registry in `src/ui/icons.mjs`. The registry is allowlisted, uses a shared `24 x 24` viewBox and `currentColor`, and rejects unknown names. This keeps buttons, field movement, viewer navigation, thumbnails, loading, validation status and drawer controls consistent without adding an icon dependency. The official PNG brand artwork remains raster by design.

Document highlights are shown only for a finite, positive normalized bbox that remains entirely inside the source page. Rows without real provenance remain selectable, but the viewer shows a “not localized” message instead of a mock or stale rectangle.

## Verified synthetic canary (2026-08-14)

Using the browser's configured Gemini BYOK provider and `SYN_USD_PO_TEST001.pdf`, the verified run completed with:

- pages: `1 / 1`
- line items: `5 / 5`
- required localization targets: `10 located / 0 unlocated / 0 failed`
- unresolved deterministic issues: `0`
- bounded inspections: `0` (the primary response supplied complete verified evidence, so no unnecessary reinspection ran)
- Provider model calls: `1`
- usage: `1,443 input / 1,715 output / 4,519 total tokens` as reported by the Provider
- Provider latency: `8,101 ms`
- document financial check: `NOT_EVALUATED` because optional Subtotal and GST were absent
- line-item arithmetic check: `PASS` for all five rows

The 10 required targets are five row bboxes, four non-null document-field bboxes and the non-null Grand Total bbox. The visual date `24.07.2026` was deterministically normalized to `2026-07-24` while its raw evidence remained preserved. Browser verification confirmed that selecting row 1 highlights the printed first table row at normalized bbox `x=0.065, y=0.302, width=0.873, height=0.011`.

A separate paid fail-closed canary temporarily requested a required `Unreadable Approval Code` that is absent from the synthetic PDF. The run made five bounded calls, agrun completed both decisions without runtime errors, strict localization returned no valid region twice, and the final result remained `completed_with_review` with `required_field_missing` plus explicit `no_region_returned` / `localization_budget_exhausted` Trace events. The field remained `null`; no crop, value or bbox was fabricated. The temporary field was removed afterward. These are synthetic single-document canaries only; they are not an accuracy or production-readiness claim for arbitrary documents.

The private 12-page `SCAN_Popular_PO_4131999.pdf` regression was then run locally without adding it to the build. It processed into page 9 before failing closed at the 60-call boundary during a targeted reread. Observed elapsed time was approximately 548 seconds. Pages 10–12 were not processed, so this run is not a valid full-document accuracy result. It demonstrates that the fixed 60-call budget is too small for the current high-trigger strategy on this 128-row scan. The failure envelope now preserves `model_calls`, inspections, iterations, processed pages and localization coverage so subsequent bounded failures are directly auditable; the first real budget-failure run predated that instrumentation and therefore cannot provide a trustworthy inspection-count or bbox-coverage total.

## BYOK security boundary

This is an internal experiment, not a production credential architecture.

- Provider endpoints are fixed to Google Gemini and OpenAI official domains.
- Keys are entered in a password field and encrypted with an unexportable AES-GCM 256 key stored in IndexedDB.
- Each record uses a fresh 12-byte IV and AAD containing the version, store and record ID.
- Keys are not included in URLs, UI state, exports, traces, Service Worker caches, GitHub Actions or source control.
- Device auto-unlock protects against casual direct database inspection. It does **not** protect against malicious same-origin JavaScript, browser extensions, a compromised dependency, or an already unlocked page.
- Use a limited, revocable test key. Do not use production credentials or confidential customer documents.

## Browser data

Database: `idp-extraction-lab-v1`

- `vault`: device CryptoKey
- `provider_credentials`: encrypted BYOK credentials
- `documents`: encrypted originals and metadata
- `runs`: encrypted result/configuration/status
- `artifacts`: encrypted inspection/correction artifacts

The Lab requests persistent storage and enforces a local policy cap of 250 MB or 80% of the browser quota, whichever is lower. If persistence fails, a run may finish in memory and the UI warns the user to export immediately. Runs are never deleted automatically.

## Agent limits

- file: 20 MB, 50 pages
- primary render: 144 DPI
- inspection render: 400 DPI default, 500 DPI maximum
- zoom: 4x maximum
- derived view: 16 MP and 8 MB maximum
- two inspections per unresolved issue
- six regions per decision
- five iterations
- 60 model calls
- ten-minute run timeout
- no HITL, web, arbitrary endpoint, filesystem, shell, subagent or unbounded recursion

Insufficient or conflicting crop evidence produces `null / needs_review`; a crop never automatically overwrites the first reading.

## Local development

Use Node.js 24, matching the GitHub Actions workflow.

```powershell
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm ci
npm run dev
```

Open the Vite URL, configure a limited-use Gemini or OpenAI key in Provider settings, then explicitly choose **Test connection** or **Run Extraction**. Both actions make real paid provider calls. CI never performs them.

## Verification

```powershell
npm test
npm run verify:standalone
npm run build
npm run scan:dist
# includes language-cycle, layout, responsive and offline-shell checks
npm run qa:browser
# local N -> N+1 Service Worker prompt/loader acceptance (no provider calls)
npm run qa:pwa-update
# deterministic checks only
npm run check
```

Browser QA cycles the UI through English, Mandarin, Malay, Japanese and Vietnamese and asserts that the extraction field keys remain unchanged. It also verifies the old `.security-banner` is absent, the language preference survives a reload, the shell remains usable offline, and Provider requests are not cached.

The artifact scan rejects `.cfm`, `.env`, Golden/customer filenames, absolute Globe3 paths, credential-shaped strings and unexpected remote URLs. It confirms `.nojekyll` and the synthetic sample are present.

The test suite also executes the bundled agrun runtime against the shared action definition and verifies progressive thumbnail completion, isolated thumbnail failures, document cancellation and retry. Browser QA can additionally use a private local multi-page PDF without copying it into the build:

```powershell
$env:IDP_LAB_MULTIPAGE_PDF='D:\path\to\private-test.pdf'
npm run qa:browser
```

Provider/runtime failures remain visible in the Result panel with a sanitized error summary, last completed phase/page, rerun action and on-demand execution trace. Failed run state and safe telemetry are encrypted in IndexedDB; API keys, image Base64, complete prompts and raw Provider responses are not persisted in the trace.

## GitHub Pages

`.github/workflows/pages.yml`:

- validates pull requests without deployment;
- builds and deploys `lab/dist` on `main`, `master` or manual dispatch;
- uses no repository secrets and makes no model calls;
- uploads only the static Lab artifact;
- uses relative paths compatible with `username.github.io/repository/`.

An actual Pages URL requires a configured GitHub remote, GitHub Pages enabled for Actions, and a successful deployment.

### Create a standalone GitHub repository

1. Copy the contents of this directory so that `package.json` and `.github/` are at the new repository root.
2. Do not copy `node_modules/`, `dist/`, `tmp-*.png` or `*.log`; `.gitignore` excludes them when using `git add .`.
3. Run `npm ci` and `npm run check` before the first push.
4. Push to `main` or `master`.
5. In GitHub, select **Settings → Pages → Source → GitHub Actions**.

The Action builds from source and publishes only `dist/`. It does not read repository secrets or call Gemini/OpenAI. Provider calls happen only when a user supplies a test BYOK key in the deployed browser UI. See `THIRD_PARTY_NOTICES.md` before public redistribution.

Standalone portability was verified on 2026-08-14 by copying only the non-ignored repository files into a clean directory with no parent `agrun.js`, then running `npm ci` and `npm run check`. The clean copy produced `dist/index.html` and retained the Pages workflow.

## Offline behavior

The generated Service Worker precaches the application shell, PDF.js, agrun, icons and synthetic PDF. Provider POST requests are network-only and never enter Cache API. Offline mode can open the shell, switch language, browse local documents and view encrypted local history; Run Extraction and Test Provider are disabled and no provider submission is reported as successful. The Service Worker does not auto-activate: users see a localized update prompt and must explicitly confirm. Light system chrome is supported; dark system chrome is intentionally `N/A` for this light-only product. The Lab uses internal pane scrolling rather than a long page, so smart top-bar hiding and scroll-to-top are `N/A`.

## Out of scope

- ERP posting, mapping, authentication and database writes
- Golden scoring or production accuracy claims
- customer documents in the public build
- production-grade secret custody
- CI model-accuracy simulation
