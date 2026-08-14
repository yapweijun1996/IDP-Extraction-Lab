# Cleanup plan

This file records cleanup candidates found during the source-layout refactor. Candidates stay in place until their ownership and retention requirements are confirmed.

## High-probability temporary files

- `tmp-desktop.png` - local desktop screenshot; no source, test, build, or configuration reference found.
- `tmp-mobile.png` - local mobile screenshot; no source, test, build, or configuration reference found.
- `vite-*.err.log` - local Vite error logs; no source or build reference found.
- `vite-*.out.log` - local Vite output logs; no source or build reference found.

## Deferred module review

- `src/i18n/i18n.mjs` and `src/i18n/localization.js`: keep separate until UI locale persistence and Worker localization responsibilities are explicitly reconciled.
- `src/validation/validation-core.js` and `src/validation/validator.mjs`: keep separate until the global Worker validation bridge and the ESM adapter boundary are explicitly reconciled.

## Deletion gate

Before deleting a candidate, confirm it is not needed for local debugging, screenshots, release evidence, or an external script reference. Then run `npm test`, `npm run build`, and `npm run scan:dist` after the deletion.
