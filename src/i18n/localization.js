(function attachLocalization(root) {
  "use strict";

  const MAX_REGION_AREA = 0.5;
  const CONFIDENCE_THRESHOLD = 0.9;
  const PRIORITY = Object.freeze({
    row_evidence_missing: 1,
    localization_failed: 1,
    localization_budget_exhausted: 1,
    field_evidence_missing: 2,
    required_field_missing: 3,
    invalid_type: 3,
    amount_mismatch: 4,
    total_mismatch: 4,
    low_confidence: 5
  });

  function validNormalizedBbox(value) {
    if (!value || typeof value !== "object") return false;
    const numbers = [value.x, value.y, value.width, value.height].map(Number);
    if (!numbers.every(Number.isFinite)) return false;
    const [x, y, width, height] = numbers;
    return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1 && width * height <= MAX_REGION_AREA;
  }

  function box2dToBbox(box) {
    if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isInteger(value) || value < 0 || value > 1000)) return null;
    const [y1, x1, y2, x2] = box;
    if (x2 <= x1 || y2 <= y1) return null;
    const bbox = { x: x1 / 1000, y: y1 / 1000, width: (x2 - x1) / 1000, height: (y2 - y1) / 1000 };
    return validNormalizedBbox(bbox) ? bbox : null;
  }

  function toNormalizedBbox(value) {
    if (validNormalizedBbox(value)) return { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) };
    return box2dToBbox(value);
  }

  function stateAt(page, pointer) {
    const parts = String(pointer || "").split("/").slice(1);
    if (parts[0] !== "pages") return null;
    if (parts[2] === "line_items") return page.line_items?.[Number(parts[3])]?.fields?.[parts[5]] || null;
    return page[parts[2]]?.[parts[3]] || null;
  }

  function fieldEvidenceVerified(state) {
    if (!state || state.value == null || !validNormalizedBbox(state?.provenance?.bbox)) return false;
    if (["failed", "budget_exhausted"].includes(state.localization_status)) return false;
    return ["verified", "reinspected"].includes(state.status) && Number.isFinite(Number(state.confidence)) && Number(state.confidence) >= 0.8;
  }

  function rowEvidenceVerified(row) {
    if (!row || !validNormalizedBbox(row.source_bbox) || ["failed", "budget_exhausted"].includes(row.localization_status)) return false;
    if (row.localization_status === "verified") return true;
    return Object.values(row.fields || {}).filter(fieldEvidenceVerified).length >= 2;
  }

  function addEvidenceIssues(page, contract, issues) {
    const push = (data) => issues.push({ issueId: `issue_${page.page_number}_${issues.length + 1}`, severity: "medium", repairable: data.code !== "localization_budget_exhausted", ...data });
    for (const [group, fields] of [["document_fields", contract.documentFields], ["totals", contract.totalFields]]) {
      for (const field of fields) {
        const state = page[group]?.[field.key];
        const path = `/pages/${page.page_number - 1}/${group}/${field.key}`;
        if (state?.value == null) {
          if (["failed", "budget_exhausted"].includes(state?.localization_status)) {
            const code = state.localization_status === "budget_exhausted" ? "localization_budget_exhausted" : "localization_failed";
            push({ code, page: page.page_number, field: field.key, path, target_kind: "field", message: `${field.label} could not be localized with verified evidence` });
          }
          continue;
        }
        if (fieldEvidenceVerified(state)) continue;
        const code = state.localization_status === "budget_exhausted" ? "localization_budget_exhausted" : state.localization_status === "failed" ? "localization_failed" : "field_evidence_missing";
        push({ code, page: page.page_number, field: field.key, path, target_kind: "field", message: code === "field_evidence_missing" ? `${field.label} has a value but no verified source region` : `${field.label} could not be localized with verified evidence` });
      }
    }
    for (const [rowIndex, row] of (page.line_items || []).entries()) {
      if (rowEvidenceVerified(row)) continue;
      const path = `/pages/${page.page_number - 1}/line_items/${rowIndex}`;
      const code = row.localization_status === "budget_exhausted" ? "localization_budget_exhausted" : row.localization_status === "failed" ? "localization_failed" : "row_evidence_missing";
      push({ code, page: page.page_number, row: rowIndex + 1, path, target_kind: "row", message: code === "row_evidence_missing" ? `Line item ${rowIndex + 1} has no verified row source region` : `Line item ${rowIndex + 1} could not be localized with verified evidence` });
    }
    return issues;
  }

  function rowIndexFromIssue(issue) {
    const match = String(issue.path || "").match(/\/line_items\/(\d+)/);
    return match ? Number(match[1]) : Number.isInteger(Number(issue.row)) ? Number(issue.row) - 1 : null;
  }

  function rowFieldPath(page, rowIndex, key) { return `/pages/${page.page_number - 1}/line_items/${rowIndex}/fields/${key}`; }

  function rowAnchors(page, contract, rowIndex) {
    const row = page.line_items?.[rowIndex];
    if (!row) return [];
    const preferred = ["sn", "stock_code", "amount", ...contract.lineItemFields.map((field) => field.key)];
    const unique = [...new Set(preferred)];
    return unique.filter((key) => row.fields?.[key]?.value != null).map((key) => rowFieldPath(page, rowIndex, key)).slice(0, 3);
  }

  function buildTargets(page, contract, issues, attempts = new Map(), options = {}) {
    const maxRegions = Number(options.maxRegions || 6), maxAttempts = Number(options.maxAttempts || 2), grouped = new Map();
    const sorted = [...issues].filter((issue) => issue.repairable !== false).sort((a, b) => (PRIORITY[a.code] || 9) - (PRIORITY[b.code] || 9));
    for (const issue of sorted) {
      const rowIndex = rowIndexFromIssue(issue);
      const kind = rowIndex === null ? "field" : "row";
      const id = kind === "row" ? `/pages/${page.page_number - 1}/line_items/${rowIndex}` : issue.path;
      if ((attempts.get(issue.path) || 0) >= maxAttempts) continue;
      if (!grouped.has(id)) grouped.set(id, { id, kind, page: page.page_number, rowIndex, issue_paths: [], field_paths: [], anchor_paths: [], issue_codes: [], priority: PRIORITY[issue.code] || 9, mandatory: false, requires_source_confirmation: false });
      const target = grouped.get(id);
      target.issue_paths.push(issue.path);
      target.priority = Math.min(target.priority, PRIORITY[issue.code] || 9);
      target.issue_codes.push(issue.code);
      target.mandatory ||= ["row_evidence_missing", "field_evidence_missing", "required_field_missing", "invalid_type", "localization_failed", "localization_budget_exhausted", "amount_mismatch", "total_mismatch", "low_confidence"].includes(issue.code);
      target.requires_source_confirmation ||= ["row_evidence_missing", "field_evidence_missing", "localization_failed", "localization_budget_exhausted"].includes(issue.code);
      if (kind === "field") target.field_paths.push(issue.path);
      else {
        const anchors = rowAnchors(page, contract, rowIndex);
        target.anchor_paths.push(...anchors);
        if (/\/fields\//.test(issue.path)) target.field_paths.push(issue.path);
        target.field_paths.push(...anchors);
      }
    }
    return [...grouped.values()].map((target) => {
      const hint = target.kind === "row" ? page.line_items?.[target.rowIndex]?.source_bbox : stateAt(page, target.field_paths[0])?.provenance?.bbox;
      const bboxHint = validNormalizedBbox(hint) ? hint : null;
      const anchors = [...new Set(target.anchor_paths)];
      const issueFields = [...new Set(target.issue_paths.filter((path) => /\/fields\//.test(path) || target.kind === "field"))].sort((a, b) => (attempts.get(a) || 0) - (attempts.get(b) || 0));
      const requestedRowFields = target.kind === "row"
        ? contract.lineItemFields
          .map((field) => rowFieldPath(page, target.rowIndex, field.key))
          .filter((path) => (attempts.get(path) || 0) < maxAttempts)
        : [];
      const fieldPaths = [...new Set(target.requires_source_confirmation
        ? [...anchors, ...requestedRowFields, ...issueFields]
        : [...issueFields, ...anchors, ...requestedRowFields])].slice(0, 12);
      const attemptKeys = [...new Set(target.issue_paths.filter((path) => path === target.id || fieldPaths.includes(path)))];
      return { ...target, field_paths: fieldPaths, anchor_paths: anchors, issue_paths: [...new Set(target.issue_paths)], attempt_keys: attemptKeys, bbox_hint: bboxHint, requires_source_confirmation: target.requires_source_confirmation || (target.mandatory && !bboxHint) };
    }).sort((a, b) => a.priority - b.priority).slice(0, maxRegions);
  }

  function mandatoryTargetsWithoutInspection(targets, inspections) {
    const completed = new Set((inspections || []).map((inspection) => inspection.target_id));
    return (targets || []).filter((target) => target.mandatory && !completed.has(target.id));
  }

  function normalizeComparable(value, type) {
    if (value == null) return null;
    if (type === "number") { const normalized = String(value).replace(/[,\s$]/g, ""); return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null; }
    if (type === "boolean") return value === true || String(value).toLowerCase() === "true";
    if (type === "date") return root.IdpValidation?.canonicalDate?.(String(value)) || String(value).trim();
    return String(value).normalize("NFKC").trim();
  }

  function observationEvidence(observation, type, inspection) {
    const views = Array.isArray(observation?.views) ? observation.views : [];
    const values = views.map((view) => normalizeComparable(view.observed_value, type));
    const confidence = views.length ? Math.min(...views.map((view) => Number(view.confidence || 0))) : 0;
    const distinctHashes = new Set((inspection?.views || []).map((view) => view.hash).filter(Boolean));
    return { agreed: values.length >= 2 && values[0] != null && values.every((value) => value === values[0]) && confidence >= CONFIDENCE_THRESHOLD && distinctHashes.size >= 2, value: values[0], raw: views[0]?.observed_value ?? null, confidence };
  }

  function definitionFor(contract, key) { return [...contract.documentFields, ...contract.lineItemFields, ...contract.totalFields].find((field) => field.key === key); }
  function provenance(inspection) { return { page: inspection.page, bbox: inspection.bbox, source: "targeted_visual_reinspection", inspection_id: inspection.inspection_id, view_hashes: inspection.views.map((view) => view.hash) }; }

  function reconcileInspection(page, target, inspection, observations, contract) {
    if (Number(inspection?.page) !== Number(page.page_number) || !validNormalizedBbox(inspection?.bbox)) return { committed: false, decisions: [], reason: "wrong_page_or_invalid_bbox" };
    const byPath = new Map((observations || []).map((observation) => [String(observation.field_path || ""), observation]));
    const evidence = new Map();
    for (const path of target.field_paths) {
      const definition = definitionFor(contract, path.split("/").at(-1));
      evidence.set(path, observationEvidence(byPath.get(path), definition?.type, inspection));
    }
    const decisions = [];
    if (target.kind === "row") {
      const row = page.line_items?.[target.rowIndex];
      if (!row) return { committed: false, decisions, reason: "wrong_row" };
      const matchingAnchors = target.anchor_paths.filter((path) => { const proof = evidence.get(path), state = stateAt(page, path), definition = definitionFor(contract, path.split("/").at(-1)); return proof?.agreed && normalizeComparable(state?.value, definition?.type) === proof.value; });
      if (target.requires_source_confirmation && matchingAnchors.length < 2) { row.localization_status = "failed"; return { committed: false, decisions, reason: "fewer_than_two_matching_row_anchors" }; }
      if (!target.requires_source_confirmation && !target.field_paths.some((path) => evidence.get(path)?.agreed)) { row.localization_status = "failed"; return { committed: false, decisions, reason: "no_field_confirmed_in_known_row_region" }; }
      row.source_page = page.page_number; row.source_bbox = inspection.bbox; row.localization_status = "verified";
      for (const path of target.field_paths) {
        const proof = evidence.get(path), state = stateAt(page, path), key = path.split("/").at(-1), definition = definitionFor(contract, key);
        if (!proof?.agreed || !state) continue;
        const before = state.value, same = normalizeComparable(before, definition?.type) === proof.value;
        if (!same && before != null && ["sn", "stock_code"].includes(key)) continue;
        state.value = root.IdpValidation?.canonicalValue?.(same ? before : proof.raw, definition?.type) ?? (same ? before : proof.raw); state.status = same ? "verified" : "reinspected"; state.confidence = proof.confidence; state.provenance = provenance(inspection); state.localization_status = "verified";
        decisions.push({ field_path: path, decision: same ? "keep" : "replace", before, after: state.value, reason: same ? "row_anchor_confirmed" : "two_independent_views_agree" });
      }
      return { committed: true, decisions, reason: "two_row_anchors_confirmed" };
    }
    const path = target.field_paths[0], state = stateAt(page, path), definition = definitionFor(contract, path?.split("/").at(-1)), proof = evidence.get(path);
    if (!state || !proof?.agreed) { if (state) { state.localization_status = "failed"; state.status = state.value == null ? "missing" : "needs_review"; } return { committed: false, decisions, reason: "field_evidence_not_confirmed" }; }
    const before = state.value, same = normalizeComparable(before, definition?.type) === proof.value;
    state.value = root.IdpValidation?.canonicalValue?.(same ? before : proof.raw, definition?.type) ?? (same ? before : proof.raw); state.status = same ? "verified" : "reinspected"; state.confidence = proof.confidence; state.provenance = provenance(inspection); state.localization_status = "verified";
    decisions.push({ field_path: path, decision: same ? "keep" : "replace", before, after: state.value, reason: "two_independent_views_agree" });
    return { committed: true, decisions, reason: "field_evidence_confirmed" };
  }

  function markLocalization(page, target, status) {
    if (target.kind === "row") { const row = page.line_items?.[target.rowIndex]; if (row) row.localization_status = status; return; }
    const state = stateAt(page, target.field_paths[0]); if (state) state.localization_status = status;
  }

  function coverage(pages, contract) {
    let located = 0, unlocated = 0, failed = 0, budget_exhausted = 0;
    for (const page of pages || []) {
      for (const row of page.line_items || []) { if (rowEvidenceVerified(row)) located += 1; else { unlocated += 1; failed += row.localization_status === "failed" ? 1 : 0; budget_exhausted += row.localization_status === "budget_exhausted" ? 1 : 0; } }
      for (const [group, fields] of [["document_fields", contract.documentFields], ["totals", contract.totalFields]]) for (const field of fields) { const state = page[group]?.[field.key]; if (state?.value == null && !["failed", "budget_exhausted"].includes(state?.localization_status)) continue; if (fieldEvidenceVerified(state)) located += 1; else { unlocated += 1; failed += state?.localization_status === "failed" ? 1 : 0; budget_exhausted += state?.localization_status === "budget_exhausted" ? 1 : 0; } }
    }
    return { located_targets: located, unlocated_targets: unlocated, localization_failed: failed, localization_budget_exhausted: budget_exhausted };
  }

  root.IdpLocalization = Object.freeze({ addEvidenceIssues, box2dToBbox, buildTargets, coverage, fieldEvidenceVerified, mandatoryTargetsWithoutInspection, markLocalization, reconcileInspection, rowEvidenceVerified, stateAt, toNormalizedBbox, validNormalizedBbox });
})(typeof self !== "undefined" ? self : globalThis);
