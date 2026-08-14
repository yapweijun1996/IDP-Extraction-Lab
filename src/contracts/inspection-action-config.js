(function (root) {
  "use strict";

  const definition = Object.freeze({
    name: "inspect_region",
    description: "Create deterministic evidence-preserving crops for allowlisted suspicious fields.",
    planner: Object.freeze({
      guidance: "Call inspect_region only when a deterministic validation issue can plausibly be resolved by stronger visual evidence. Use the supplied target_id, select only its allowlisted fields on the current page, use the smallest tight box_2d that contains the relevant evidence, and STOP when a closer view is unlikely to resolve the issue.",
      argsSchema: Object.freeze({
        regions: Object.freeze({
          type: "array",
          required: true,
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              target_id: Object.freeze({ type: "string", required: true }),
              field_paths: Object.freeze({ type: "array", items: Object.freeze({ type: "string" }), required: true }),
              box_2d: Object.freeze({ type: "array", items: Object.freeze({ type: "integer" }), required: true }),
              scale: Object.freeze({ type: "number" }),
              render_dpi: Object.freeze({ type: "number" })
            }),
            required: Object.freeze(["target_id", "field_paths", "box_2d"])
          })
        })
      })
    }),
    tier: 1,
    outputSchema: Object.freeze({
      kinds: Object.freeze(["inspection_result"]),
      controls: Object.freeze(["complete"])
    })
  });

  root.IdpInspectionActionConfig = Object.freeze({
    definition,
    createSpec(execute) {
      if (typeof execute !== "function") throw new Error("inspect_region execute must be a function");
      return { ...definition, execute };
    }
  });
})(typeof self !== "undefined" ? self : globalThis);
