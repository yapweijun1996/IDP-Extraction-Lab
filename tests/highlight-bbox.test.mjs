import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedHighlightBox } from '../src/ui/highlight-bbox.mjs';

test('maps a valid normalized provenance box to percentage positioning', () => {
  assert.deepEqual(normalizedHighlightBox({ x: 0.1, y: 0.25, width: 0.4, height: 0.05 }), {
    left: '10%', top: '25%', width: '40%', height: '5%'
  });
});

test('does not display a highlight without real provenance', () => {
  assert.equal(normalizedHighlightBox(null), null);
  assert.equal(normalizedHighlightBox({}), null);
});

test('rejects invalid or page-escaping boxes', () => {
  assert.equal(normalizedHighlightBox({ x: -0.1, y: 0, width: 0.2, height: 0.2 }), null);
  assert.equal(normalizedHighlightBox({ x: 0.9, y: 0.1, width: 0.2, height: 0.2 }), null);
  assert.equal(normalizedHighlightBox({ x: 0.1, y: 0.95, width: 0.2, height: 0.1 }), null);
  assert.equal(normalizedHighlightBox({ x: 0.1, y: 0.1, width: 0, height: 0.2 }), null);
});
