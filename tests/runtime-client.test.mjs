import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuntimeClient } from "../src/runtime/runtime-client.mjs";

test("Worker failure telemetry is preserved on the rejected runtime error", async () => {
  const client = new AgentRuntimeClient(null);
  const failure = { model_calls: 60, inspections: 42, iterations: 9, pages_processed: 8, elapsed_ms: 500000, localization: { located_targets: 70, unlocated_targets: 12 } };
  const rejected = new Promise((resolve) => client.pending.set("request-1", { resolve: () => resolve(null), reject: resolve }));
  await client.handle({ type: "result", requestId: "request-1", error: "Model call limit reached", failure });
  const error = await rejected;
  assert.equal(error.message, "Model call limit reached");
  assert.deepEqual(error.failure, failure);
});
