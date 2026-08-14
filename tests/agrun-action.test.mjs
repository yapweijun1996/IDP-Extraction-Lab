import test from "node:test";
import assert from "node:assert/strict";

await import("../src/contracts/inspection-action-config.js");
await import("../vendor/agrun.js");
const Agrun = globalThis.Agrun;

test("inspect_region definition satisfies the installed agrun contract", () => {
  const action = Agrun.defineAction(globalThis.IdpInspectionActionConfig.createSpec(async () => ({
    control: "complete",
    output: { kind: "inspection_result", inspections: [] }
  })));
  assert.equal(action.name, "inspect_region");
  assert.ok(action.planner.argsSchema.regions.items.required.includes("target_id"));
  assert.match(action.planner.guidance, /deterministic validation issue/i);
});

test("installed agrun rejects an action without planner guidance", () => {
  const valid = globalThis.IdpInspectionActionConfig.createSpec(async () => ({ control: "complete", output: { kind: "inspection_result" } }));
  assert.throws(() => Agrun.defineAction({ ...valid, planner: { ...valid.planner, guidance: "" } }), /planner\.guidance/);
});
