import { describe, it, expect } from "vitest";
import { backfillBuildingIds, ensureBuildingIds } from "../../server/game/buildingIds.js";

// ISP-100 (AB#792): corp.buildings entries had no id, so nothing could say which of three extractor yards to upgrade.
const yard = () => ({ name: "Basic Extractor Yard", tier: 1, status: "Operational" });
const extractor = (n, leaseId) => ({ id: `ext-basic-${n}`, name: `Basic Extractor Yard #${n}`, leaseId, body: "Earth" });

/** A corporation saved before ids: Headquarters, two yards on one lease, their two extractors. */
function oldCorp() {
  return {
    corporationName: "Old Save Mining",
    buildings: [{ name: "Headquarters", tier: 1, status: "Operational" }, yard(), yard()],
    miningLeases: [{ id: "lease-1", body: "Earth", buildingSlots: 2, extractorIds: ["ext-basic-1", "ext-basic-2"] }],
    mining: { silicateExtractors: [extractor(1, "lease-1"), extractor(2, "lease-1")] }
  };
}

describe("ensureBuildingIds (AB#792)", () => {
  it("gives every building an id, each one different, including two of the same type", () => {
    const corp = oldCorp();
    expect(ensureBuildingIds(corp)).toBe(true);
    const ids = corp.buildings.map((b) => b.id);
    ids.forEach((id) => expect(id).toMatch(/^bld-/));
    expect(new Set(ids).size).toBe(3);
    expect(corp.buildings.map(({ id, ...rest }) => rest)).toEqual(oldCorp().buildings);
  });

  it("runs once: a second pass changes nothing", () => {
    const corp = oldCorp();
    ensureBuildingIds(corp);
    const before = JSON.stringify(corp);
    expect(ensureBuildingIds(corp)).toBe(false);
    expect(JSON.stringify(corp)).toBe(before);
  });

  it("links each extractor to its own yard in build order, and leaves the lease links as they were", () => {
    const corp = oldCorp();
    ensureBuildingIds(corp);
    const [, first, second] = corp.buildings;
    expect(corp.mining.silicateExtractors.map((e) => e.buildingId)).toEqual([first.id, second.id]);
    expect(corp.mining.silicateExtractors.map((e) => e.leaseId)).toEqual(["lease-1", "lease-1"]);
    expect(corp.miningLeases[0].extractorIds).toEqual(["ext-basic-1", "ext-basic-2"]);
  });

  it("keeps an id and a link it already has, and gives a third yard to the extractor built with it", () => {
    const corp = oldCorp();
    ensureBuildingIds(corp);
    const kept = corp.buildings.map((b) => b.id);
    const links = corp.mining.silicateExtractors.map((e) => e.buildingId);
    corp.buildings.push(yard());
    corp.mining.silicateExtractors.push(extractor(3, "lease-1"));
    expect(ensureBuildingIds(corp)).toBe(true);
    expect(corp.buildings.slice(0, 3).map((b) => b.id)).toEqual(kept);
    expect(corp.mining.silicateExtractors.map((e) => e.buildingId)).toEqual([...links, corp.buildings[3].id]);
  });

  it("makes a duplicated id unique, keeping the first", () => {
    const corp = { buildings: [{ ...yard(), id: "bld-same" }, { ...yard(), id: "bld-same" }] };
    ensureBuildingIds(corp);
    expect(corp.buildings[0].id).toBe("bld-same");
    expect(corp.buildings[1].id).not.toBe("bld-same");
  });

  it("leaves a corporation with no buildings list alone", () => {
    const corp = { corporationName: "Empty" };
    expect(ensureBuildingIds(corp)).toBe(false);
    expect(corp).toEqual({ corporationName: "Empty" });
  });
});

describe("backfillBuildingIds, the load-time migration (AB#792)", () => {
  it("migrates every corporation that needs it, once", () => {
    const accounts = { a: { id: "acc-a", state: { corp: oldCorp() } }, b: { id: "acc-b", state: { corp: oldCorp() } } };
    expect(backfillBuildingIds(accounts)).toEqual({ migrated: 2, failed: 0 });
    expect(backfillBuildingIds(accounts)).toEqual({ migrated: 0, failed: 0 });
  });

  it("loads a corporation that fails to migrate unchanged, never half-migrated, and logs no player data", () => {
    const broken = oldCorp();
    // The third building cannot be read: the pass fails partway through the list.
    Object.defineProperty(broken.buildings[2], "id", { get() { throw new Error("unreadable"); } });
    const buildingsBefore = broken.buildings;
    const good = oldCorp();
    const logged = [];
    const result = backfillBuildingIds({ x: { id: "acc-secret-id", state: { corp: broken } }, y: { id: "acc-y", state: { corp: good } } }, (m) => logged.push(m));

    expect(result).toEqual({ migrated: 1, failed: 1 });
    expect(broken.buildings).toBe(buildingsBefore);
    expect(broken.buildings[0]).not.toHaveProperty("id");
    expect(broken.buildings[1]).not.toHaveProperty("id");
    expect(broken.mining.silicateExtractors.every((e) => e.buildingId === undefined)).toBe(true);
    expect(good.buildings.every((b) => typeof b.id === "string")).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain("acc-secret-id");
    expect(logged[0]).not.toContain("Old Save Mining");
  });
});
