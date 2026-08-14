import test from "node:test";
import assert from "node:assert/strict";
import { safeTraceEvent, safeTraceNdjson, traceMetricsLabel } from "../src/runtime/telemetry.mjs";

test("telemetry keeps diagnostic fields but removes sensitive payloads", () => {
  const event = safeTraceEvent({
    seq: 3,
    at: "2026-08-14T12:00:00.000Z",
    phase: "reinspecting",
    step: "forced_localization",
    status: "error",
    call_id: "call-3",
    target_ids: ["/pages/0/line_items/0"],
    error_code: "malformed_locator_json",
    message: "api_key=secret data:image/png;base64,AAAA C:\\Users\\person\\source.pdf",
    prompt: "must never export",
    raw_response: "must never export",
    metrics: { latency_ms: 1840, input_tokens: 12, output_tokens: 4, total_tokens: 16 }
  });
  const serialized = JSON.stringify(event);
  assert.match(serialized, /malformed_locator_json/);
  assert.match(serialized, /1840/);
  assert.doesNotMatch(serialized, /secret|AAAA|source\.pdf|must never export/);
  assert.equal(event.prompt, undefined);
  assert.equal(event.raw_response, undefined);
  assert.equal(traceMetricsLabel(event), "call-3 · 1840 ms · 16 tokens · malformed_locator_json");
});

test("NDJSON trace export contains one sanitized event per line", () => {
  const output = safeTraceNdjson([{ seq: 1, message: "safe" }, { seq: 2, message: "sk-secretvalue" }]);
  const lines = output.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].seq, 1);
  assert.doesNotMatch(output, /sk-secretvalue/);
});
