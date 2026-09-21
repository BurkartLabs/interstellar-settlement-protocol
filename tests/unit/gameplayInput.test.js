import { describe, it, expect } from "vitest";
import { wholeNumber, idString, checkField, matchRoute, validateGameplayRequest, MAX_ID_LENGTH } from "../../server/gameplayInput.js";

// AB#731: the pieces the gameplay input middleware is made of.
describe("wholeNumber (AB#731)", () => {
  it.each([
    [7, 7], ["7", 7], [" 12 ", 12], [-5, -5], [0, 0],
    [2.5, null], ["2.5", null], ["abc", null], ["NaN", null], [NaN, null], ["Infinity", null], [Infinity, null],
    ["1e3", null], ["0x10", null], [null, null], [undefined, null], [true, null], [{}, null], [[3], null], ["9".repeat(16), null]
  ])("%j gives %j", (input, expected) => {
    expect(wholeNumber(input)).toBe(expected);
  });
});

describe("idString (AB#731)", () => {
  it("takes a trimmed string of sensible length and nothing else", () => {
    expect(idString(" earth-station-prime ")).toBe("earth-station-prime");
    expect(idString("x".repeat(MAX_ID_LENGTH))).toHaveLength(MAX_ID_LENGTH);
    for (const bad of ["", "   ", "x".repeat(MAX_ID_LENGTH + 1), 5, null, undefined, {}, ["a"]]) expect(idString(bad)).toBeNull();
  });
});

describe("checkField (AB#731)", () => {
  const has = (catalog, v) => catalog === "stations" && v === "earth-station-prime";
  it("refuses a number out of range, and names the range", () => {
    expect(checkField({ kind: "int", min: 1, max: 72, label: "a cycle length" }, 73, has))
      .toEqual({ ok: false, error: "Enter a cycle length: a whole number from 1 to 72." });
    expect(checkField({ kind: "int", min: 1, max: 72, label: "a cycle length" }, 24, has)).toEqual({ ok: true });
  });

  it("lets an optional field be left out or empty, but not sent as null", () => {
    const spec = { kind: "choice", values: [7, 14], label: "a lease length", optional: true };
    expect(checkField(spec, undefined, has).ok).toBe(true);
    expect(checkField(spec, "", has).ok).toBe(true);
    expect(checkField(spec, null, has).ok).toBe(false);
    expect(checkField(spec, 8, has).ok).toBe(false);
  });

  it("refuses an id outside its catalog without repeating it", () => {
    const hostile = "<script>alert(1)</script>";
    const r = checkField({ kind: "id", catalog: "stations", label: "a station" }, hostile, has);
    expect(r).toEqual({ ok: false, error: "Choose a station from the game's list." });
    expect(checkField({ kind: "id", catalog: "stations", label: "a station" }, "earth-station-prime", has).ok).toBe(true);
    expect(checkField({ kind: "id", catalog: "ownLeases", label: "one of your leases" }, "lease-x", has).error).toBe("Choose one of your leases; that one is not on your books.");
  });
});

describe("matchRoute and validateGameplayRequest (AB#731)", () => {
  it("matches a pattern with params, and nothing else", () => {
    expect(matchRoute("/lease/:leaseId/start-mining", "/lease/lease-1/start-mining")).toEqual({ leaseId: "lease-1" });
    expect(matchRoute("/lease/:leaseId/start-mining", "/lease//start-mining")).toEqual({ leaseId: "" });
    expect(matchRoute("/lease/:leaseId/start-mining", "/lease/lease-1/build-extractor")).toBeNull();
    expect(matchRoute("/hire", "/hire/extra")).toBeNull();
  });

  it("wants exactly one travel destination", () => {
    const entry = { oneOf: { toSystemId: { kind: "id", catalog: "systems", label: "a star system" }, toStationId: { kind: "id", catalog: "stations", label: "a station" } } };
    const has = (c, v) => (c === "systems" && v === "sol") || (c === "stations" && v === "earth-station-prime");
    expect(validateGameplayRequest(entry, { body: { toSystemId: "sol" } }, has).ok).toBe(true);
    expect(validateGameplayRequest(entry, { body: {} }, has).error).toBe("Choose one destination: a star system or a station.");
    expect(validateGameplayRequest(entry, { body: { toSystemId: "sol", toStationId: "earth-station-prime" } }, has).ok).toBe(false);
  });

  it("reads a body that is not an object as empty", () => {
    const entry = { body: { count: { kind: "int", min: 1, max: 9, label: "a count" } } };
    for (const body of [null, "count=3", [3], 3]) expect(validateGameplayRequest(entry, { body }, () => false).ok).toBe(false);
  });
});
