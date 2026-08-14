import test from "node:test";
import assert from "node:assert/strict";
import "../src/i18n/localization.js";

const L = globalThis.IdpLocalization;
const contract = {
  documentFields: [{ key: "po_number", label: "PO Number", type: "text", required: true }],
  lineItemFields: [
    { key: "sn", label: "S/N", type: "number", required: true },
    { key: "stock_code", label: "Stock Code", type: "text", required: true },
    { key: "amount", label: "Amount", type: "number", required: true }
  ],
  totalFields: [{ key: "grand_total", label: "Grand Total", type: "number", required: true }]
};

const state = (value, provenance = null) => ({ value, status: "verified", confidence: 0.98, provenance });
function page() {
  return {
    page_number: 1,
    document_fields: { po_number: state("PO-1") },
    totals: { grand_total: state("10.00") },
    line_items: [{ source_page: 1, source_bbox: null, fields: { sn: state(1), stock_code: state("SKU-1"), amount: state("10.00") } }]
  };
}

test("missing row and non-empty key-field bboxes create evidence issues", () => {
  const issues = L.addEvidenceIssues(page(), contract, []);
  assert.equal(issues.filter((issue) => issue.code === "field_evidence_missing").length, 2);
  assert.equal(issues.filter((issue) => issue.code === "row_evidence_missing").length, 1);
});

test("syntactically valid but unverified boxes do not inflate localization coverage", () => {
  const current = page();
  const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.08 };
  current.document_fields.po_number.status = "uncertain";
  current.document_fields.po_number.confidence = null;
  current.totals.grand_total.status = "uncertain";
  current.totals.grand_total.confidence = null;
  current.document_fields.po_number.provenance = { page: 1, bbox: box, source: "primary_extraction" };
  current.totals.grand_total.provenance = { page: 1, bbox: box, source: "primary_extraction" };
  current.line_items[0].source_bbox = box;
  current.line_items[0].localization_status = "unverified";
  assert.deepEqual(L.coverage([current], contract), {
    located_targets: 0,
    unlocated_targets: 3,
    localization_failed: 0,
    localization_budget_exhausted: 0
  });
  assert.equal(L.addEvidenceIssues(current, contract, []).filter((issue) => /evidence_missing/.test(issue.code)).length, 3);
});

test("multiple row issues merge into one prioritized localization target", () => {
  const current = page();
  const rowPath = "/pages/0/line_items/0";
  const issues = [
    { code: "row_evidence_missing", path: rowPath, page: 1, row: 1, repairable: true },
    { code: "amount_mismatch", path: `${rowPath}/fields/amount`, page: 1, row: 1, repairable: true },
    { code: "low_confidence", path: `${rowPath}/fields/stock_code`, page: 1, row: 1, repairable: true }
  ];
  const targets = L.buildTargets(current, contract, issues, new Map(), { maxRegions: 6, maxAttempts: 2 });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, rowPath);
  assert.equal(targets[0].mandatory, true);
  assert.deepEqual(targets[0].anchor_paths.slice(0, 2), [`${rowPath}/fields/sn`, `${rowPath}/fields/stock_code`]);
  assert.deepEqual(targets[0].field_paths, contract.lineItemFields.map((field) => `${rowPath}/fields/${field.key}`));
});

test("Agent STOP leaves mandatory targets for one strict locator request", () => {
  const current = page();
  const targets = L.buildTargets(current, contract, L.addEvidenceIssues(current, contract, []), new Map(), { maxRegions: 6, maxAttempts: 2 });
  assert.ok(L.mandatoryTargetsWithoutInspection(targets, []).length > 0);
  assert.equal(L.mandatoryTargetsWithoutInspection(targets, [{ target_id: targets[0].id }]).some((target) => target.id === targets[0].id), false);
});

test("required missing values remain mandatory and reuse an existing row bbox hint", () => {
  const current = page();
  current.line_items[0].source_bbox = { x: 0.1, y: 0.4, width: 0.8, height: 0.08 };
  current.line_items[0].fields.amount = { value: null, status: "missing", confidence: 0, provenance: null };
  const path = "/pages/0/line_items/0/fields/amount";
  const targets = L.buildTargets(current, contract, [{ code: "required_field_missing", path, page: 1, row: 1, repairable: true }], new Map(), { maxRegions: 6, maxAttempts: 2 });
  assert.equal(targets[0].mandatory, true);
  assert.deepEqual(targets[0].bbox_hint, current.line_items[0].source_bbox);
  assert.equal(targets[0].requires_source_confirmation, false);
});

test("low-confidence evidence cannot be dismissed without one bounded visual check", () => {
  const current = page();
  current.document_fields.po_number.provenance = { page: 1, bbox: { x: 0.6, y: 0.08, width: 0.2, height: 0.04 } };
  const path = "/pages/0/document_fields/po_number";
  const target = L.buildTargets(current, contract, [{ code: "low_confidence", path, page: 1, repairable: true }], new Map(), { maxRegions: 6, maxAttempts: 2 })[0];
  assert.equal(target.mandatory, true);
  assert.deepEqual(target.bbox_hint, current.document_fields.po_number.provenance.bbox);
});

test("grouped row attempts rotate to unresolved fields instead of exhausting the whole row", () => {
  const current = page(); current.line_items[0].source_bbox = { x: 0.1, y: 0.4, width: 0.8, height: 0.08 };
  for (const field of contract.lineItemFields) current.line_items[0].fields[field.key] = { value: null, status: "missing", confidence: 0, provenance: null };
  const paths = contract.lineItemFields.map((field) => `/pages/0/line_items/0/fields/${field.key}`);
  const issues = paths.map((path) => ({ code: "required_field_missing", path, page: 1, row: 1, repairable: true }));
  const attempts = new Map(paths.slice(0, 2).map((path) => [path, 2]));
  const target = L.buildTargets(current, contract, issues, attempts, { maxRegions: 6, maxAttempts: 2 })[0];
  assert.deepEqual(target.field_paths, paths.slice(2));
  assert.deepEqual(target.attempt_keys, paths.slice(2));
});

test("strong evidence may establish a previously null row identity but not overwrite an existing one", () => {
  const current = page(); current.line_items[0].source_bbox = { x: 0.1, y: 0.4, width: 0.8, height: 0.08 }; current.line_items[0].fields.sn.value = null; current.line_items[0].fields.stock_code.value = null;
  const paths = ["/pages/0/line_items/0/fields/sn", "/pages/0/line_items/0/fields/stock_code"];
  const target = { id: "/pages/0/line_items/0", kind: "row", page: 1, rowIndex: 0, field_paths: paths, anchor_paths: [], mandatory: true, requires_source_confirmation: false };
  const inspection = { page: 1, bbox: current.line_items[0].source_bbox, inspection_id: "inspection-id", views: [{ hash: "a" }, { hash: "b" }] };
  assert.equal(L.reconcileInspection(current, target, inspection, observations(paths, [1, "SKU-1"]), contract).committed, true);
  assert.equal(current.line_items[0].fields.sn.value, 1);
  assert.equal(current.line_items[0].fields.stock_code.value, "SKU-1");
  assert.equal(L.reconcileInspection(current, target, inspection, observations(paths, [99, "OTHER"]), contract).committed, true);
  assert.equal(current.line_items[0].fields.sn.value, 1);
  assert.equal(current.line_items[0].fields.stock_code.value, "SKU-1");
});

test("box_2d accepts tight coordinates and rejects unsafe coordinates", () => {
  assert.deepEqual(L.box2dToBbox([100, 200, 200, 700]), { x: 0.2, y: 0.1, width: 0.5, height: 0.1 });
  for (const invalid of [[200, 100, 100, 200], [-1, 0, 2, 3], [0, 0, 0, 10], [0, 0, 1000, 1000]]) assert.equal(L.box2dToBbox(invalid), null);
});

function observations(paths, values, confidence = 0.97) {
  return paths.map((field_path, index) => ({ field_path, views: [{ view: "original", observed_value: values[index], confidence }, { view: "enhanced", observed_value: values[index], confidence }] }));
}

test("two matching row anchors commit the real row bbox and provenance", () => {
  const current = page(), rowPath = "/pages/0/line_items/0";
  const target = L.buildTargets(current, contract, [{ code: "row_evidence_missing", path: rowPath, page: 1, row: 1, repairable: true }], new Map(), { maxRegions: 6, maxAttempts: 2 })[0];
  const inspection = { page: 1, bbox: { x: 0.1, y: 0.4, width: 0.8, height: 0.08 }, inspection_id: "inspection-1", views: [{ hash: "a" }, { hash: "b" }] };
  const result = L.reconcileInspection(current, target, inspection, observations(target.field_paths, [1, "SKU-1", "10.00"]), contract);
  assert.equal(result.committed, true);
  assert.deepEqual(current.line_items[0].source_bbox, inspection.bbox);
  assert.equal(current.line_items[0].fields.sn.provenance.inspection_id, "inspection-1");
});

test("weak evidence, wrong row anchors, or wrong page cannot submit coordinates", () => {
  for (const scenario of ["weak", "wrong_anchor", "wrong_page"]) {
    const current = page(), rowPath = "/pages/0/line_items/0";
    const target = L.buildTargets(current, contract, [{ code: "row_evidence_missing", path: rowPath, page: 1, row: 1, repairable: true }], new Map(), { maxRegions: 6, maxAttempts: 2 })[0];
    const inspection = { page: scenario === "wrong_page" ? 2 : 1, bbox: { x: 0.1, y: 0.4, width: 0.8, height: 0.08 }, inspection_id: "inspection-1", views: [{ hash: "a" }, { hash: "b" }] };
    const values = scenario === "wrong_anchor" ? [99, "OTHER", "10.00"] : [1, "SKU-1", "10.00"];
    const result = L.reconcileInspection(current, target, inspection, observations(target.field_paths, values, scenario === "weak" ? 0.6 : 0.97), contract);
    assert.equal(result.committed, false, scenario);
    assert.equal(current.line_items[0].source_bbox, null, scenario);
  }
});

test("verified field evidence writes unified provenance while budget exhaustion stays reviewable", () => {
  const current = page(), path = "/pages/0/document_fields/po_number";
  const target = { id: path, kind: "field", page: 1, rowIndex: null, field_paths: [path], anchor_paths: [], mandatory: true };
  const inspection = { page: 1, bbox: { x: 0.65, y: 0.08, width: 0.2, height: 0.05 }, inspection_id: "inspection-field", views: [{ hash: "a" }, { hash: "b" }] };
  assert.equal(L.reconcileInspection(current, target, inspection, observations([path], ["PO-1"]), contract).committed, true);
  assert.equal(current.document_fields.po_number.provenance.source, "targeted_visual_reinspection");
  L.markLocalization(current, { ...target, id: "/pages/0/totals/grand_total", field_paths: ["/pages/0/totals/grand_total"] }, "budget_exhausted");
  const issues = L.addEvidenceIssues(current, contract, []);
  assert.ok(issues.some((issue) => issue.code === "localization_budget_exhausted" && issue.path === "/pages/0/totals/grand_total"));
});

test("a required null field that exhausts localization is counted and classified", () => {
  const missingContract = { ...contract, documentFields: [...contract.documentFields, { key: "approval_code", label: "Approval Code", type: "text", required: true }] };
  const current = page();
  current.document_fields.approval_code = { value: null, status: "missing", confidence: null, provenance: null };
  const target = { id: "/pages/0/document_fields/approval_code", kind: "field", page: 1, rowIndex: null, field_paths: ["/pages/0/document_fields/approval_code"], mandatory: true };
  L.markLocalization(current, target, "budget_exhausted");
  const coverage = L.coverage([current], missingContract);
  assert.equal(coverage.unlocated_targets, 4);
  assert.equal(coverage.localization_budget_exhausted, 1);
  assert.ok(L.addEvidenceIssues(current, missingContract, []).some((issue) => issue.code === "localization_budget_exhausted" && issue.path === target.id));
});
