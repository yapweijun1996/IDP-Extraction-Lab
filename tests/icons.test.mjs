import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, icon } from '../src/ui/icons.mjs';

test('every registered icon renders a safe inline SVG', () => {
  assert.ok(ICON_NAMES.length >= 20);
  for (const name of ICON_NAMES) {
    const markup = icon(name);
    assert.match(markup, /^<svg\b/);
    assert.match(markup, /viewBox="0 0 24 24"/);
    assert.match(markup, /stroke="currentColor"/);
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, /focusable="false"/);
    assert.doesNotMatch(markup, /<script|on[a-z]+\s*=|(?:https?:|data:)/i);
  }
});

test('unknown icon names are rejected and cannot become SVG content', () => {
  assert.throws(() => icon('provider-output'), RangeError);
  assert.throws(() => icon('add<script>'), RangeError);
});

test('icon options are bounded and class names are token-safe', () => {
  const markup = icon('check', { size: 200, strokeWidth: 0, className: 'status-icon safe extra' });
  const unsafe = icon('check', { className: 'x" onload="alert(1)' });
  assert.match(markup, /width="64" height="64"/);
  assert.match(markup, /stroke-width="1"/);
  assert.match(markup, /class="ui-icon ui-icon-check status-icon safe extra"/);
  assert.doesNotMatch(unsafe, /onload|alert\(/i);
});

test('semantic status icons remain allowlisted', () => {
  for (const name of ['check', 'alert', 'refresh', 'dash']) assert.ok(ICON_NAMES.includes(name));
});

test('provider and language controls use recognizable SVG symbols', () => {
  const settings = icon('settings');
  const language = icon('language');
  assert.match(settings, /<circle cx="12" cy="12" r="3"\/>/);
  assert.doesNotMatch(settings, /M12 3v2M12 19v2/);
  assert.match(language, /<circle cx="12" cy="12" r="9"\/>/);
});
