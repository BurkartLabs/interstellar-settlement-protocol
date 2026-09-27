import { describe, it, expect } from "vitest";
import { REFERENCE_PATTERN, REFERENCE_TYPES, ensureCorpRefs, ensureRef, referenceFor } from "../../server/references.js";

// ISP-249 (AB#945; docs/design/BUREAUCRATIC_UI.md, "Reference numbers"): TYPE-YYYY-XXXXXX, the in-fiction year of
// issue, six Crockford base-32 characters from an HMAC of the record's own id: stable, opaque, never an account id.
const AT = Date.UTC(2026, 8, 27);

describe("reference numbers (AB#945)", () => {
  it("are TYPE-YYYY-XXXXXX in the in-fiction year, in Crockford's alphabet (no I, L, O or U)", () => {
    const ref = referenceFor("PAT", "pat-abc", AT);
    expect(ref).toMatch(/^PAT-2147-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(ref).toMatch(REFERENCE_PATTERN);
    expect(Object.keys(REFERENCE_TYPES)).toHaveLength(14);
    expect(() => referenceFor("XYZ", "x")).toThrow();
  });

  it("never change for a record, and differ between records and types", () => {
    expect(referenceFor("LOB", "lob-7", AT)).toBe(referenceFor("LOB", "lob-7", AT));
    expect(referenceFor("LOB", "lob-7", AT)).not.toBe(referenceFor("LOB", "lob-8", AT));
    expect(referenceFor("LOB", "lob-7", AT).slice(9)).not.toBe(referenceFor("PAT", "lob-7", AT).slice(9));
  });

  it("are opaque: consecutive ids give unrelated codes, so a reference reveals no count", () => {
    const codes = Array.from({ length: 200 }, (_, i) => referenceFor("ARB", `gac-${i + 1}`, AT).slice(9));
    expect(new Set(codes).size).toBe(200);
    const sorted = [...codes].sort();
    expect(codes).not.toEqual(sorted); // not issued in order
    const sharedPrefix = codes.slice(1).filter((c, i) => c.slice(0, 3) === codes[i].slice(0, 3)).length;
    expect(sharedPrefix).toBeLessThan(10); // neighbours do not look alike
  });

  it("are never built from an account id", () => {
    const corp = { publicId: "corp-x1", miningLeases: [{ id: "lease-1", issuedAt: AT }] };
    ensureCorpRefs(corp);
    expect(corp.licenceRef).toMatch(/^LIC-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(JSON.stringify(corp)).not.toMatch(/acc-/);
  });

  it("keep a reference already given out, and give one to a record without", () => {
    const legacy = { id: "x", ref: "GAC-2026-000001" };
    expect(ensureRef(legacy, "ARB")).toEqual(["GAC-2026-000001", false]);
    const fresh = { id: "y" };
    const [ref, changed] = ensureRef(fresh, "ARB", { issuedAt: AT });
    expect(changed).toBe(true);
    expect(fresh.ref).toBe(ref);
  });
});
