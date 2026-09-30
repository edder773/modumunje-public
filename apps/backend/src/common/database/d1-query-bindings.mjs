// @ts-check
export const D1_MAX_BOUND_PARAMETERS = 100;

/** @param {unknown} values @param {string} label @returns {unknown[]} */
function requireArray(values, label) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${label} must be an array`);
  }
  return values;
}

/** @param {unknown} values */
export function encodeD1IntegerList(values) {
  const checked = requireArray(values, "D1 integer list");
  if (!checked.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError("D1 integer list values must be positive safe integers");
  }
  return JSON.stringify(checked);
}

/** @param {unknown} values */
export function encodeD1TextList(values) {
  const checked = requireArray(values, "D1 text list");
  if (!checked.every((value) => typeof value === "string" && value.length > 0)) {
    throw new TypeError("D1 text list values must be non-empty strings");
  }
  return JSON.stringify(checked);
}
