export const LAYOUT_STORAGE_KEY = 'idp-extraction-lab-layout-v1';

export const DEFAULT_LAYOUT_STATE = Object.freeze({
  version: 1,
  widths: Object.freeze({ fields: 26, document: 44, result: 30 }),
  hidden: Object.freeze({ fields: false, document: false, result: false })
});

export const PANE_KEYS = Object.freeze(['fields', 'document', 'result']);
export const MIN_PANE_PX = Object.freeze({ fields: 280, document: 420, result: 360 });

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function cloneDefaultLayout() {
  return {
    version: 1,
    widths: { ...DEFAULT_LAYOUT_STATE.widths },
    hidden: { ...DEFAULT_LAYOUT_STATE.hidden }
  };
}

export function visiblePaneKeys(state) {
  return PANE_KEYS.filter((key) => !state.hidden[key]);
}

export function normalizeVisibleWidths(state) {
  const next = { version: 1, widths: { ...state.widths }, hidden: { ...state.hidden } };
  const visible = visiblePaneKeys(next);
  const total = visible.reduce((sum, key) => sum + Math.max(0.1, next.widths[key]), 0);
  visible.forEach((key) => { next.widths[key] = (Math.max(0.1, next.widths[key]) / total) * 100; });
  if (visible.length) {
    const last = visible[visible.length - 1];
    const beforeLast = visible.slice(0, -1).reduce((sum, key) => sum + next.widths[key], 0);
    next.widths[last] = Math.max(0.1, 100 - beforeLast);
  }
  return next;
}

export function sanitizeLayoutState(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !value.widths || !value.hidden) return cloneDefaultLayout();
  const widths = {};
  const hidden = {};
  for (const key of PANE_KEYS) {
    const width = finiteNumber(value.widths[key]);
    if (width === null || width < 1 || width > 100 || typeof value.hidden[key] !== 'boolean') return cloneDefaultLayout();
    widths[key] = width;
    hidden[key] = value.hidden[key];
  }
  if (PANE_KEYS.every((key) => hidden[key])) return cloneDefaultLayout();
  return normalizeVisibleWidths({ version: 1, widths, hidden });
}

export function loadLayoutState(storage = globalThis.localStorage) {
  try { return sanitizeLayoutState(JSON.parse(storage?.getItem(LAYOUT_STORAGE_KEY) || 'null')); }
  catch { return cloneDefaultLayout(); }
}

export function saveLayoutState(state, storage = globalThis.localStorage) {
  const safe = sanitizeLayoutState(state);
  try { storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(safe)); } catch { /* preference only */ }
  return safe;
}

export function togglePane(state, key, visible) {
  if (!PANE_KEYS.includes(key)) return { state: sanitizeLayoutState(state), changed: false, reason: 'unknown_pane' };
  const next = sanitizeLayoutState(state);
  if (!visible && visiblePaneKeys(next).length === 1 && !next.hidden[key]) return { state: next, changed: false, reason: 'last_visible_pane' };
  next.hidden[key] = !visible;
  return { state: normalizeVisibleWidths(next), changed: true, reason: null };
}

export function resizeBoundary(state, leftKey, rightKey, deltaPx, totalWidthPx, minWidths = MIN_PANE_PX) {
  const next = sanitizeLayoutState(state);
  const total = finiteNumber(totalWidthPx);
  const delta = finiteNumber(deltaPx);
  if (!PANE_KEYS.includes(leftKey) || !PANE_KEYS.includes(rightKey) || leftKey === rightKey || next.hidden[leftKey] || next.hidden[rightKey] || !total || total <= 0 || delta === null) return next;
  const pairPercent = next.widths[leftKey] + next.widths[rightKey];
  const pairPixels = total * (pairPercent / 100);
  const currentLeftPixels = total * (next.widths[leftKey] / 100);
  const minimumLeft = Number(minWidths[leftKey]) || 0;
  const minimumRight = Number(minWidths[rightKey]) || 0;
  const leftPixels = Math.max(minimumLeft, Math.min(pairPixels - minimumRight, currentLeftPixels + delta));
  next.widths[leftKey] = (leftPixels / total) * 100;
  next.widths[rightKey] = ((pairPixels - leftPixels) / total) * 100;
  return normalizeVisibleWidths(next);
}

export function boundaryValue(state, leftKey) {
  return Math.round(Number(state.widths[leftKey] || 0) * 10) / 10;
}

export function activePaneAfterHide(state, activeKey) {
  const visible = visiblePaneKeys(state);
  return visible.includes(activeKey) ? activeKey : (visible[0] || 'document');
}
