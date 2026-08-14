/* global Agrun, IdpExtractionPrompt, IdpInspectionActionConfig, IdpLocalization, IdpProviderClient, IdpProviderPageNormalizer, IdpStructuredJson, IdpValidation */
"use strict";

importScripts(
  "./vendor/agrun.js",
  "./inspection-action-config.js",
  "./structured-json.js",
  "./extraction-prompt.js",
  "./provider-client.js",
  "./provider-page-normalizer.js",
  "./localization.js",
  "./validation-core.js"
);

// Fail before the first paid request when the local agrun Action contract drifts.
Agrun.defineAction(IdpInspectionActionConfig.createSpec(async () => ({
  control: "complete",
  output: { kind: "inspection_result", inspections: [] }
})));

const limits = Object.freeze({
  maxIterations: 5,
  maxCalls: 60,
  maxRegions: 6,
  maxAttemptsPerIssue: 2,
  timeoutMs: 10 * 60 * 1000
});
const disabledActions = [
  "read_url", "web_search", "remember", "spawn_subagent", "todo_plan", "todo_advance", "todo_cancel",
  "workspace_create", "workspace_update", "workspace_read", "workspace_list", "workspace_write",
  "workspace_replace", "workspace_append", "workspace_insert", "workspace_propose_patch", "workspace_apply_patch",
  "write_file", "read_file", "list_files", "shell", "computer_use", "ask_clarification", "image_generation",
  "code_interpreter", "file_search"
];

let cancelled = false;
let toolSequence = 0;
let executionContext = {};
let activeRun = null;
const toolPending = new Map();

function send(type, value = {}) {
  self.postMessage({ type, ...value });
}

function escapeSecret(message, key) {
  return String(message || "Unknown provider error")
    .split(String(key || "__never__")).join("[redacted]")
    .replace(/data:[^\s,]+;base64,[A-Za-z0-9+/=]+/gi, "[image data redacted]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "AIza...[redacted]")
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1...[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function finite(value) {
  if (typeof value === "object" && value !== null && Number.isFinite(Number(value.total))) return Number(value.total);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usageMetrics(usage, latencyMs, imageBytes) {
  const source = usage || {};
  const input = finite(source.input_tokens ?? source.inputTokens ?? source.promptTokenCount ?? source.prompt_tokens);
  const output = finite(source.output_tokens ?? source.outputTokens ?? source.candidatesTokenCount ?? source.completion_tokens);
  const total = finite(source.total_tokens ?? source.totalTokens ?? source.totalTokenCount) ?? (input !== null && output !== null ? input + output : null);
  return {
    latency_ms: finite(latencyMs),
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    image_bytes: finite(imageBytes)
  };
}

function emit(runOrId, phase, step, status, extra = {}) {
  const run = runOrId && typeof runOrId === "object" ? runOrId : null;
  const runId = run ? run.runId : String(runOrId || "");
  const seq = run ? ++run.telemetrySequence : finite(extra.seq);
  const event = {
    seq,
    at: new Date().toISOString(),
    runId,
    phase,
    step,
    status,
    ...(finite(extra.page) !== null ? { page: finite(extra.page) } : {}),
    ...(extra.call_id ? { call_id: String(extra.call_id) } : {}),
    ...(extra.target_id ? { target_id: String(extra.target_id) } : {}),
    ...(Array.isArray(extra.target_ids) ? { target_ids: extra.target_ids.map(String) } : {}),
    ...(Array.isArray(extra.field_paths) ? { field_paths: extra.field_paths.map(String) } : {}),
    ...(Array.isArray(extra.issue_codes) ? { issue_codes: extra.issue_codes.map(String) } : {}),
    ...(extra.error_code ? { error_code: String(extra.error_code) } : {}),
    ...(extra.rejection_reason ? { rejection_reason: String(extra.rejection_reason) } : {}),
    ...(extra.inspection_id ? { inspection_id: String(extra.inspection_id) } : {}),
    ...(extra.localization_source ? { localization_source: String(extra.localization_source) } : {}),
    ...(IdpLocalization.validNormalizedBbox(extra.bbox) ? { bbox: { ...extra.bbox } } : {}),
    ...(Array.isArray(extra.decisions) ? { decisions: extra.decisions.map((decision) => ({
      field_path: String(decision.field_path || ""),
      decision: String(decision.decision || ""),
      reason: String(decision.reason || "")
    })) } : {}),
    ...(extra.metrics ? { metrics: usageMetrics(extra.metrics.usage || extra.metrics, extra.metrics.latency_ms, extra.metrics.image_bytes) } : {}),
    message: escapeSecret(extra.message || "", run?.apiKey)
  };
  executionContext = { runId, phase, step, page: event.page || executionContext.page || null };
  if (run) {
    run.telemetry.push(event);
    if (run.telemetry.length > 4000) run.telemetry.splice(0, run.telemetry.length - 4000);
  }
  send("event", { event });
  return event;
}

function tool(toolName, args) {
  const requestId = `tool_${++toolSequence}`;
  send("tool_request", { requestId, tool: toolName, args });
  return new Promise((resolve, reject) => toolPending.set(requestId, { resolve, reject }));
}

function parseJson(text, accepts) {
  return IdpStructuredJson.parse(text, accepts);
}

function bbox(value) {
  return IdpLocalization.toNormalizedBbox(value);
}

function getState(pages, pointer) {
  const parts = String(pointer || "").split("/").slice(1);
  const page = pages[Number(parts[1])];
  if (!page) return null;
  if (parts[2] === "line_items") return page.line_items[Number(parts[3])]?.fields?.[parts[5]] || null;
  return page[parts[2]]?.[parts[3]] || null;
}

function fieldDefinition(contract, key) {
  return [...contract.documentFields, ...contract.lineItemFields, ...contract.totalFields].find((field) => field.key === key);
}

function responseSchema(contract) {
  const state = (field) => ({
    type: "object",
    additionalProperties: false,
    required: ["value", "status", "confidence", "box_2d"],
    properties: {
      value: field.type === "boolean"
        ? { anyOf: [{ type: "boolean" }, { type: "null" }] }
        : field.type === "number"
          ? { anyOf: [{ type: "number" }, { type: "string" }, { type: "null" }] }
          : { anyOf: [{ type: "string" }, { type: "null" }] },
      status: { type: "string", enum: ["verified", "uncertain", "missing", "not_present"] },
      confidence: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
      box_2d: { anyOf: [{ type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 }, { type: "null" }] }
    }
  });
  const objectFor = (fields) => ({
    type: "object",
    additionalProperties: false,
    required: fields.map((field) => field.key),
    properties: Object.fromEntries(fields.map((field) => [field.key, state(field)]))
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["page_number", "document_fields", "line_items", "totals"],
    properties: {
      page_number: { type: "integer" },
      document_fields: objectFor(contract.documentFields),
      line_items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fields", "source_box_2d"],
          properties: {
            fields: objectFor(contract.lineItemFields),
            source_box_2d: { anyOf: [{ type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 }, { type: "null" }] }
          }
        }
      },
      totals: objectFor(contract.totalFields)
    }
  };
}

function locatorSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["regions"],
    properties: {
      regions: {
        type: "array",
        maxItems: limits.maxRegions,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["target_id", "box_2d"],
          properties: {
            target_id: { type: "string" },
            box_2d: { type: "array", minItems: 4, maxItems: 4, items: { type: "integer", minimum: 0, maximum: 1000 } }
          }
        }
      }
    }
  };
}

function rereadSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["observations"],
    properties: {
      observations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field_path", "inspection_id", "views", "explanation"],
          properties: {
            field_path: { type: "string" },
            inspection_id: { type: "string" },
            views: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["view", "observed_value", "confidence"],
                properties: {
                  view: { type: "string", enum: ["original", "enhanced"] },
                  observed_value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] },
                  confidence: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] }
                }
              }
            },
            explanation: { type: "string" }
          }
        }
      }
    }
  };
}

function allowedFetch(provider) {
  const expected = provider === "openai" ? "api.openai.com" : "generativelanguage.googleapis.com";
  return async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" || parsed.hostname !== expected) throw new Error("Provider endpoint rejected by allowlist");
    if (String(init?.method || "POST").toUpperCase() !== "POST") throw new Error("Provider method rejected by allowlist");
    return fetch(url, { ...init, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  };
}

function countCall(run) {
  if (run.modelCalls >= limits.maxCalls) {
    const error = new Error("Model call limit reached");
    error.idpCode = "localization_budget_exhausted";
    throw error;
  }
  run.modelCalls += 1;
}

async function providerCall(config, apiKey, prompt, images = [], schema = null, reasoningOverride = null) {
  if (cancelled) throw new Error("Run cancelled");
  return IdpProviderClient.request({ config, apiKey, prompt, images, schema, reasoningOverride, timeoutMs: 120000 }, allowedFetch(config.provider));
}

async function instrumentedProviderCall(run, context, prompt, images = [], schema = null, reasoningOverride = null) {
  countCall(run);
  const callId = `call-${++run.callSequence}`;
  const started = Date.now();
  const imageBytes = images.reduce((sum, image) => sum + Number(image.bytes || 0), 0);
  emit(run, context.phase, context.step, "start", {
    page: context.page,
    call_id: callId,
    target_ids: context.target_ids,
    field_paths: context.field_paths,
    message: context.startMessage || "Provider request started",
    metrics: { image_bytes: imageBytes }
  });
  try {
    const response = await providerCall(run.config, run.apiKey, prompt, images, schema, reasoningOverride);
    emit(run, context.phase, context.step, "complete", {
      page: context.page,
      call_id: callId,
      target_ids: context.target_ids,
      field_paths: context.field_paths,
      message: context.completeMessage || "Provider request completed",
      metrics: { latency_ms: response.durationMs ?? Date.now() - started, usage: response.usage, image_bytes: imageBytes }
    });
    return response;
  } catch (error) {
    const code = error.idpCode || context.errorCode || "provider_error";
    error.idpCode = code;
    emit(run, context.phase, context.step, "error", {
      page: context.page,
      call_id: callId,
      target_ids: context.target_ids,
      field_paths: context.field_paths,
      error_code: code,
      message: escapeSecret(error?.message || error, run.apiKey),
      metrics: { latency_ms: Date.now() - started, image_bytes: imageBytes }
    });
    throw error;
  }
}

function targetDescriptor(target, page, contract) {
  const row = target.kind === "row" ? page.line_items?.[target.rowIndex] : null;
  return {
    target_id: target.id,
    kind: target.kind,
    page: page.page_number,
    printed_sn: row?.fields?.sn?.value ?? null,
    stock_code: row?.fields?.stock_code?.value ?? null,
    row_number: target.rowIndex === null ? null : target.rowIndex + 1,
    bbox_hint: target.bbox_hint,
    issue_codes: target.issue_codes,
    fields: target.field_paths.map((path) => ({
      path,
      label: fieldDefinition(contract, path.split("/").at(-1))?.label || path.split("/").at(-1),
      current_value: IdpLocalization.stateAt(page, path)?.value ?? null,
      current_status: IdpLocalization.stateAt(page, path)?.status || "missing"
    }))
  };
}

function decisionPrompt(pageNumber, targets, page, contract) {
  return [
    "You are a bounded visual localization agent.",
    "Use inspect_region only when stronger visual evidence can resolve a listed deterministic issue.",
    `Use only page ${pageNumber}. Call inspect_region at most once with at most ${limits.maxRegions} tight regions.`,
    "Use only supplied target_id and field paths. Return box_2d=[ymin,xmin,ymax,xmax] integer coordinates in 0..1000.",
    "Never request a whole-page region or more than 50% of the page. STOP when no listed target can be localized.",
    `Targets: ${JSON.stringify(targets.map((target) => targetDescriptor(target, page, contract)))}`
  ].join("\n");
}

function locatorPrompt(page, targets, contract) {
  return [
    "Locate only the listed evidence targets on this single page.",
    "Return JSON {regions:[{target_id,box_2d}]} with tight box_2d=[ymin,xmin,ymax,xmax] integers in 0..1000.",
    "For a row target, box the complete printed row and use the printed S/N and Stock Code as anchors.",
    "For a field target, box only the label/value evidence. Never return a whole-table or whole-page box.",
    "Return an empty regions array when the source cannot be located. Do not invent a region.",
    `Targets: ${JSON.stringify(targets.map((target) => targetDescriptor(target, page, contract)))}`
  ].join("\n");
}

function spendTargetAttempt(target, attempts) {
  for (const key of target.attempt_keys?.length ? target.attempt_keys : [target.id]) {
    attempts.set(key, (attempts.get(key) || 0) + 1);
  }
}

function targetAttemptsExhausted(target, attempts) {
  const keys = target.attempt_keys?.length ? target.attempt_keys : [target.id];
  return keys.length > 0 && keys.every((key) => (attempts.get(key) || 0) >= limits.maxAttemptsPerIssue);
}

function rejectionCode(region, target, sourceBbox, paths) {
  if (!target) return "unknown_target";
  if (!sourceBbox) return "invalid_bbox";
  if (!paths.length || paths.some((path) => !target.field_paths.includes(path))) return "unknown_target";
  return null;
}

async function decideInspections(run, page, pageImage, issues, attempts) {
  const targets = IdpLocalization.buildTargets(page, run.contract, issues, attempts, {
    maxRegions: limits.maxRegions,
    maxAttempts: limits.maxAttemptsPerIssue
  });
  if (!targets.length) return { inspections: [], targets: [] };

  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const inspections = [];
  const inspectedTargets = new Set();
  const attemptedTargets = new Set();

  const executeRegions = async (regions, source) => {
    const accepted = [];
    const rejected = [];
    if (!Array.isArray(regions) || regions.length > limits.maxRegions - inspections.length) {
      emit(run, "reinspecting", "region_localization", "error", {
        page: page.page_number,
        error_code: "no_region_returned",
        message: "Locator returned an invalid number of regions"
      });
      return { accepted, rejected: [{ code: "no_region_returned" }] };
    }
    for (const region of regions) {
      const target = targetMap.get(String(region?.target_id || ""));
      const paths = Array.isArray(region?.field_paths) && region.field_paths.length
        ? region.field_paths.map(String)
        : target?.field_paths || [];
      const sourceBbox = bbox(region?.box_2d);
      const code = inspectedTargets.has(target?.id) ? "unknown_target" : rejectionCode(region, target, sourceBbox, paths);
      if (code) {
        rejected.push({ target_id: region?.target_id || null, code });
        emit(run, "reinspecting", "region_localization", "error", {
          page: page.page_number,
          target_id: region?.target_id || null,
          error_code: code,
          rejection_reason: code,
          message: code === "invalid_bbox" ? "Locator box was outside the safe coordinate contract" : "Locator target was not in the current page allowlist"
        });
        continue;
      }

      attemptedTargets.add(target.id);
      spendTargetAttempt(target, attempts);
      emit(run, "reinspecting", "region_localization", "complete", {
        page: page.page_number,
        target_id: target.id,
        target_ids: [target.id],
        field_paths: paths,
        bbox: sourceBbox,
        localization_source: source,
        message: "Locator coordinates passed the target and bbox allowlist"
      });
      let inspection;
      try {
        inspection = await tool("inspect_region", {
          page: page.page_number,
          bbox: sourceBbox,
          scale: Math.min(4, Math.max(1, Number(region.scale || 2))),
          renderDpi: Math.min(500, Math.max(72, Number(region.render_dpi || 400))),
          padding: 0.02
        });
      } catch (error) {
        rejected.push({ target_id: target.id, code: "crop_failed" });
        emit(run, "reinspecting", "inspect_region", "error", {
          page: page.page_number,
          target_id: target.id,
          target_ids: [target.id],
          field_paths: paths,
          bbox: sourceBbox,
          error_code: "crop_failed",
          message: escapeSecret(error?.message || "Deterministic crop failed", run.apiKey)
        });
        continue;
      }
      inspection.target_id = target.id;
      inspection.target = target;
      inspection.page = page.page_number;
      inspection.bbox = sourceBbox;
      inspection.field_paths = paths;
      inspection.inspection_id = `${run.runId}-inspection-${run.inspections + 1}`;
      inspections.push(inspection);
      accepted.push(target.id);
      inspectedTargets.add(target.id);
      run.inspections += 1;
      emit(run, "reinspecting", "inspect_region", "complete", {
        page: page.page_number,
        target_id: target.id,
        target_ids: [target.id],
        field_paths: paths,
        bbox: sourceBbox,
        inspection_id: inspection.inspection_id,
        localization_source: source,
        message: "Deterministic original and enhanced crop views were created"
      });
    }
    return { accepted, rejected };
  };

  const action = Agrun.defineAction(IdpInspectionActionConfig.createSpec(async (_context, args) => {
    await executeRegions(args?.regions, "agrun");
    return {
      control: "complete",
      output: {
        kind: "inspection_result",
        inspections: inspections.map((inspection) => ({ inspection_id: inspection.inspection_id, target_id: inspection.target_id, page: inspection.page }))
      }
    };
  }));
  const skill = run.config.provider === "openai" ? Agrun.openaiBrowserSkill : Agrun.geminiBrowserSkill;
  const runtime = Agrun.createRuntime({
    skills: [skill],
    customActions: [action],
    maxSteps: 2,
    globalMemory: { enabled: false },
    disabledActions,
    actionPolicy: { inspect_region: "allow" }
  });

  const agentCallId = `call-${++run.callSequence}`;
  const agentStarted = Date.now();
  emit(run, "reinspecting", "agent_decision", "start", {
    page: page.page_number,
    call_id: agentCallId,
    target_ids: targets.map((target) => target.id),
    message: "Agent is deciding whether and where stronger visual evidence is needed",
    metrics: { image_bytes: pageImage.bytes }
  });
  let decisionResult = null;
  try {
    countCall(run);
    decisionResult = await runtime.run({
      provider: run.config.provider,
      apiKey: run.apiKey,
      model: run.config.model,
      prompt: decisionPrompt(page.page_number, targets, page, run.contract),
      parts: [{ type: "image", url: pageImage.dataUrl, mimeType: "image/jpeg", bytes: pageImage.bytes }],
      fetch: allowedFetch(run.config.provider),
      apiVariant: run.config.provider === "openai" ? "responses" : undefined,
      reasoningEffort: run.config.provider === "openai" ? "minimal" : undefined,
      thinkingLevel: run.config.provider === "gemini" ? "minimal" : undefined
    });
    if (decisionResult?.error) {
      const runtimeError = new Error(decisionResult.error.message || "agrun planner returned an error");
      runtimeError.idpCode = "agent_runtime_error";
      throw runtimeError;
    }
    emit(run, "reinspecting", "agent_decision", "complete", {
      page: page.page_number,
      call_id: agentCallId,
      target_ids: targets.map((target) => target.id),
      message: inspections.length ? `Agent selected ${inspections.length} accepted region(s)` : "Agent returned STOP without an accepted region",
      metrics: { latency_ms: Date.now() - agentStarted, usage: decisionResult?.usage, image_bytes: pageImage.bytes }
    });
  } catch (error) {
    emit(run, "reinspecting", "agent_decision", "error", {
      page: page.page_number,
      call_id: agentCallId,
      target_ids: targets.map((target) => target.id),
      error_code: "agent_runtime_error",
      message: escapeSecret(error?.message || error, run.apiKey),
      metrics: { latency_ms: Date.now() - agentStarted, image_bytes: pageImage.bytes }
    });
  }

  const forced = IdpLocalization.mandatoryTargetsWithoutInspection(targets, inspections)
    .slice(0, limits.maxRegions - inspections.length);
  if (forced.length && run.modelCalls < limits.maxCalls) {
    const hinted = forced.filter((target) => target.bbox_hint);
    const locate = forced.filter((target) => !target.bbox_hint);
    if (hinted.length) {
      await executeRegions(hinted.map((target) => ({ target_id: target.id, field_paths: target.field_paths, box_2d: target.bbox_hint })), "existing_provenance");
    }
    if (locate.length) {
      let parsed = null;
      try {
        const response = await instrumentedProviderCall(run, {
          phase: "reinspecting",
          step: "forced_localization",
          page: page.page_number,
          target_ids: locate.map((target) => target.id),
          errorCode: "provider_error",
          startMessage: "Strict locator is finding mandatory source regions",
          completeMessage: "Strict locator provider response completed"
        }, locatorPrompt(page, locate, run.contract), [{ ...pageImage, mimeType: "image/jpeg", filename: `page-${page.page_number}-locator.jpg` }], locatorSchema(), "minimal");
        try {
          parsed = parseJson(response.text, (value) => value && Array.isArray(value.regions));
        } catch {
          const malformed = new Error("Locator response did not contain a valid regions array");
          malformed.idpCode = "malformed_locator_json";
          throw malformed;
        }
        if (!parsed.regions.length) {
          const empty = new Error("Locator returned no region for the mandatory targets");
          empty.idpCode = "no_region_returned";
          throw empty;
        }
        const outcome = await executeRegions(parsed.regions, "forced_locator");
        emit(run, "reinspecting", "forced_localization", outcome.accepted.length ? "complete" : "error", {
          page: page.page_number,
          target_ids: locate.map((target) => target.id),
          error_code: outcome.accepted.length ? undefined : outcome.rejected[0]?.code || "no_region_returned",
          message: `${outcome.accepted.length} strict localization region(s) accepted; ${outcome.rejected.length} rejected`
        });
      } catch (error) {
        const code = error.idpCode || "provider_error";
        if (code !== "provider_error") {
          emit(run, "reinspecting", "forced_localization", "error", {
            page: page.page_number,
            target_ids: locate.map((target) => target.id),
            error_code: code,
            message: escapeSecret(error?.message || error, run.apiKey)
          });
        }
      }
    }
  }

  const accepted = new Set(inspections.map((inspection) => inspection.target_id));
  for (const target of forced) {
    if (accepted.has(target.id)) continue;
    if (!attemptedTargets.has(target.id)) spendTargetAttempt(target, attempts);
    const exhausted = targetAttemptsExhausted(target, attempts);
    if (target.mandatory) IdpLocalization.markLocalization(page, target, exhausted ? "budget_exhausted" : "failed");
    emit(run, "reinspecting", "localization_result", exhausted ? "error" : "warning", {
      page: page.page_number,
      target_id: target.id,
      target_ids: [target.id],
      field_paths: target.field_paths,
      error_code: exhausted ? "localization_budget_exhausted" : "no_region_returned",
      message: exhausted ? "Target exhausted its bounded localization attempts" : "Target remains unlocalized after this attempt"
    });
  }

  return { inspections, targets };
}

async function targetedReread(run, page, inspections, contract) {
  if (!inspections.length) return [];
  const fields = inspections.flatMap((inspection) => inspection.field_paths.map((path) => ({
    path,
    label: fieldDefinition(contract, path.split("/").at(-1))?.label || path.split("/").at(-1),
    current: getState(run.pages, path)?.value ?? null,
    target_id: inspection.target_id,
    inspection_id: inspection.inspection_id
  })));
  const prompt = [
    "Targeted visual reread only. Read only the listed fields from the supplied original and enhanced crops.",
    "Return one observation per field with exactly two views: original and enhanced.",
    "Each view returns observed_value and calibrated confidence. Use null when unclear.",
    "For row targets, verify printed S/N and Stock Code before other fields. Never change unrelated fields.",
    `Fields: ${JSON.stringify(fields)}`
  ].join("\n");
  const images = inspections.flatMap((inspection) => (inspection.views || []).map((view) => ({
    ...view,
    filename: `${inspection.inspection_id}-${view.kind}.png`
  })));
  const response = await instrumentedProviderCall(run, {
    phase: "reinspecting",
    step: "targeted_reread",
    page: page.page_number,
    target_ids: inspections.map((inspection) => inspection.target_id),
    field_paths: fields.map((field) => field.path),
    errorCode: "provider_error",
    startMessage: "Provider is rereading only authorized crop fields",
    completeMessage: "Targeted visual reread provider response completed"
  }, prompt, images, rereadSchema());
  try {
    return parseJson(response.text, (value) => value && Array.isArray(value.observations)).observations;
  } catch {
    const error = new Error("Targeted reread response did not contain a valid observations array");
    error.idpCode = "malformed_targeted_reread_json";
    emit(run, "reinspecting", "targeted_reread", "error", {
      page: page.page_number,
      target_ids: inspections.map((inspection) => inspection.target_id),
      field_paths: fields.map((field) => field.path),
      error_code: "malformed_targeted_reread_json",
      message: error.message
    });
    throw error;
  }
}

function reconcile(run, page, observations, inspections, contract, attempts) {
  const decisions = [];
  for (const inspection of inspections) {
    const targetObservations = observations.filter((observation) =>
      inspection.field_paths.includes(String(observation.field_path || ""))
      && (!observation.inspection_id || observation.inspection_id === inspection.inspection_id));
    const result = IdpLocalization.reconcileInspection(page, inspection.target, inspection, targetObservations, contract);
    decisions.push(...result.decisions);
    if (!result.committed && inspection.target.mandatory) {
      IdpLocalization.markLocalization(page, inspection.target, targetAttemptsExhausted(inspection.target, attempts) ? "budget_exhausted" : "failed");
    }
    emit(run, "reinspecting", "provenance_commit", result.committed ? "complete" : "warning", {
      page: page.page_number,
      target_id: inspection.target_id,
      target_ids: [inspection.target_id],
      field_paths: inspection.field_paths,
      bbox: inspection.bbox,
      inspection_id: inspection.inspection_id,
      error_code: result.committed ? undefined : "evidence_disagreement",
      message: result.committed ? `Verified provenance committed: ${result.reason}` : `Provenance not committed: ${result.reason}`
    });
  }
  return decisions;
}

function telemetrySummary(run) {
  const completedCalls = run.telemetry.filter((event) => event.call_id && event.status === "complete");
  const failedCalls = run.telemetry.filter((event) => event.call_id && event.status === "error");
  const sum = (key) => completedCalls.reduce((total, event) => total + Number(event.metrics?.[key] || 0), 0);
  const localization = IdpLocalization.coverage(run.pages, run.contract);
  return {
    model_calls: run.modelCalls,
    completed_calls: completedCalls.length,
    failed_calls: failedCalls.length,
    inspections: run.inspections,
    located_targets: localization.located_targets,
    unlocated_targets: localization.unlocated_targets,
    localization_failed: localization.localization_failed,
    localization_budget_exhausted: localization.localization_budget_exhausted,
    input_tokens: sum("input_tokens") || null,
    output_tokens: sum("output_tokens") || null,
    total_tokens: sum("total_tokens") || null,
    provider_latency_ms: sum("latency_ms"),
    estimated_cost_usd: null,
    actual_billed_cost_usd: null
  };
}

function aggregate(run, issues, elapsed) {
  const documentStates = Object.fromEntries(run.contract.documentFields.map((field) => [
    field.key,
    IdpValidation.selectAggregateState(run.pages, "document_fields", field.key)
  ]));
  const totalStates = Object.fromEntries(run.contract.totalFields.map((field) => [
    field.key,
    IdpValidation.selectAggregateState([...run.pages].reverse(), "totals", field.key)
  ]));
  const documentFields = Object.fromEntries(run.contract.documentFields.map((field) => [field.key, documentStates[field.key].value ?? null]));
  const totals = Object.fromEntries(run.contract.totalFields.map((field) => [field.key, totalStates[field.key].value ?? null]));
  const lineItems = run.pages.flatMap((page) => page.line_items.map((row) => ({
    ...Object.fromEntries(run.contract.lineItemFields.map((field) => [field.key, row.fields[field.key]?.value ?? null])),
    source_page: page.page_number,
    source_bbox: row.source_bbox
  })));
  const localization = IdpLocalization.coverage(run.pages, run.contract);
  const financialCheck = IdpValidation.evaluateFinancial(run.pages, run.contract);
  const lineItemCheck = IdpValidation.evaluateLineItems(run.pages, run.contract);
  const summary = telemetrySummary(run);
  return {
    schema_version: "idp_agentic_extraction_result_v1",
    run_id: run.runId,
    status: issues.length ? "completed_with_review" : "completed",
    document: { file_name: run.fileName, page_count: run.pageCount, source_sha256: run.documentHash },
    extraction_contract: run.contract,
    data: { document_fields: documentFields, line_items: lineItems, totals },
    pages: run.pages,
    field_states: {
      document_fields: documentStates,
      line_items: run.pages.flatMap((page) => page.line_items.map((row) => ({
        fields: row.fields,
        source_page: row.source_page,
        source_bbox: row.source_bbox,
        localization_status: row.localization_status || null
      }))),
      totals: totalStates
    },
    validation: {
      status: issues.length ? "needs_review" : "pass",
      issues,
      financial_check: financialCheck,
      line_item_check: lineItemCheck
    },
    agent: {
      iterations: run.iteration,
      reinspections: run.inspections,
      model_calls: run.modelCalls,
      corrections: run.corrections,
      localization,
      telemetry_summary: summary
    },
    usage: {
      elapsed_ms: elapsed,
      model_calls: run.modelCalls,
      input_tokens: summary.input_tokens,
      output_tokens: summary.output_tokens,
      total_tokens: summary.total_tokens,
      estimated_cost_usd: summary.estimated_cost_usd,
      actual_billed_cost_usd: summary.actual_billed_cost_usd
    }
  };
}

function reviewPathsFor(rawPage, semanticIssues, pageNumber, contract) {
  const explicit = semanticIssues.map((issue) => issue.path).filter((path) => /\/(document_fields|totals|line_items\/\d+\/fields)\//.test(path));
  if (explicit.length || !semanticIssues.length) return explicit;
  const paths = [];
  for (const field of contract.documentFields) if (rawPage.document_fields?.[field.key] != null) paths.push(`/pages/${pageNumber - 1}/document_fields/${field.key}`);
  for (const field of contract.totalFields) if (rawPage.totals?.[field.key] != null) paths.push(`/pages/${pageNumber - 1}/totals/${field.key}`);
  for (const [rowIndex, row] of (rawPage.line_items || []).entries()) for (const field of contract.lineItemFields) {
    if (row.fields?.[field.key] != null) paths.push(`/pages/${pageNumber - 1}/line_items/${rowIndex}/fields/${field.key}`);
  }
  return paths;
}

async function primaryAttempt(run, pageNumber, image, retry) {
  const basePrompt = IdpExtractionPrompt.primary(run.contract, pageNumber, run.pageCount);
  const prompt = retry ? `${basePrompt}\nReturn exactly one JSON object matching the supplied response schema. Do not append prose, Markdown, or a second JSON value.` : basePrompt;
  const response = await instrumentedProviderCall(run, {
    phase: "extracting",
    step: retry ? "structured_response_retry" : "primary_extraction",
    page: pageNumber,
    errorCode: "provider_error",
    startMessage: retry ? "Retrying the page extraction contract once" : `Extracting page ${pageNumber} of ${run.pageCount}`,
    completeMessage: retry ? "Structured extraction retry completed" : "Primary page extraction provider response completed"
  }, prompt, [{ ...image, mimeType: "image/jpeg", filename: `page-${pageNumber}.jpg` }], responseSchema(run.contract));
  const parsed = parseJson(response.text, (value) => IdpProviderPageNormalizer.accepts(value, run.contract));
  const rawPage = IdpProviderPageNormalizer.normalize(parsed, run.contract, pageNumber);
  const semanticIssues = IdpProviderPageNormalizer.semanticIssues(rawPage, run.contract, pageNumber);
  return { rawPage, semanticIssues, response };
}

async function extractPrimaryPage(run, pageNumber, image) {
  let first;
  try {
    first = await primaryAttempt(run, pageNumber, image, false);
    if (!first.semanticIssues.length) return first;
    emit(run, "extracting", "structured_response_retry", "warning", {
      page: pageNumber,
      issue_codes: [...new Set(first.semanticIssues.map((issue) => issue.code))],
      message: "Primary response was structurally parseable but semantically incomplete; retrying once"
    });
  } catch (error) {
    if (run.modelCalls >= limits.maxCalls) throw error;
    emit(run, "extracting", "structured_response_retry", "warning", {
      page: pageNumber,
      error_code: "provider_error",
      message: "Primary response did not match the active page contract; retrying once"
    });
  }
  const second = await primaryAttempt(run, pageNumber, image, true);
  if (second.semanticIssues.length) {
    emit(run, "extracting", "structured_response_retry", "warning", {
      page: pageNumber,
      issue_codes: [...new Set(second.semanticIssues.map((issue) => issue.code))],
      message: "Retry remained semantically incomplete; values were preserved as needs_review for bounded visual verification"
    });
  }
  return second;
}

async function executeRun(payload) {
  const started = Date.now();
  const run = {
    runId: payload.runId,
    fileName: payload.fileName,
    documentHash: payload.documentHash,
    pageCount: payload.pageCount,
    contract: payload.contract,
    config: payload.config,
    apiKey: payload.apiKey,
    pages: [],
    modelCalls: 0,
    callSequence: 0,
    telemetrySequence: 0,
    telemetry: [],
    iteration: 0,
    inspections: 0,
    corrections: [],
    startedAt: started
  };
  const attempts = new Map();
  activeRun = run;
  if (!run.apiKey) throw new Error("Provider key is not configured");
  emit(run, "preparing", "runtime", "complete", { message: `Browser worker initialized for ${run.config.provider}` });

  for (let pageNumber = 1; pageNumber <= run.pageCount; pageNumber += 1) {
    if (cancelled || Date.now() - started > limits.timeoutMs) throw new Error(cancelled ? "Run cancelled" : "Run time limit reached");
    if (run.modelCalls >= limits.maxCalls) throw new Error("Model call limit reached");
    const image = await tool("render_page", { page: pageNumber, dpi: 144 });
    const extracted = await extractPrimaryPage(run, pageNumber, image);
    const reviewPaths = reviewPathsFor(extracted.rawPage, extracted.semanticIssues, pageNumber, run.contract);
    const page = IdpValidation.normalizePage(extracted.rawPage, pageNumber, run.contract, { reviewPaths });
    run.pages.push(page);
    emit(run, "extracting", "primary_extraction_result", "complete", {
      page: pageNumber,
      issue_codes: [...new Set(extracted.semanticIssues.map((issue) => issue.code))],
      message: `${page.line_items.length} row(s) normalized; ${extracted.semanticIssues.length} semantic contract issue(s)`
    });

    let issues = IdpValidation.validatePage(page, run.contract);
    emit(run, "validating", "page_validation", "complete", {
      page: pageNumber,
      issue_codes: [...new Set(issues.map((issue) => issue.code))],
      message: `${issues.length} deterministic issue(s) detected`
    });

    for (let iteration = 1; issues.some((issue) => issue.repairable !== false) && iteration <= limits.maxIterations && run.modelCalls < limits.maxCalls; iteration += 1) {
      run.iteration += 1;
      const decision = await decideInspections(run, page, image, issues, attempts);
      const inspections = decision.inspections;
      if (!inspections.length) {
        issues = IdpValidation.validatePage(page, run.contract);
        const hasMandatory = decision.targets.some((target) => target.mandatory);
        const retryable = decision.targets.some((target) => target.mandatory && !targetAttemptsExhausted(target, attempts));
        if (retryable) continue;
        emit(run, "reinspecting", "stop", "warning", {
          page: pageNumber,
          error_code: hasMandatory ? "localization_budget_exhausted" : undefined,
          message: hasMandatory
            ? "Mandatory visual checks could not be verified within bounded attempts"
            : decision.targets.length ? "Agent stopped because no stronger visual evidence was justified" : "No actionable localization target remains"
        });
        break;
      }

      let observations;
      try {
        observations = await targetedReread(run, page, inspections, run.contract);
      } catch {
        for (const inspection of inspections) {
          IdpLocalization.markLocalization(page, inspection.target, targetAttemptsExhausted(inspection.target, attempts) ? "budget_exhausted" : "failed");
        }
        issues = IdpValidation.validatePage(page, run.contract);
        continue;
      }

      const decisions = reconcile(run, page, observations, inspections, run.contract, attempts);
      run.corrections.push(...decisions);
      emit(run, "reinspecting", "reconciliation", "complete", {
        page: pageNumber,
        target_ids: inspections.map((inspection) => inspection.target_id),
        decisions: decisions.map(({ field_path, decision, reason }) => ({ field_path, decision, reason })),
        message: `${decisions.filter((decision) => decision.decision === "replace").length} replacement(s), ${decisions.filter((decision) => decision.decision === "keep").length} verified keep(s)`
      });
      const next = IdpValidation.validatePage(page, run.contract);
      const unchanged = JSON.stringify(next.map((issue) => [issue.code, issue.path])) === JSON.stringify(issues.map((issue) => [issue.code, issue.path]));
      issues = next;
      if (unchanged && !inspections.some((inspection) => !targetAttemptsExhausted(inspection.target, attempts))) {
        emit(run, "reinspecting", "stop", "warning", {
          page: pageNumber,
          error_code: "evidence_disagreement",
          message: "No new visual evidence resolved the current issues"
        });
        break;
      }
    }
  }

  const finalIssues = IdpValidation.validateDocument(run.pages, run.contract);
  const result = aggregate(run, finalIssues, Date.now() - started);
  emit(run, "finalizing", "final_validation", "complete", {
    issue_codes: [...new Set(finalIssues.map((issue) => issue.code))],
    message: `Final validation completed with ${finalIssues.length} unresolved issue(s)`
  });
  emit(run, result.status, "complete", "complete", { message: `Run finished as ${result.status}` });
  const finalSummary = telemetrySummary(run);
  result.agent.telemetry_summary = finalSummary;
  result.usage.input_tokens = finalSummary.input_tokens;
  result.usage.output_tokens = finalSummary.output_tokens;
  result.usage.total_tokens = finalSummary.total_tokens;
  result.usage.estimated_cost_usd = finalSummary.estimated_cost_usd;
  result.usage.actual_billed_cost_usd = finalSummary.actual_billed_cost_usd;
  return result;
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "tool_result") {
    const pending = toolPending.get(message.requestId);
    if (!pending) return;
    toolPending.delete(message.requestId);
    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
    return;
  }
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }

  cancelled = false;
  activeRun = null;
  executionContext = { runId: message.runId || null, page: null, phase: "preparing", step: "runtime" };
  try {
    let result;
    if (message.type === "test_provider") {
      const response = await providerCall(message.config, message.apiKey, "Reply with exactly: IDP_PROVIDER_OK");
      result = { ok: /IDP_PROVIDER_OK/i.test(response.text), latencyMs: response.durationMs };
      if (!result.ok) throw new Error("Provider responded but did not complete the expected connection check");
    } else if (message.type === "run") {
      result = await executeRun(message);
    } else return;
    send("result", { requestId: message.requestId, result });
  } catch (error) {
    const safeError = escapeSecret(error?.message || error, message.apiKey);
    const failure = activeRun ? {
      model_calls: activeRun.modelCalls,
      inspections: activeRun.inspections,
      iterations: activeRun.iteration,
      pages_processed: activeRun.pages.length,
      elapsed_ms: Date.now() - activeRun.startedAt,
      localization: IdpLocalization.coverage(activeRun.pages, activeRun.contract),
      telemetry_summary: telemetrySummary(activeRun)
    } : null;
    if (message.type === "run") {
      emit(activeRun || message.runId || "", "failed", executionContext.step || "runtime", "error", {
        page: executionContext.page,
        error_code: error.idpCode || "provider_error",
        message: safeError,
        metrics: { latency_ms: failure?.elapsed_ms }
      });
    }
    send("result", { requestId: message.requestId, error: safeError, failure });
  }
};
