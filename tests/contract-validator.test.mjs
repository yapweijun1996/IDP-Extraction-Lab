import test from "node:test";
import assert from "node:assert/strict";
import { pageResponseSchema, sanitizeProviderConfig, validateContract } from "../src/providers/contract.mjs";
import { box2dToBbox, evaluateFinancial, normalizePage, normalizeState, validatePage } from "../src/validation/validator.mjs";

const contract = {
  schemaVersion: "idp_extraction_contract_v1", documentType: "purchase_order", advancedPrompt: "",
  documentFields: [{ key: "po_number", label: "PO Number", type: "text", required: true }],
  lineItemFields: [{ key: "sn", label: "S/N", type: "number", required: true }, { key: "quantity", label: "Quantity", type: "number", required: true }, { key: "unit_price", label: "Unit Price", type: "number", required: true }, { key: "amount", label: "Amount", type: "number", required: true }],
  totalFields: [{ key: "grand_total", label: "Grand Total", type: "number", required: true }]
};

test("dynamic contract compiles to strict page schema", () => { const schema = pageResponseSchema(contract); assert.equal(schema.additionalProperties, false); assert.deepEqual(schema.properties.document_fields.required, ["po_number"]); assert.deepEqual(schema.properties.line_items.items.properties.fields.required, ["sn", "quantity", "unit_price", "amount"]); assert.equal(schema.properties.document_fields.properties.po_number.properties.confidence.anyOf.some((entry) => entry.type === "null"), true); });
test("duplicate field keys are rejected", () => assert.throws(() => validateContract({ ...contract, totalFields: [{ key: "po_number", label: "Duplicate", type: "text" }] }), /Duplicate/));
test("provider endpoints are not user configurable", () => { assert.deepEqual(sanitizeProviderConfig({ provider: "openai", model: "gpt-5-mini", reasoning: "medium", endpoint: "https://evil.invalid" }), { provider: "openai", model: "gpt-5-mini", reasoning: "medium", apiVariant: "responses", temperature: undefined }); });
test("box_2d is normalized and excessive regions fail", () => { assert.deepEqual(box2dToBbox([100, 200, 300, 500]), { x: .2, y: .1, width: .3, height: .2 }); assert.equal(box2dToBbox([0, 0, 1000, 1000]), null); assert.equal(box2dToBbox([300, 200, 100, 500]), null); });
test("deterministic validator detects arithmetic mismatch without model confidence", () => { const state = (value) => ({ value, status: "verified", confidence: 1 }); const issues = validatePage({ page_number: 1, document_fields: { po_number: state("PO-1") }, totals: { grand_total: state("11.00") }, line_items: [{ fields: { sn: state(1), quantity: state("2"), unit_price: state("5.00"), amount: state("11.00") }, source_bbox: { x: .1, y: .1, width: .8, height: .1 } }] }, contract); assert.ok(issues.some((issue) => issue.code === "amount_mismatch")); });

test("shared normalizer preserves missing confidence as null and removes contradictory verified states", () => {
  assert.deepEqual(normalizeState({ value: null, status: "verified" }, 1), { value: null, raw: null, status: "missing", confidence: null, provenance: null });
  assert.equal(normalizeState({ value: "PO-1", status: "missing", confidence: 0.95 }, 1).status, "needs_review");
  assert.equal(normalizeState({ value: "PO-1", status: "verified", confidence: 0.4 }, 1).status, "uncertain");
});

test("unambiguous visual dates normalize deterministically to ISO while preserving raw evidence", () => {
  const date = normalizeState({ value: "24.07.2026", status: "verified", confidence: 0.99 }, 1, false, "date");
  assert.equal(date.value, "2026-07-24");
  assert.equal(date.raw, "24.07.2026");
  assert.equal(date.status, "verified");
});

test("page normalization and validation use the same evidence-aware core", () => {
  const normalized = normalizePage({ document_fields: { po_number: { value: "PO-1", status: "verified", confidence: 0.95, box_2d: null } }, totals: { grand_total: { value: null, status: "missing", confidence: null, box_2d: null } }, line_items: [] }, 1, contract);
  assert.ok(validatePage(normalized, contract).some((issue) => issue.code === "field_evidence_missing"));
});

test("financial validation is tri-state and never passes with missing operands", () => {
  const totalContract = { ...contract, totalFields: [{ key: "subtotal", label: "Subtotal", type: "number" }, { key: "gst", label: "GST", type: "number" }, { key: "grand_total", label: "Grand Total", type: "number", required: true }] };
  const states = (subtotal, gst, grandTotal) => [{ totals: { subtotal: { value: subtotal }, gst: { value: gst }, grand_total: { value: grandTotal } } }];
  assert.equal(evaluateFinancial(states(null, null, "10.00"), totalContract).status, "not_evaluated");
  assert.equal(evaluateFinancial(states("9.00", "1.00", "10.00"), totalContract).status, "pass");
  assert.equal(evaluateFinancial(states("9.00", "2.00", "10.00"), totalContract).status, "fail");
});
