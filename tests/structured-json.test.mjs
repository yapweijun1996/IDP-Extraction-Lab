import test from "node:test";
import assert from "node:assert/strict";

await import("../src/validation/structured-json.js");
const { parse } = globalThis.IdpStructuredJson;
const pageShape = (value) => value?.document_fields && Array.isArray(value?.line_items) && value?.totals;

test("parses a strict structured response", () => {
  assert.deepEqual(parse('{"document_fields":{},"line_items":[],"totals":{}}', pageShape), { document_fields: {}, line_items: [], totals: {} });
});

test("recovers one schema-compatible JSON value with trailing provider content", () => {
  const text = '{"document_fields":{},"line_items":[],"totals":{}}\n{"note":"duplicate provider part"}';
  assert.deepEqual(parse(text, pageShape), { document_fields: {}, line_items: [], totals: {} });
});

test("balanced scanning preserves braces and escapes inside strings", () => {
  const text = 'prefix ```json\n{"document_fields":{"note":"a } [ \\\"quoted\\\" value"},"line_items":[],"totals":{}}\n``` suffix';
  assert.equal(parse(text, pageShape).document_fields.note, 'a } [ "quoted" value');
});

test("truncated or schema-incompatible output still fails closed", () => {
  assert.throws(() => parse('{"document_fields":{},"line_items":[', pageShape), /malformed or schema-incompatible/);
  assert.throws(() => parse('{"message":"not extraction data"}', pageShape), /object\(message\)/);
});
