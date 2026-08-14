(function attachProviderPageNormalizer(root) {
  "use strict";

  const PROVIDER_STATUSES = new Set(["verified", "uncertain", "missing", "not_present"]);
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const canonical = (value) => object(value) && object(value.document_fields) && Array.isArray(value.line_items) && object(value.totals);

  function accepts(value, contract) {
    if (canonical(value)) return true;
    if (!object(value)) return false;
    const topLevel = [...contract.documentFields, ...contract.totalFields].some((field) => owns(value, field.key));
    const rows = Array.isArray(value.line_items) && value.line_items.some((row) => object(row) && contract.lineItemFields.some((field) => owns(row, field.key)));
    return topLevel || rows;
  }

  function stateFor(source, key) {
    return object(source) && owns(source, key) ? source[key] : null;
  }

  function normalize(value, contract, pageNumber) {
    if (!accepts(value, contract)) throw new Error("Provider JSON cannot be mapped to the active extraction contract");
    const canonicalInput = canonical(value);
    const documentSource = canonicalInput ? value.document_fields : value;
    const totalSource = canonicalInput ? value.totals : value;
    const rows = Array.isArray(value.line_items) ? value.line_items : [];
    return {
      page_number: Number.isInteger(Number(value.page_number)) ? Number(value.page_number) : pageNumber,
      document_fields: Object.fromEntries(contract.documentFields.map((field) => [field.key, stateFor(documentSource, field.key)])),
      line_items: rows.map((row) => {
        const fieldSource = canonicalInput && object(row?.fields) ? row.fields : row;
        return {
          fields: Object.fromEntries(contract.lineItemFields.map((field) => [field.key, stateFor(fieldSource, field.key)])),
          source_box_2d: Array.isArray(row?.source_box_2d) ? row.source_box_2d : Array.isArray(row?.box_2d) ? row.box_2d : null
        };
      }),
      totals: Object.fromEntries(contract.totalFields.map((field) => [field.key, stateFor(totalSource, field.key)]))
    };
  }

  function validBoxShape(box) {
    if (box === null) return true;
    if (!Array.isArray(box) || box.length !== 4 || box.some((number) => !Number.isInteger(number) || number < 0 || number > 1000)) return false;
    return box[2] > box[0] && box[3] > box[1];
  }

  function valueTypeIsCompatible(value, field) {
    if (value === null || value === undefined || !field?.type) return true;
    if (field.type === "boolean") return typeof value === "boolean";
    if (field.type === "number") return typeof value === "number" || (typeof value === "string" && /^-?[\d,\s$]+(?:\.\d+)?$/.test(value.trim()));
    return typeof value === "string";
  }

  function inspectState(state, field, path, problems) {
    if (!object(state)) {
      problems.push({ code: "state_metadata_missing", path, message: `${field.label || field.key} did not include field-state metadata` });
      return;
    }
    for (const key of ["value", "status", "confidence", "box_2d"]) {
      if (!owns(state, key)) problems.push({ code: "state_property_missing", path, property: key, message: `${field.label || field.key} did not include ${key}` });
    }
    const value = owns(state, "value") ? state.value : null;
    if (!PROVIDER_STATUSES.has(state.status)) problems.push({ code: "state_status_invalid", path, message: `${field.label || field.key} returned an invalid status` });
    const confidenceMissingForValue = value != null && (state.confidence === null || state.confidence === undefined);
    const confidenceInvalid = state.confidence != null && (!Number.isFinite(Number(state.confidence)) || Number(state.confidence) < 0 || Number(state.confidence) > 1);
    if (confidenceMissingForValue || confidenceInvalid) {
      problems.push({ code: "confidence_missing_or_invalid", path, message: `${field.label || field.key} did not return a usable confidence` });
    }
    if (value == null && state.status === "verified") problems.push({ code: "state_value_status_conflict", path, message: `${field.label || field.key} returned null as verified` });
    if (value != null && ["missing", "not_present"].includes(state.status)) problems.push({ code: "state_value_status_conflict", path, message: `${field.label || field.key} returned a value with a missing status` });
    if (!valueTypeIsCompatible(value, field)) problems.push({ code: "state_value_type_invalid", path, message: `${field.label || field.key} returned the wrong value type` });
    if (!validBoxShape(state.box_2d)) problems.push({ code: "bbox_shape_invalid", path, message: `${field.label || field.key} returned an invalid box_2d` });
  }

  function semanticIssues(value, contract, pageNumber) {
    const problems = [];
    if (!canonical(value)) {
      problems.push({ code: "noncanonical_provider_shape", path: `/pages/${pageNumber - 1}`, message: "Provider returned a compatibility shape without field-state metadata" });
      return problems;
    }
    if (Number(value.page_number) !== Number(pageNumber)) problems.push({ code: "page_number_mismatch", path: `/pages/${pageNumber - 1}`, message: "Provider returned a different page number" });
    for (const [groupName, fields] of [["document_fields", contract.documentFields], ["totals", contract.totalFields]]) {
      for (const field of fields) {
        const path = `/pages/${pageNumber - 1}/${groupName}/${field.key}`;
        if (!owns(value[groupName], field.key)) problems.push({ code: "requested_field_missing", path, message: `${field.label || field.key} was omitted from the structured response` });
        else inspectState(value[groupName][field.key], field, path, problems);
      }
    }
    for (const [rowIndex, row] of value.line_items.entries()) {
      if (!object(row) || !object(row.fields)) {
        problems.push({ code: "line_item_shape_invalid", path: `/pages/${pageNumber - 1}/line_items/${rowIndex}`, message: "Line item did not include a fields object" });
        continue;
      }
      if (!validBoxShape(row.source_box_2d)) problems.push({ code: "bbox_shape_invalid", path: `/pages/${pageNumber - 1}/line_items/${rowIndex}`, message: "Line item returned an invalid source_box_2d" });
      for (const field of contract.lineItemFields) {
        const path = `/pages/${pageNumber - 1}/line_items/${rowIndex}/fields/${field.key}`;
        if (!owns(row.fields, field.key)) problems.push({ code: "requested_field_missing", path, message: `${field.label || field.key} was omitted from the line item` });
        else inspectState(row.fields[field.key], field, path, problems);
      }
    }
    return problems;
  }

  root.IdpProviderPageNormalizer = Object.freeze({ accepts, canonical, normalize, semanticIssues });
})(typeof self !== "undefined" ? self : globalThis);
