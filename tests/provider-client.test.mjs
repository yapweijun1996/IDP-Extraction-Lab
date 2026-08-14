import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadClient() {
  const context = vm.createContext({
    URL,
    Date,
    JSON,
    Number,
    String,
    Error,
    AbortController,
    setTimeout,
    clearTimeout
  });
  context.self = context;
  vm.runInContext(
    await fs.readFile(new URL("../src/providers/provider-client.js", import.meta.url), "utf8"),
    context,
    { filename: "provider-client.js" }
  );
  return context.IdpProviderClient;
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("Gemini strict JSON request uses header auth and official structured-output fields", async () => {
  const client = await loadClient();
  let captured;
  const result = await client.request({
    config: { provider: "gemini", model: "gemini-test", reasoning: "medium" },
    apiKey: "sentinel-secret",
    prompt: "Return JSON",
    images: [{ dataUrl: "data:image/png;base64,AA==", bytes: 1 }],
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
  }, async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"ok\":true}" }] } }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, totalTokenCount: 14 }
    });
  });

  assert.equal(captured.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
  assert.equal(captured.init.headers["x-goog-api-key"], "sentinel-secret");
  assert.ok(!captured.url.includes("sentinel-secret"));
  assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
  assert.equal(captured.body.generationConfig.responseJsonSchema.type, "object");
  assert.equal(captured.body.generationConfig.thinkingConfig.thinkingLevel, "medium");
  assert.equal(captured.body.generationConfig.temperature, 0);
  assert.equal("maxOutputTokens" in captured.body.generationConfig, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.usage)), { inputTokens: 11, outputTokens: 3, totalTokens: 14 });
  assert.equal(result.text, "{\"ok\":true}");
});

test("OpenAI strict JSON request uses Responses API text.format without token or temperature caps", async () => {
  const client = await loadClient();
  let captured;
  const result = await client.request({
    config: { provider: "openai", model: "gpt-test", reasoning: "low" },
    apiKey: "sentinel-openai-secret",
    prompt: "Return JSON",
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
  }, async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse({
      status: "completed",
      output: [{ content: [{ type: "output_text", text: "{\"ok\":true}" }] }],
      usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 }
    });
  });

  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.init.headers.authorization, "Bearer sentinel-openai-secret");
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.text.format.strict, true);
  assert.equal(captured.body.reasoning.effort, "low");
  assert.equal("temperature" in captured.body, false);
  assert.equal("max_output_tokens" in captured.body, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.usage)), { inputTokens: 7, outputTokens: 2, totalTokens: 9 });
});

test("Provider client rejects non-base64 visual evidence before network", async () => {
  const client = await loadClient();
  await assert.rejects(
    client.request({
      config: { provider: "gemini", model: "gemini-test" },
      apiKey: "secret",
      prompt: "x",
      images: [{ dataUrl: "https://example.invalid/image.png" }]
    }, async () => { throw new Error("network should not run"); }),
    /valid base64 data URL/
  );
});
