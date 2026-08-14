(function attachValidationCore(root) {
  "use strict";

  const INTERNAL_STATUSES = new Set([
    "verified", "reinspected", "uncertain", "needs_review",
    "missing", "not_present", "not_requested"
  ]);
  const CONFIDENCE_REVIEW_THRESHOLD = 0.8;
  const MONEY_SCALE = 10000n;

  function owns(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function normalizedConfidence(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
  }

  function normalizedStatus(value, confidence, requestedStatus, forceReview) {
    let status = INTERNAL_STATUSES.has(requestedStatus) ? requestedStatus : null;
    if (value === null || value === undefined) {
      return status === "not_present" || status === "not_requested" ? status : "missing";
    }
    if (["missing", "not_present", "not_requested"].includes(status)) status = "uncertain";
    if (!status) status = "uncertain";
    if (forceReview || status === "needs_review" || status === "uncertain") return "needs_review";
    if (confidence !== null && confidence < CONFIDENCE_REVIEW_THRESHOLD) return "uncertain";
    return status;
  }

  function provenanceFor(source, page) {
    const direct = root.IdpLocalization?.toNormalizedBbox(source?.box_2d);
    const existing = root.IdpLocalization?.toNormalizedBbox(source?.provenance?.bbox);
    const bbox = direct || existing;
    if (!bbox) return null;
    return {
      page: Number(source?.provenance?.page || page),
      bbox,
      source: String(source?.provenance?.source || "primary_visual_extraction"),
      ...(source?.provenance?.inspection_id ? { inspection_id: String(source.provenance.inspection_id) } : {}),
      ...(Array.isArray(source?.provenance?.view_hashes) ? { view_hashes: source.provenance.view_hashes.map(String) } : {})
    };
  }

  function validDateParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function canonicalDate(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const text = value.trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match.map(Number);
      return validDateParts(year, month, day) ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
    }
    match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
      const [, day, month, year] = match.map(Number);
      return validDateParts(year, month, day) ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
    }
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const [, first, second, year] = match.map(Number);
      if (first > 12 && second <= 12 && validDateParts(year, second, first)) return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
      if (second > 12 && first <= 12 && validDateParts(year, first, second)) return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
      return null;
    }
    match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (match) {
      const [, year, month, day] = match.map(Number);
      return validDateParts(year, month, day) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
    }
    return null;
  }

  function canonicalValue(value, type) {
    if (value === null || value === undefined) return null;
    if (type === "date") return canonicalDate(value) || value;
    return value;
  }

  function normalizeState(raw, page, forceReview = false, type = null) {
    const metadata = raw && typeof raw === "object" && !Array.isArray(raw);
    const source = metadata ? raw : { value: raw };
    const originalValue = owns(source, "value") ? source.value : null;
    const value = canonicalValue(originalValue, type);
    const confidence = normalizedConfidence(source.confidence);
    return {
      value: value ?? null,
      raw: owns(source, "raw") ? source.raw : originalValue ?? null,
      status: normalizedStatus(value, confidence, source.status, forceReview),
      confidence,
      provenance: provenanceFor(source, page),
      ...(source.localization_status ? { localization_status: String(source.localization_status) } : {})
    };
  }

  function normalizePage(raw, pageNumber, contract, options = {}) {
    const reviewPaths = new Set(options.reviewPaths || []);
    const page = { page_number: pageNumber, document_fields: {}, line_items: [], totals: {} };
    for (const field of contract.documentFields) {
      const path = `/pages/${pageNumber - 1}/document_fields/${field.key}`;
      page.document_fields[field.key] = normalizeState(raw?.document_fields?.[field.key], pageNumber, reviewPaths.has(path), field.type);
    }
    for (const field of contract.totalFields) {
      const path = `/pages/${pageNumber - 1}/totals/${field.key}`;
      page.totals[field.key] = normalizeState(raw?.totals?.[field.key], pageNumber, reviewPaths.has(path), field.type);
    }
    for (const [rowIndex, row] of (Array.isArray(raw?.line_items) ? raw.line_items : []).entries()) {
      const fields = {};
      for (const field of contract.lineItemFields) {
        const path = `/pages/${pageNumber - 1}/line_items/${rowIndex}/fields/${field.key}`;
        fields[field.key] = normalizeState(row?.fields?.[field.key], pageNumber, reviewPaths.has(path), field.type);
      }
      page.line_items.push({
        fields,
        source_page: pageNumber,
        source_bbox: root.IdpLocalization?.toNormalizedBbox(row?.source_box_2d || row?.source_bbox),
        ...(row?.localization_status ? { localization_status: String(row.localization_status) } : {})
      });
    }
    return page;
  }

  function decimal(value) {
    if (value === null || value === undefined || value === "") return null;
    const normalized = String(value).replace(/[,$\s]/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const negative = normalized.startsWith("-");
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [whole, fraction = ""] = unsigned.split(".");
    const scaled = BigInt(whole) * MONEY_SCALE + BigInt(`${fraction}0000`.slice(0, 4));
    return negative ? -scaled : scaled;
  }

  function validDate(value) {
    return canonicalDate(value) !== null;
  }

  function validType(value, type) {
    if (value === null || value === undefined) return true;
    if (type === "number") return decimal(value) !== null;
    if (type === "boolean") return typeof value === "boolean" || ["true", "false"].includes(String(value).toLowerCase());
    if (type === "date") return validDate(value);
    return typeof value === "string";
  }

  function addIssue(issues, pageNumber, data) {
    issues.push({
      issueId: `issue_${pageNumber || "document"}_${String(issues.length + 1).padStart(4, "0")}`,
      severity: "medium",
      repairable: true,
      ...data
    });
  }

  function reviewableState(state) {
    if (!state || state.value === null || state.value === undefined) return false;
    return ["uncertain", "needs_review"].includes(state.status)
      || (state.confidence !== null && Number(state.confidence) < CONFIDENCE_REVIEW_THRESHOLD);
  }

  function validateState(issues, page, groupName, field, state, path, row) {
    if (field.required && (!state || state.value === null || state.value === undefined)) {
      addIssue(issues, page.page_number, { code: "required_field_missing", page: page.page_number, ...(row ? { row } : {}), field: field.key, path, message: `${field.label} is required but unreadable` });
      return;
    }
    if (state?.value !== null && state?.value !== undefined && !validType(state.value, field.type)) {
      addIssue(issues, page.page_number, { code: "invalid_type", severity: "high", page: page.page_number, ...(row ? { row } : {}), field: field.key, path, message: `${field.label} does not match the requested ${field.type} type` });
    }
    if (reviewableState(state)) {
      addIssue(issues, page.page_number, { code: "low_confidence", page: page.page_number, ...(row ? { row } : {}), field: field.key, path, message: `${field.label} needs stronger visual evidence` });
    }
  }

  function validatePage(page, contract, tolerance = 0.01) {
    const issues = [];
    for (const [groupName, fields] of [["document_fields", contract.documentFields], ["totals", contract.totalFields]]) {
      for (const field of fields) {
        const path = `/pages/${page.page_number - 1}/${groupName}/${field.key}`;
        validateState(issues, page, groupName, field, page[groupName]?.[field.key], path, null);
      }
    }
    const fieldKeys = new Set(contract.lineItemFields.map((field) => field.key));
    const seen = new Set();
    for (const [rowIndex, row] of (page.line_items || []).entries()) {
      for (const field of contract.lineItemFields) {
        const path = `/pages/${page.page_number - 1}/line_items/${rowIndex}/fields/${field.key}`;
        validateState(issues, page, "line_items", field, row.fields?.[field.key], path, rowIndex + 1);
      }
      const sn = row.fields?.sn?.value;
      if (sn !== null && sn !== undefined) {
        const identity = String(sn);
        if (seen.has(identity)) addIssue(issues, page.page_number, { code: "duplicate_sequence", severity: "high", repairable: false, page: page.page_number, row: rowIndex + 1, field: "sn", path: `/pages/${page.page_number - 1}/line_items/${rowIndex}/fields/sn`, message: `Duplicate S/N ${identity}` });
        seen.add(identity);
      }
      if (fieldKeys.has("quantity") && fieldKeys.has("unit_price") && fieldKeys.has("amount")) {
        const quantity = decimal(row.fields?.quantity?.value);
        const unitPrice = decimal(row.fields?.unit_price?.value);
        const amount = decimal(row.fields?.amount?.value);
        if (quantity !== null && unitPrice !== null && amount !== null) {
          const expected = quantity * unitPrice / MONEY_SCALE;
          const delta = expected > amount ? expected - amount : amount - expected;
          if (delta > BigInt(Math.round(tolerance * Number(MONEY_SCALE)))) {
            addIssue(issues, page.page_number, { code: "amount_mismatch", severity: "high", page: page.page_number, row: rowIndex + 1, field: "amount", path: `/pages/${page.page_number - 1}/line_items/${rowIndex}/fields/amount`, message: "quantity × unit price does not match amount" });
          }
        }
      }
    }
    return root.IdpLocalization.addEvidenceIssues(page, contract, issues);
  }

  function selectAggregateState(pages, groupName, key) {
    const states = pages.map((page) => page[groupName]?.[key]).filter(Boolean);
    return states.find((state) => state.value !== null && root.IdpLocalization.validNormalizedBbox(state?.provenance?.bbox))
      || states.find((state) => state.value !== null)
      || { value: null, status: "missing", confidence: null, provenance: null };
  }

  function evaluateFinancial(pages, contract, tolerance = 0.01) {
    const requested = new Set(contract.totalFields.map((field) => field.key));
    if (!requested.has("subtotal") || !requested.has("grand_total")) {
      return { status: "not_evaluated", reason: "formula_fields_not_requested", required_fields: ["subtotal", "grand_total"] };
    }
    const operandKeys = ["subtotal", ...["gst", "shipping", "discount"].filter((key) => requested.has(key)), "grand_total"];
    const states = Object.fromEntries(operandKeys.map((key) => [key, selectAggregateState(pages, "totals", key)]));
    const missing = operandKeys.filter((key) => decimal(states[key]?.value) === null);
    if (missing.length) return { status: "not_evaluated", reason: "required_operands_missing", missing_fields: missing, required_fields: operandKeys };
    const subtotal = decimal(states.subtotal.value);
    const gst = requested.has("gst") ? decimal(states.gst.value) : 0n;
    const shipping = requested.has("shipping") ? decimal(states.shipping.value) : 0n;
    const discount = requested.has("discount") ? decimal(states.discount.value) : 0n;
    const grandTotal = decimal(states.grand_total.value);
    const expected = subtotal + gst + shipping - discount;
    const delta = expected > grandTotal ? expected - grandTotal : grandTotal - expected;
    return {
      status: delta <= BigInt(Math.round(tolerance * Number(MONEY_SCALE))) ? "pass" : "fail",
      reason: delta <= BigInt(Math.round(tolerance * Number(MONEY_SCALE))) ? "decimal_equation_matches" : "decimal_equation_mismatch",
      required_fields: operandKeys
    };
  }

  function evaluateLineItems(pages, contract, tolerance = 0.01) {
    const keys = new Set(contract.lineItemFields.map((field) => field.key));
    if (!["quantity", "unit_price", "amount"].every((key) => keys.has(key))) return { status: "not_evaluated", reason: "formula_fields_not_requested", evaluated_rows: 0 };
    let evaluatedRows = 0;
    let mismatches = 0;
    for (const page of pages) for (const row of page.line_items || []) {
      const quantity = decimal(row.fields?.quantity?.value);
      const unitPrice = decimal(row.fields?.unit_price?.value);
      const amount = decimal(row.fields?.amount?.value);
      if (quantity === null || unitPrice === null || amount === null) continue;
      evaluatedRows += 1;
      const expected = quantity * unitPrice / MONEY_SCALE;
      const delta = expected > amount ? expected - amount : amount - expected;
      if (delta > BigInt(Math.round(tolerance * Number(MONEY_SCALE)))) mismatches += 1;
    }
    if (!evaluatedRows) return { status: "not_evaluated", reason: "no_complete_rows", evaluated_rows: 0 };
    return { status: mismatches ? "fail" : "pass", reason: mismatches ? "row_equation_mismatch" : "row_equations_match", evaluated_rows: evaluatedRows, mismatch_rows: mismatches };
  }

  function validateDocument(pages, contract, tolerance = 0.01) {
    const issues = pages.flatMap((page) => validatePage(page, contract, tolerance));
    const sequences = pages.flatMap((page) => page.line_items || [])
      .map((row) => Number(row.fields?.sn?.value)).filter(Number.isInteger).sort((a, b) => a - b);
    for (let index = 1; index < sequences.length; index += 1) {
      if (sequences[index] > sequences[index - 1] + 1) addIssue(issues, null, { code: "sequence_gap", repairable: false, path: "/data/line_items", message: `Possible missing row between ${sequences[index - 1]} and ${sequences[index]}` });
    }
    const financial = evaluateFinancial(pages, contract, tolerance);
    if (financial.status === "fail") addIssue(issues, null, { code: "total_mismatch", severity: "high", path: "/data/totals", message: "Document totals do not reconcile with decimal-safe arithmetic" });
    return issues;
  }

  root.IdpValidation = Object.freeze({
    CONFIDENCE_REVIEW_THRESHOLD,
    canonicalDate,
    canonicalValue,
    decimal,
    evaluateFinancial,
    evaluateLineItems,
    normalizePage,
    normalizeState,
    reviewableState,
    selectAggregateState,
    validType,
    validateDocument,
    validatePage
  });
})(typeof self !== "undefined" ? self : globalThis);
