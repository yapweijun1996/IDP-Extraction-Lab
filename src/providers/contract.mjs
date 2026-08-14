const KEY = /^[a-z_][a-z0-9_]*$/;
const TYPES = new Set(["text", "number", "date", "boolean"]);

export function validateContract(contract) {
  if (contract?.schemaVersion !== "idp_extraction_contract_v1") throw new Error("Unsupported extraction contract");
  const groups = [contract.documentFields, contract.lineItemFields, contract.totalFields];
  const seen = new Set();
  for (const fields of groups) {
    if (!Array.isArray(fields)) throw new Error("Extraction fields must be arrays");
    for (const field of fields) {
      if (!KEY.test(String(field.key || ""))) throw new Error(`Invalid field key: ${field.key || "empty"}`);
      if (!String(field.label || "").trim()) throw new Error(`Field ${field.key} needs a label`);
      if (!TYPES.has(String(field.type || "").toLowerCase())) throw new Error(`Unsupported type for ${field.key}`);
      if (seen.has(field.key)) throw new Error(`Duplicate field key: ${field.key}`);
      seen.add(field.key);
    }
  }
  if (!groups.some((fields) => fields.length)) throw new Error("Select at least one extraction field");
  if (String(contract.advancedPrompt || "").length > 1000) throw new Error("Advanced prompt is too long");
  return structuredClone(contract);
}

function stateSchema(field) {
  const primitive = field.type === "number" ? { anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }] }
    : field.type === "boolean" ? { anyOf: [{ type: "boolean" }, { type: "null" }] }
      : { anyOf: [{ type: "string" }, { type: "null" }] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "status", "confidence", "box_2d"],
    properties: {
      value: primitive,
      status: { type: "string", enum: ["verified", "uncertain", "missing", "not_present"] },
      confidence: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
      box_2d: { anyOf: [{ type: "array", minItems: 4, maxItems: 4, items: { type: "integer", minimum: 0, maximum: 1000 } }, { type: "null" }] }
    }
  };
}

function objectFor(fields) {
  return { type: "object", additionalProperties: false, required: fields.map((field) => field.key), properties: Object.fromEntries(fields.map((field) => [field.key, stateSchema(field)])) };
}

export function pageResponseSchema(contract) {
  const valid = validateContract(contract);
  return {
    type: "object",
    additionalProperties: false,
    required: ["page_number", "document_fields", "line_items", "totals"],
    properties: {
      page_number: { type: "integer", minimum: 1 },
      document_fields: objectFor(valid.documentFields),
      line_items: { type: "array", items: { type: "object", additionalProperties: false, required: ["fields", "source_box_2d"], properties: { fields: objectFor(valid.lineItemFields), source_box_2d: { anyOf: [{ type: "array", minItems: 4, maxItems: 4, items: { type: "integer", minimum: 0, maximum: 1000 } }, { type: "null" }] } } } },
      totals: objectFor(valid.totalFields)
    }
  };
}

export function sanitizeProviderConfig(config) {
  const provider = config?.provider === "openai" ? "openai" : "gemini";
  const model = String(config?.model || "").trim();
  if (!model || model.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(model)) throw new Error("Enter a valid provider model name");
  const allowedReasoning = new Set(["minimal", "low", "medium", "high"]);
  const reasoning = allowedReasoning.has(config?.reasoning) ? config.reasoning : "medium";
  return { provider, model, reasoning, temperature: provider === "gemini" ? 0 : undefined, apiVariant: provider === "openai" ? "responses" : undefined };
}
