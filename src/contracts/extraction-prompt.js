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
      "For every non-null document field and total field, return a tight box_2d=[ymin,xmin,ymax,xmax] using integer coordinates from 0 to 1000. The box must cover the visible label and value evidence for that field, including all wrapped value lines when present, with only a small amount of surrounding whitespace. Do not box only the label, only a nearby value, an entire section, or an entire table. Use null only when that value is not visible on this page.",
      "Calibrate every box against the page image itself: ymin/ymax are the first and last visible text pixels, and xmin/xmax are the left and right edges of the evidence text. Do not reuse a neighboring field's coordinates, align boxes to table columns, or make a box larger just to express uncertainty. A high field confidence does not justify a loose box.",
      "For every visible line item, preserve its printed row identity and return one tight source_box_2d covering the complete printed row, from the row's first visible text to its last visible text. Keep the box within that row's vertical text band and do not include adjacent rows. Do not return a whole-table or whole-page box. Do not invent rows.",
      fields("Document fields to populate", contract.documentFields),
      fields("Line-item fields to populate for each visible row", contract.lineItemFields),
      fields("Total fields to populate when visible", contract.totalFields),
      contract.advancedPrompt ? `Additional instructions: ${contract.advancedPrompt}` : ""
    ].filter(Boolean).join("\n");
  }

  root.IdpExtractionPrompt = Object.freeze({ primary });
})(typeof self !== "undefined" ? self : globalThis);
