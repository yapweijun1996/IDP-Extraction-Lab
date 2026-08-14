(function attachStructuredJson(root) {
  "use strict";

  function candidates(source) {
    const values = [];
    for (let start = 0; start < source.length; start += 1) {
      const opener = source[start];
      if (opener !== "{" && opener !== "[") continue;
      const stack = [opener === "{" ? "}" : "]"];
      let quoted = false;
      let escaped = false;
      for (let index = start + 1; index < source.length; index += 1) {
        const character = source[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === "{") stack.push("}");
        else if (character === "[") stack.push("]");
        else if (character === "}" || character === "]") {
          if (stack.at(-1) !== character) break;
          stack.pop();
          if (!stack.length) {
            values.push(source.slice(start, index + 1));
            start = index;
            break;
          }
        }
      }
    }
    return values;
  }

  function parse(text, accepts = () => true) {
    const clean = String(text || "").trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const observedShapes = [];
    const observe = (value) => {
      const shape = Array.isArray(value) ? "array" : value && typeof value === "object" ? `object(${Object.keys(value).slice(0, 12).join(",")})` : typeof value;
      if (!observedShapes.includes(shape)) observedShapes.push(shape);
    };
    try {
      const value = JSON.parse(clean);
      observe(value);
      if (accepts(value)) return value;
    } catch {
      // A provider may append prose or a duplicate JSON value.
    }
    for (const candidate of candidates(clean)) {
      try {
        const value = JSON.parse(candidate);
        observe(value);
        if (accepts(value)) return value;
      } catch {
        // Only another complete, independently parseable value may be tried.
      }
    }
    const diagnostic = observedShapes.length ? observedShapes.join(";") : "no-complete-json-value";
    throw new Error(`Provider returned malformed or schema-incompatible structured JSON (${diagnostic})`);
  }

  root.IdpStructuredJson = Object.freeze({ parse });
})(typeof self !== "undefined" ? self : globalThis);
