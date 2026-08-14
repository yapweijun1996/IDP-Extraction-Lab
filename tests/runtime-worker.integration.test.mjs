import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../src/", import.meta.url);
const scripts = [
  "contracts/inspection-action-config.js",
  "validation/structured-json.js",
  "contracts/extraction-prompt.js",
  "providers/provider-page-normalizer.js",
  "i18n/localization.js",
  "validation/validation-core.js",
  "providers/provider-client.js"
];

function primaryPage() {
  const state = (value) => ({ value, status: "verified", confidence: 0.98, box_2d: null });
  return {
    page_number: 1,
    document_fields: { po_number: state("PO-1") },
    line_items: [{ fields: { sn: state(1), stock_code: state("SKU-1"), amount: state("10.00") }, source_box_2d: null }],
    totals: { grand_total: state("10.00") }
  };
}

function fakeProvider(prompt) {
  prompt = String(prompt || "");
  let value;
  if (prompt.startsWith("Locate only the listed evidence targets")) {
    const targets = JSON.parse(prompt.slice(prompt.lastIndexOf("Targets: ") + 9));
    const boxes = {
      row: [350, 100, 450, 900],
      document_field: [60, 600, 120, 900],
      total_field: [700, 600, 770, 900]
    };
    value = { regions: targets.map((target) => ({ target_id: target.target_id, box_2d: boxes[target.kind] || boxes.document_field })) };
  } else if (prompt.startsWith("Targeted visual reread only")) {
    const fields = JSON.parse(prompt.slice(prompt.lastIndexOf("Fields: ") + 8));
    value = {
      observations: fields.map((field) => ({
        field_path: field.path,
        inspection_id: field.inspection_id,
        views: [
          { view: "original", observed_value: field.current, confidence: 0.98 },
          { view: "enhanced", observed_value: field.current, confidence: 0.98 }
        ],
        explanation: "Two deterministic views agree"
      }))
    };
  } else value = primaryPage();
  return value;
}

async function fakeFetch(url, init, requests = null) {
  const requestUrl = String(url);
  const body = JSON.parse(init.body);
  requests?.push({ url: requestUrl, authorization: init.headers?.authorization || "" });
  if (requestUrl === "https://gpt.yapweijun1996.com/v1/responses") {
    assert.match(init.headers.authorization, /^Bearer\s+\S+$/);
    const prompt = body.input?.flatMap((item) => item.content || []).find((part) => typeof part.text === "string")?.text || "";
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: "completed",
          output: [{ content: [{ type: "output_text", text: JSON.stringify(fakeProvider(prompt)) }] }],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
        };
      }
    };
  }
  assert.match(requestUrl, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
  const prompt = body.contents[0].parts.find((part) => typeof part.text === "string")?.text || "";
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(fakeProvider(prompt)) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
      };
    }
  };
}

async function createWorkerHarness() {
  const messages = [];
  const providerRequests = [];
  let resolveResult;
  const completed = new Promise((resolve) => { resolveResult = resolve; });
  const context = vm.createContext({
    console,
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    TypeError,
    structuredClone,
    atob,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    AbortController,
    fetch: (url, init) => fakeFetch(url, init, providerRequests),
    importScripts: () => {},
    Agrun: {
      defineAction: (spec) => spec,
      createRuntime: () => ({ run: async (input) => {
        assert.equal("temperature" in input, false);
        assert.equal("maxOutputTokens" in input, false);
        return { finalAnswer: "STOP", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } };
      } }),
      geminiBrowserSkill: {},
      openaiBrowserSkill: {}
    }
  });
  context.self = context;
  context.postMessage = (message) => {
    messages.push(structuredClone(message));
    if (message.type === "tool_request") {
      const result = message.tool === "render_page"
        ? { page: 1, dpi: 144, width: 1000, height: 1400, bytes: 100, hash: "page-hash", dataUrl: "data:image/jpeg;base64,AA==" }
        : {
            page: 1,
            bbox: message.args.bbox,
            views: [
              { kind: "original", hash: `original-${message.requestId}`, bytes: 10, dataUrl: "data:image/png;base64,AA==" },
              { kind: "enhanced", hash: `enhanced-${message.requestId}`, bytes: 10, dataUrl: "data:image/png;base64,AA==" }
            ]
          };
      queueMicrotask(() => context.self.onmessage({ data: { type: "tool_result", requestId: message.requestId, result } }));
    }
    if (message.type === "result") resolveResult(message);
  };
  for (const name of scripts) vm.runInContext(await fs.readFile(new URL(name, root), "utf8"), context, { filename: name });
  vm.runInContext(await fs.readFile(new URL("runtime/runtime-worker.js", root), "utf8"), context, { filename: "runtime-worker.js" });
  return { context, messages, completed, providerRequests };
}

function testContract() {
  return {
    schemaVersion: "idp_extraction_contract_v1",
    documentType: "purchase_order",
    advancedPrompt: "",
    documentFields: [{ key: "po_number", label: "PO Number", type: "text", required: true }],
    lineItemFields: [
      { key: "sn", label: "S/N", type: "number", required: true },
      { key: "stock_code", label: "Stock Code", type: "text", required: true },
      { key: "amount", label: "Amount", type: "number", required: true }
    ],
    totalFields: [{ key: "grand_total", label: "Grand Total", type: "number", required: true }]
  };
}

test("Worker state machine localizes mandatory evidence, rereads crops, and completes deterministically", async () => {
  const { context, messages, completed } = await createWorkerHarness();
  const contract = testContract();
  await context.self.onmessage({ data: {
    type: "run",
    requestId: "test-request",
    runId: "test-run",
    fileName: "synthetic.pdf",
    documentHash: "hash",
    pageCount: 1,
    contract,
    config: { provider: "gemini", model: "test-model", reasoning: "medium" },
    apiKey: "test-key"
  } });
  const message = await completed;
  assert.equal(message.error, undefined);
  assert.equal(message.result.status, "completed");
  assert.deepEqual(JSON.parse(JSON.stringify(message.result.agent.localization)), { located_targets: 3, unlocated_targets: 0, localization_failed: 0, localization_budget_exhausted: 0 });
  assert.equal(message.result.agent.reinspections, 3);
  assert.equal(message.result.agent.model_calls, 4);
  assert.equal(message.result.validation.financial_check.status, "not_evaluated");
  assert.ok(message.result.pages[0].line_items[0].source_bbox);
  assert.ok(message.result.field_states.document_fields.po_number.provenance);
  assert.ok(message.result.field_states.totals.grand_total.provenance);
  const events = messages.filter((entry) => entry.type === "event").map((entry) => entry.event);
  assert.ok(events.some((event) => event.step === "forced_localization" && event.status === "complete"));
  assert.ok(events.some((event) => event.step === "inspect_region" && event.status === "complete"));
  assert.ok(events.some((event) => event.step === "targeted_reread" && event.status === "complete"));
  assert.ok(events.some((event) => event.step === "provenance_commit" && event.status === "complete"));
  assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1));
});

test("Worker accepts the embedded XOR Gateway credential when apiKey is null", async () => {
  const { context, messages, completed, providerRequests } = await createWorkerHarness();
  await context.self.onmessage({ data: {
    type: "run",
    requestId: "gateway-request",
    runId: "gateway-run",
    fileName: "synthetic.pdf",
    documentHash: "hash",
    pageCount: 1,
    contract: testContract(),
    config: { provider: "xorgateway", model: "gateway-test", reasoning: "medium" },
    apiKey: null
  } });
  const message = await completed;
  assert.equal(message.error, undefined);
  assert.equal(message.result.status, "completed");
  assert.ok(providerRequests.some(({ url, authorization }) => url === "https://gpt.yapweijun1996.com/v1/responses" && /^Bearer\s+\S+$/.test(authorization)));
  assert.ok(messages.some((entry) => entry.type === "event" && entry.event.step === "runtime" && entry.event.status === "complete"));
});

test("Worker still rejects a missing user key for non-embedded providers", async () => {
  const { context, completed, providerRequests } = await createWorkerHarness();
  await context.self.onmessage({ data: {
    type: "run",
    requestId: "missing-key-request",
    runId: "missing-key-run",
    fileName: "synthetic.pdf",
    documentHash: "hash",
    pageCount: 1,
    contract: testContract(),
    config: { provider: "gemini", model: "test-model", reasoning: "medium" },
    apiKey: null
  } });
  const message = await completed;
  assert.equal(message.error, "Provider key is not configured");
  assert.equal(providerRequests.length, 0);
});
