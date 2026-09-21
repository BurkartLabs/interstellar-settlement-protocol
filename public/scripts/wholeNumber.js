// What counts as a whole number in a request (AB#731), in one place for the server's input check and the browser's
// forms (AB#1164). The server imports it from here, as it does the travel gate and the transfer rules.

/** A whole number from a JSON number or a string of digits; anything else (2.5, "abc", "NaN", "1e3", objects) is null. */
export function wholeNumber(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^-?\d{1,15}$/.test(value.trim())) return Number(value.trim());
  return null;
}
