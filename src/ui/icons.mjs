const PATHS = Object.freeze({
  add: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.2 2.5 3.4 5.5 3.4 9S14.2 18.5 12 21c-2.2-2.5-3.4-5.5-3.4-9S9.8 5.5 12 3Z"/>',
  play: '<path d="m9 6 10 6-10 6V6Z"/>',
  download: '<path d="M12 3v11M8 10l4 4 4-4M5 20h14"/>',
  layout: '<rect x="3.5" y="4" width="7" height="7" rx="1"/><rect x="13.5" y="4" width="7" height="7" rx="1"/><rect x="3.5" y="13" width="7" height="7" rx="1"/><rect x="13.5" y="13" width="7" height="7" rx="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
  chevronUp: '<path d="m5 15 7-7 7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  zoomIn: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5M10.8 7.5v6.6M7.5 10.8h6.6"/>',
  zoomOut: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5M7.5 10.8h6.6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/>',
  grip: '<circle cx="8" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="18" r="1" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 9 18H3L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.7 4L21 14M21 19v-5h-5"/>',
  dash: '<path d="M5 12h14"/>',
  loader: '<path d="M12 3a9 9 0 1 1-6.36 2.64"/>',
  document: '<path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 12h6M8 16h6"/>',
  empty: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'
});

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

function safeClassName(value) {
  return String(value || '').split(/\s+/).filter((token) => /^[A-Za-z0-9_-]+$/.test(token)).join(' ');
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function icon(name, options = {}) {
  if (!Object.hasOwn(PATHS, name)) throw new RangeError(`Unknown icon: ${name}`);
  const size = boundedNumber(options.size, 18, 10, 64);
  const strokeWidth = boundedNumber(options.strokeWidth, 1.8, 1, 3);
  const className = ['ui-icon', `ui-icon-${name}`, safeClassName(options.className)].filter(Boolean).join(' ');
  const ariaHidden = options.ariaHidden === false ? '' : ' aria-hidden="true"';
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" focusable="false"${ariaHidden}>${PATHS[name]}</svg>`;
}
