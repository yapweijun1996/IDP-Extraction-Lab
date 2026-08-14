import test from "node:test";
import assert from "node:assert/strict";

await import("../src/contracts/extraction-prompt.js");

test("primary prompt expresses dynamic intent without embedding the contract object", () => {
  const contract = {
    schemaVersion: "idp_extraction_contract_v1",
    documentType: "purchase_order",
    documentFields: [{ key: "po_number", label: "Purchase Order Number", type: "text", required: true }],
    lineItemFields: [{ key: "amount", label: "Amount", type: "number", required: true }],
    totalFields: [{ key: "grand_total", label: "Grand Total", type: "number", required: false }],
    advancedPrompt: "Preserve printed identifiers."
  };
  const prompt = globalThis.IdpExtractionPrompt.primary(contract, 1, 12);
  assert.match(prompt, /po_number \(Purchase Order Number; text; required\)/);
  assert.match(prompt, /amount \(Amount; number; required\)/);
  assert.match(prompt, /grand_total \(Grand Total; number; optional\)/);
  assert.match(prompt, /values, not the extraction configuration/i);
  assert.doesNotMatch(prompt, /schemaVersion|documentFields|lineItemFields|totalFields/);
});
