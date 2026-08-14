import "../i18n/localization.js";
import "./validation-core.js";

const core = globalThis.IdpValidation;

export const decimal = core.decimal;
export const evaluateFinancial = core.evaluateFinancial;
export const evaluateLineItems = core.evaluateLineItems;
export const normalizePage = core.normalizePage;
export const normalizeState = core.normalizeState;
export const validateDocument = core.validateDocument;
export const validatePage = core.validatePage;

export function box2dToBbox(box) {
  return globalThis.IdpLocalization.box2dToBbox(box);
}
