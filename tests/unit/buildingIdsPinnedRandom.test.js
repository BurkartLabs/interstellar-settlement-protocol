import { afterEach, describe, expect, it, vi } from "vitest";

// AB#2290: ensureBuildingIds retried createId until it found an unused id. createId is prefix-Date.now()-Math.random(),
// so with both pinned (mining-fees.test.js pins them) it returned one id forever and the loop ran the worker out of
// heap. The real createId is wrapped with a counter that throws after a hundred calls, so the old loop fails here
// with a message instead of taking the worker down with it.
const MAX_CALLS = 100;
let calls = 0;
vi.mock("../../server/game/catalog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createId: (prefix) => {
      calls += 1;
      if (calls > MAX_CALLS) throw new Error(`createId called more than ${MAX_CALLS} times: the id loop does not end`);
      return actual.createId(prefix);
    }
  };
});

const { ensureBuildingIds } = await import("../../server/game/buildingIds.js");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  calls = 0;
});

const building = (name) => ({ name, tier: 1, status: "Operational" });

describe("ids with Math.random and Date pinned (AB#2290)", () => {
  it("gives several buildings distinct ids and ends, though every createId call returns the same string", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
    const corp = { buildings: [building("Headquarters"), building("Basic Extractor Yard"), building("Basic Extractor Yard"), building("Refinery")] };

    expect(ensureBuildingIds(corp)).toBe(true);
    const ids = corp.buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^bld-/);
    expect(calls).toBeLessThanOrEqual(corp.buildings.length);
  });

  it("makes two duplicate ids unique the same way", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
    const corp = { buildings: [{ ...building("A"), id: "bld-same" }, { ...building("B"), id: "bld-same" }, { ...building("C"), id: "bld-same" }] };

    ensureBuildingIds(corp);
    expect(new Set(corp.buildings.map((b) => b.id)).size).toBe(3);
    expect(corp.buildings[0].id).toBe("bld-same");
  });
});
