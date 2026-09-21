import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLeaseBody, systemAccessible, LEASE_BODY_MAX_LENGTH, unknownLeaseBodies } from "../../server/leases.js";

// Bug #691: a mining lease took any string as its body.
const here = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "data", "systems.json"), "utf8"));

// A catalog with leasable bodies outside Sol, so the reachability gate can be exercised before v0.8 adds any.
const FIXTURE = [
  { id: "sol", name: "Sol", bodies: [{ id: "earth", name: "Earth", type: "Planet", leaseCost: 20000 }, { id: "venus", name: "Venus", type: "Planet" }] },
  { id: "alpha-centauri", name: "Alpha Centauri", bodies: [{ id: "haven", name: "Haven", type: "Planet", leaseCost: 40000 }] },
  { id: "epsilon-eridani", name: "Epsilon Eridani", bodies: [{ id: "kestrel", name: "Kestrel", type: "Planet", leaseCost: 60000 }] }
];
const corp = (over = {}) => ({ currentSystemId: "sol", unlockedTech: [], ...over });

describe("resolveLeaseBody (Bug #691)", () => {
  it("keeps the shipped prices, now read from data/systems.json", () => {
    const cost = (name) => resolveLeaseBody(CATALOG, corp(), name).cost;
    expect([cost("Earth"), cost("Mars"), cost("Luna")]).toEqual([20000, 25000, 30000]);
  });

  it("resolves by name or id, and returns the catalog's name rather than the input", () => {
    expect(resolveLeaseBody(CATALOG, corp(), "Mars")).toMatchObject({ ok: true, body: "Mars", systemId: "sol", cost: 25000 });
    expect(resolveLeaseBody(CATALOG, corp(), "mars")).toMatchObject({ ok: true, body: "Mars" });
    expect(resolveLeaseBody(CATALOG, corp(), "  Luna  ")).toMatchObject({ ok: true, body: "Luna" });
  });

  it("rejects a body that does not exist", () => {
    expect(resolveLeaseBody(CATALOG, corp(), "Atlantis").ok).toBe(false);
  });

  it("rejects markup outright, since no body is called that", () => {
    const r = resolveLeaseBody(CATALOG, corp(), "<img src=x onerror=alert(document.domain)>");
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("<img"); // the error message never echoes the input
  });

  it("rejects an empty body and anything over the length limit before looking it up", () => {
    expect(resolveLeaseBody(CATALOG, corp(), "").ok).toBe(false);
    expect(resolveLeaseBody(CATALOG, corp(), undefined).ok).toBe(false);
    expect(resolveLeaseBody(CATALOG, corp(), "E".repeat(LEASE_BODY_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("fails closed on a real body with no lease terms", () => {
    const r = resolveLeaseBody(CATALOG, corp(), "Venus");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lease/i);
  });

  it("refuses a body in a system the corporation cannot reach, and allows it once the research is done", () => {
    expect(resolveLeaseBody(FIXTURE, corp(), "Kestrel").ok).toBe(false);
    expect(resolveLeaseBody(FIXTURE, corp({ unlockedTech: ["tt-proxima-navigation"] }), "Kestrel").ok).toBe(false);
    expect(resolveLeaseBody(FIXTURE, corp({ unlockedTech: ["tt-deep-star-navigation"] }), "Kestrel").ok).toBe(true);
    expect(resolveLeaseBody(FIXTURE, corp(), "Haven").ok).toBe(false);
    expect(resolveLeaseBody(FIXTURE, corp({ unlockedTech: ["tt-proxima-navigation"] }), "Haven").ok).toBe(true);
  });

  it("treats the system a corporation is in as reachable, whatever its research", () => {
    expect(systemAccessible(corp({ currentSystemId: "epsilon-eridani" }), "epsilon-eridani")).toBe(true);
    expect(systemAccessible(corp(), "sol")).toBe(true);
  });
});

describe("unknownLeaseBodies (Bug #691)", () => {
  it("counts stored leases whose body is not in the catalog, without naming anyone", () => {
    const accounts = [
      { state: { corp: { miningLeases: [{ body: "Earth" }, { body: "<script>" }] } } },
      { state: { corp: { miningLeases: [{ body: "Mars" }] } } },
      { state: { corp: {} } }
    ];
    expect(unknownLeaseBodies(CATALOG, accounts)).toBe(1);
  });
});
