import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LAYOUT_STATE,
  LAYOUT_STORAGE_KEY,
  activePaneAfterHide,
  cloneDefaultLayout,
  loadLayoutState,
  normalizeVisibleWidths,
  resizeBoundary,
  saveLayoutState,
  sanitizeLayoutState,
  togglePane,
  visiblePaneKeys
} from '../src/state/layout-state.mjs';

function memoryStorage(value = null) {
  return {
    value,
    getItem() { return this.value; },
    setItem(_key, next) { this.value = next; }
  };
}

test('layout defaults and visible width normalization are stable', () => {
  const state = cloneDefaultLayout();
  assert.deepEqual(state, { version: 1, widths: { fields: 26, document: 44, result: 30 }, hidden: { fields: false, document: false, result: false } });
  const normalized = normalizeVisibleWidths({ version: 1, widths: { fields: 1, document: 1, result: 2 }, hidden: { fields: true, document: false, result: false } });
  assert.equal(normalized.widths.document + normalized.widths.result, 100);
  assert.deepEqual(visiblePaneKeys(normalized), ['document', 'result']);
  assert.equal(DEFAULT_LAYOUT_STATE.widths.fields, 26);
});

test('invalid persisted layout falls back to defaults and valid layout persists', () => {
  const storage = memoryStorage('{"version":1,"widths":{"fields":0},"hidden":{}}');
  assert.deepEqual(loadLayoutState(storage), cloneDefaultLayout());
  const saved = saveLayoutState({ version: 1, widths: { fields: 30, document: 45, result: 25 }, hidden: { fields: false, document: false, result: false } }, storage);
  assert.equal(JSON.parse(storage.value).version, 1);
  assert.equal(storage.getItem(LAYOUT_STORAGE_KEY) !== null, true);
  assert.deepEqual(saved.hidden, { fields: false, document: false, result: false });
});

test('cannot hide the last visible pane and active view falls back', () => {
  const state = { version: 1, widths: { fields: 25, document: 45, result: 30 }, hidden: { fields: true, document: true, result: false } };
  const rejected = togglePane(state, 'result', false);
  assert.equal(rejected.changed, false);
  assert.equal(rejected.reason, 'last_visible_pane');
  assert.equal(activePaneAfterHide(state, 'fields'), 'result');
  const shown = togglePane(state, 'document', true);
  assert.equal(shown.changed, true);
  assert.deepEqual(visiblePaneKeys(shown.state), ['document', 'result']);
});

test('sequential pane toggles preserve unrelated visibility and extraction intent', () => {
  const extractionContract = {
    documentFields: [{ key: 'po_number' }],
    lineItemFields: [{ key: 'amount' }],
    totalFields: [{ key: 'grand_total' }]
  };
  const beforeContract = structuredClone(extractionContract);
  let state = { version: 1, widths: { fields: 26, document: 44, result: 30 }, hidden: { fields: true, document: true, result: false } };

  state = togglePane(state, 'fields', true).state;
  assert.deepEqual(state.hidden, { fields: false, document: true, result: false });
  state = togglePane(state, 'document', true).state;
  assert.deepEqual(state.hidden, { fields: false, document: false, result: false });
  state = togglePane(state, 'fields', false).state;
  assert.deepEqual(state.hidden, { fields: true, document: false, result: false });
  assert.deepEqual(extractionContract, beforeContract);
});

test('single visible pane survives normalization, persistence, and subsequent toggles', () => {
  const storage = memoryStorage(JSON.stringify({
    version: 1,
    widths: { fields: 26, document: 44, result: 30 },
    hidden: { fields: true, document: true, result: false }
  }));
  const loaded = loadLayoutState(storage);
  assert.deepEqual(loaded.hidden, { fields: true, document: true, result: false });
  assert.equal(loaded.widths.result, 100);

  const saved = saveLayoutState(loaded, storage);
  assert.deepEqual(saved.hidden, { fields: true, document: true, result: false });
  assert.deepEqual(loadLayoutState(storage).hidden, { fields: true, document: true, result: false });

  const fieldsShown = togglePane(saved, 'fields', true);
  assert.deepEqual(fieldsShown.state.hidden, { fields: false, document: true, result: false });
  const documentShown = togglePane(fieldsShown.state, 'document', true);
  assert.deepEqual(documentShown.state.hidden, { fields: false, document: false, result: false });
});

test('resizing clamps both panes to their minimum pixel widths', () => {
  const state = cloneDefaultLayout();
  const expanded = resizeBoundary(state, 'fields', 'document', -1000, 1200);
  assert.ok(expanded.widths.fields <= state.widths.fields);
  const restored = resizeBoundary(expanded, 'fields', 'document', 1000, 1200);
  assert.ok(restored.widths.document <= state.widths.document);
  const invalid = resizeBoundary(state, 'fields', 'document', 50, 0);
  assert.deepEqual(invalid, sanitizeLayoutState(state));
});
