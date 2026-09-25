import { describe, it, expect } from "vitest";
import { bodyNumber } from "../../server/bodyNumber.js";
import { serverCodeFiles, readServerFile } from "../helpers/serverSource.js";

// Bug #1014: routes clamped body numbers with Math.max(min, Number(x || default)), and Math.max lets NaN through.
describe("bodyNumber (Bug #1014)", () => {
  it("returns the fallback for anything missing or not a finite number", () => {
    for (const value of [undefined, null, "", "abc", NaN, Infinity, -Infinity, "1e400", {}, [1, 2]]) {
      expect(bodyNumber(value, { fallback: 7, min: 1 }), String(value)).toBe(7);
    }
    expect(bodyNumber("abc", { fallback: null, min: 1 })).toBeNull();
  });

  it("clamps to min and max and floors counts", () => {
    expect(bodyNumber(-3, { fallback: 1, min: 1, integer: true })).toBe(1);
    expect(bodyNumber("1.9", { fallback: 1, min: 1, integer: true })).toBe(1);
    expect(bodyNumber(0.5, { fallback: 1, min: 1, integer: true })).toBe(1);
    expect(bodyNumber(500, { fallback: 24, min: 1, max: 72 })).toBe(72);
    expect(bodyNumber("12.5", { fallback: 24, min: 1, max: 72 })).toBe(12.5);
    expect(bodyNumber(0, { fallback: 40, min: 10 })).toBe(10);
  });
});

// The proposal's loop over every route that reads an amount, as a source check: a write route that reads a number
// from its body must do it through bodyNumber. This is structural, not behavioural; the HTTP tests in
// tests/integration/body-numbers.test.js exercise the routes where a bad number corrupted state.
const SAFE_WITHOUT_BODY_NUMBER = {
  "/api/accounts/:accountId/gameplay/rent-office": "durationDays is only used if VALID_DURATIONS includes it",
  "/api/accounts/:accountId/gameplay/renew-office": "durationDays is only used if VALID_DURATIONS includes it"
  // "/api/combat/simulate" was listed here as "writes no state", which was wrong: it wrote the global combat report
  // feed. The route is removed (Bug #1036).
};

function routesReadingBodyNumbers(source) {
  const starts = [...source.matchAll(/app\.(post|put|patch)\(\s*"([^"]+)"/g)].map((m) => ({ at: m.index, path: m[2] }));
  return starts.flatMap((start, i) => {
    const block = source.slice(start.at, starts[i + 1]?.at ?? source.length);
    const bodyFields = new Set([...block.matchAll(/req\.body\??\.(\w+)/g)].map((m) => m[1]));
    for (const m of block.matchAll(/const \{([^}]+)\} = req\.body/g)) {
      for (const name of m[1].split(",")) bodyFields.add(name.trim().split(/[\s=:]/)[0]);
    }
    // \b: bodyNumber( itself must not count as a raw Number( parse.
    const rawParses = [...block.matchAll(/\b(?:Number|parseInt|parseFloat)\(\s*(?:req\.body\??\.)?(\w+)/g)]
      .map((m) => m[1]).filter((name) => bodyFields.has(name));
    return rawParses.length ? [{ path: start.path, fields: [...new Set(rawParses)] }] : [];
  });
}

describe("every write route parses body numbers through bodyNumber (Bug #1014)", () => {
  // AB#1815: routes live in server/routes/*.js now. Scanned one file at a time, so a module's last route never runs on
  // into the next file's imports.
  const routes = serverCodeFiles().flatMap((f) => routesReadingBodyNumbers(readServerFile(f)));

  it("finds the routes it is meant to police (the scan itself works)", () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining(Object.keys(SAFE_WITHOUT_BODY_NUMBER)));
  });

  it("has no route outside the allowlist parsing a body number by hand", () => {
    const offenders = routes.filter((r) => !(r.path in SAFE_WITHOUT_BODY_NUMBER));
    expect(offenders).toEqual([]);
  });
});
