import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leaseSlotsFullMessage, corporationSlotsFullMessage, leaseFullAdvice, nextSlotLevel } from "../../public/scripts/slotAdvice.js";
import { unleasedBodies } from "../../server/leases.js";

// Bug #1057: the building-slot errors named actions the game cannot do. They now name only what it can.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (f) => JSON.parse(fs.readFileSync(path.join(repo, f), "utf8"));
const catalog = json("data/systems.json");
const stations = json("data/stations.json").stations;
const levels = json("data/milestones.json").levels;
const lease = (body, used, id = `lease-${body}`) => ({ id, body, buildingSlots: 2, extractorIds: Array.from({ length: used }, (_, i) => `ext-${body}-${i}`) });
const corpWith = (leases, extra = {}) => ({ level: 0, buildingSlots: 4, buildings: [{}, {}, {}, {}], miningLeases: leases, currentSystemId: "sol", unlockedTech: [], ...extra });

/** Verbs the game has no route for (grep of server/index.js and public/scripts, Bug #1057 and #1195). */
const MISSING_VERBS = /upgrade|release|demolish|additional claim|acquire|tier|headquarters|perk/i;

describe("the bodies still to lease (Bug #1057)", () => {
  it("are the catalog's priced bodies not yet leased, with the station that files each", () => {
    expect(unleasedBodies(catalog, stations, corpWith([lease("Earth", 2)]))).toEqual([
      { body: "Mars", station: "Mars Orbital Dock" },
      { body: "Luna", station: "Luna Gateway" }
    ]);
    expect(unleasedBodies(catalog, stations, corpWith([lease("Earth", 2), lease("Mars", 0), lease("Luna", 0)]))).toEqual([]);
  });
});

describe("a full lease (Bug #1057)", () => {
  it("names the bodies left to lease and where to file them", () => {
    const corp = corpWith([lease("Earth", 2)]);
    const msg = leaseSlotsFullMessage(corp, corp.miningLeases[0], unleasedBodies(catalog, stations, corp));
    expect(msg).toBe("This Earth lease has used both of its building slots (2/2). To build more extractors, file a lease on Mars (at Mars Orbital Dock) or Luna (at Luna Gateway): travel there and apply at the ISA Claims & Leases Division.");
    expect(msg).not.toMatch(MISSING_VERBS);
  });

  it("points at another lease that still has room before suggesting a new one", () => {
    const corp = corpWith([lease("Earth", 2), lease("Mars", 1)]);
    expect(leaseFullAdvice(corp, corp.miningLeases[0], unleasedBodies(catalog, stations, corp))).toBe("Your Mars lease still has room: build there.");
  });

  it("says when every body is claimed and full, instead of inventing a way out", () => {
    const corp = corpWith([lease("Earth", 2), lease("Mars", 2), lease("Luna", 2)]);
    expect(leaseFullAdvice(corp, corp.miningLeases[0], [])).toMatch(/Every body the ISA leases is already claimed/);
  });
});

describe("full corporation slots (Bug #1057)", () => {
  it("names the leases that add slots and the next level that raises the total", () => {
    const corp = corpWith([lease("Earth", 2)], { level: 1, buildingSlots: 4 });
    expect(corporationSlotsFullMessage(corp, unleasedBodies(catalog, stations, corp), levels)).toBe(
      "All 4/4 of your corporation's building slots are in use. Each new mining lease adds 2: file one on Mars (at Mars Orbital Dock) or Luna (at Luna Gateway) at the ISA Claims & Leases Division. Reaching corporation level 4 raises the total to 5."
    );
  });

  it("does not promise a level that would not raise it", () => {
    expect(nextSlotLevel(levels, { level: 9, buildingSlots: 12 })).toBeNull();
    expect(nextSlotLevel(levels, { level: 0, buildingSlots: 2 })).toEqual({ level: 2, slots: 3 });
    const done = { level: 10, buildingSlots: 12, buildings: new Array(12).fill({}), miningLeases: [] };
    expect(corporationSlotsFullMessage(done, [], levels)).toBe("All 12/12 of your corporation's building slots are in use. That is the most the game allows for now.");
  });

  it("every station a message names exists", () => {
    const names = new Set(stations.map((s) => s.name));
    for (const b of unleasedBodies(catalog, stations, corpWith([]))) expect(names.has(b.station), b.station).toBe(true);
  });
});

describe("no error names a verb the game lacks (Bug #1057, #1195)", () => {
  it("server/index.js and the page carry none of the old dead-end advice", () => {
    for (const f of ["server/index.js", "public/scripts/app.js", "public/scripts/slotAdvice.js"]) {
      // Code only: the comments that explain the fix quote the old advice.
      const text = fs.readFileSync(path.join(repo, f), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(text, f).not.toMatch(/Upgrade your lease tier|acquire an additional claim|Upgrade your headquarters|release an existing building|future corporation perks/i);
    }
  });
});
