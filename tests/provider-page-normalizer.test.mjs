import test from "node:test";
import assert from "node:assert/strict";

await import("../src/providers/provider-page-normalizer.js");
const normalizer = globalThis.IdpProviderPageNormalizer;
const contract = {
  documentFields: [{ key: "po_number" }, { key: "supplier_name" }],
  lineItemFields: [{ key: "sn" }, { key: "amount" }],
  totalFields: [{ key: "grand_total" }]
};

test("maps provider flat business output through only active contract keys", () => {
  const raw = { po_number: "PO-7", line_items: [{ sn: 1, amount: "12.50", ignored: "x", box_2d: [1, 2, 3, 4] }], grand_total: "12.50", ignored: "x" };
  assert.equal(normalizer.accepts(raw, contract), true);
  assert.deepEqual(normalizer.normalize(raw, contract, 3), {
    page_number: 3,
    document_fields: { po_number: "PO-7", supplier_name: null },
    line_items: [{ fields: { sn: 1, amount: "12.50" }, source_box_2d: [1, 2, 3, 4] }],
    totals: { grand_total: "12.50" }
  });
});

test("rejects echoed extraction configuration and unrelated objects", () => {
  assert.equal(normalizer.accepts({ documentType: "purchase_order", documentFields: [], lineItems: [], totalFields: [] }, contract), false);
  assert.throws(() => normalizer.normalize({ message: "unrelated" }, contract, 1), /cannot be mapped/);
});

test("canonical pages are rebuilt against every active contract key", () => {
  const canonical = { page_number: 1, document_fields: {}, line_items: [], totals: {} };
  assert.deepEqual(normalizer.normalize(canonical, contract, 1), {
    page_number: 1,
    document_fields: { po_number: null, supplier_name: null },
    line_items: [],
    totals: { grand_total: null }
  });
  assert.notEqual(normalizer.normalize(canonical, contract, 1), canonical);
});

test("deep semantic validation catches missing confidence and contradictory state", () => {
  const value = {
    page_number: 1,
    document_fields: {
      po_number: { value: "PO-1", status: "verified", confidence: null, box_2d: [10, 10, 20, 30] },
      supplier_name: { value: null, status: "verified", confidence: null, box_2d: null }
    },
    line_items: [],
    totals: { grand_total: { value: null, status: "missing", confidence: null, box_2d: null } }
  };
  const issues = normalizer.semanticIssues(value, contract, 1);
  assert.ok(issues.some((issue) => issue.code === "confidence_missing_or_invalid" && issue.path.endsWith("/po_number")));
  assert.ok(issues.some((issue) => issue.code === "state_value_status_conflict" && issue.path.endsWith("/supplier_name")));
  assert.equal(issues.some((issue) => issue.code === "confidence_missing_or_invalid" && issue.path.endsWith("/grand_total")), false);
});
