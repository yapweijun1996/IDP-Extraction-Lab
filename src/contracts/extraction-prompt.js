(function attachExtractionPrompt(root) {
  "use strict";

  function fields(label, definitions) {
    const list = definitions.map((field) => `${field.key} (${field.label}; ${field.type}; ${field.required ? "required" : "optional"})`);
    return `${label}: ${list.length ? list.join(", ") : "none"}.`;
  }

  function primary(contract, page, total) {
    return [
      "Extract business values from this single document page into the separately supplied response schema.",
      `This is page ${page} of ${total}.`,
      "Return extraction values, not the extraction configuration or field definitions.",
      "Use null with status missing or not_present when visual evidence is insufficient. Never guess.",
      "For every field return a calibrated confidence from 0 to 1. A null value cannot be verified. A non-null value with confidence below 0.8 must use status uncertain.",
      "For every non-null document field and total field, return a tight box_2d=[ymin,xmin,ymax,xmax] using integer coordinates from 0 to 1000. Use null only when that value is not visible on this page.",
      "For every visible line item, preserve its printed row identity and return one tight source_box_2d covering the complete printed row. Do not return a whole-table or whole-page box. Do not invent rows.",
      fields("Document fields to populate", contract.documentFields),
      fields("Line-item fields to populate for each visible row", contract.lineItemFields),
      fields("Total fields to populate when visible", contract.totalFields),
      contract.advancedPrompt ? `Additional instructions: ${contract.advancedPrompt}` : ""
    ].filter(Boolean).join("\n");
  }

  root.IdpExtractionPrompt = Object.freeze({ primary });
})(typeof self !== "undefined" ? self : globalThis);
