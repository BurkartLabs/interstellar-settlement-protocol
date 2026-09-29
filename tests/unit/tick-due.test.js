import { describe, it, expect } from "vitest";
import { ceoDue, expeditionsActive, fabricationDue, refineryDue, rndDue, scoutedAnyOf, shipmentsDue, travelDue } from "../../server/game/tickDue.js";
import { scheduleRndQueue } from "../../public/scripts/rndQueue.js";

// Bug #4848: each predicate is its ticker's own "nothing to do" test, inverted. Not due must mean the mutator would
// change nothing; due must cover every case the mutator acts on, and a record in a shape it does not expect.
const NOW = 1_000_000_000;
const H = 3_600_000;

describe("what a ticker has to do for one account (Bug #4848)", () => {
  it("travel: due once the arrival time has come, not before, and never without a journey", () => {
    expect(travelDue({ travel: { arrivesAt: NOW } }, NOW)).toBe(true);
    expect(travelDue({ travel: { arrivesAt: NOW + 1 } }, NOW)).toBe(false);
    expect(travelDue({ travel: null }, NOW)).toBe(false);
    expect(travelDue(null, NOW)).toBe(false);
  });

  it("shipments: due when one in transit has arrived; delivered or held ones, or ones still on the way, are not", () => {
    expect(shipmentsDue({ shipments: [{ status: "in-transit", arrivesAt: NOW }] }, NOW)).toBe(true);
    expect(shipmentsDue({ shipments: [{ status: "in-transit", arrivesAt: NOW + 1 }, { status: "held", arrivesAt: 0 }] }, NOW)).toBe(false);
    expect(shipmentsDue({ shipments: [] }, NOW)).toBe(false);
  });

  it("R&D: due when the first item has finished, or the queue still needs putting in sequence; a sequenced queue in progress is not", () => {
    const item = (startedAt, durationHours = 2) => ({ techId: "t", startedAt, durationHours });
    // a sequenced queue: the second item starts when the first ends
    const running = scheduleRndQueue([item(NOW - H), item(0)], NOW);
    expect(rndDue({ queues: { corporateRnD: running } }, NOW)).toBe(false);
    expect(rndDue({ queues: { corporateRnD: running } }, NOW + H)).toBe(true); // the first ends at NOW + 1 h
    // an item with no start, or one overlapping the item ahead: the scheduler would move it, so the mutator must run
    expect(rndDue({ queues: { corporateRnD: [item(NOW - H), { techId: "u", durationHours: 2 }] } }, NOW)).toBe(true);
    expect(rndDue({ queues: { corporateRnD: [item(NOW - H), item(NOW - H)] } }, NOW)).toBe(true);
    expect(rndDue({ queues: { corporateRnD: [] } }, NOW)).toBe(false);
    expect(rndDue({ queues: {} }, NOW)).toBe(false);
  });

  it("R&D: not due exactly when the ticker's own scheduling and done test would change nothing", () => {
    const queue = scheduleRndQueue([{ techId: "a", startedAt: NOW - H, durationHours: 3 }, { techId: "b", startedAt: 0, durationHours: 1 }], NOW);
    const before = JSON.stringify(queue);
    expect(rndDue({ queues: { corporateRnD: queue } }, NOW)).toBe(false);
    expect(JSON.stringify(scheduleRndQueue(JSON.parse(before), NOW))).toBe(before);
  });

  it("CEO insight: due once a programme has run its hours; one with no start or no duration never completes, so is not", () => {
    expect(ceoDue({ queues: { ceoInsight: [{ startedAt: NOW - 2 * H, durationHours: 2 }] } }, NOW)).toBe(true);
    expect(ceoDue({ queues: { ceoInsight: [{ startedAt: NOW - H, durationHours: 2 }] } }, NOW)).toBe(false);
    expect(ceoDue({ queues: { ceoInsight: [{ startedAt: 0, durationHours: 2 }, { startedAt: NOW - 9 * H }] } }, NOW)).toBe(false);
  });

  it("fabrication: a probe, ship or squad complete, or a fleet at the end of a trip; a raid's trip is the raid's to settle", () => {
    expect(fabricationDue({ asteroidMining: { fabricationQueue: [{ completesAt: NOW }] } }, NOW)).toBe(true);
    expect(fabricationDue({ shipyard: { queue: [{ completesAt: NOW - 1 }] } }, NOW)).toBe(true);
    expect(fabricationDue({ training: { queue: [{ completesAt: NOW }] } }, NOW)).toBe(true);
    expect(fabricationDue({ military: { fleets: [{ transit: { arrivesAt: NOW } }] } }, NOW)).toBe(true);
    expect(fabricationDue({ military: { fleets: [{ transit: { arrivesAt: NOW, raidId: "r1" } }] } }, NOW)).toBe(false);
    expect(fabricationDue({ asteroidMining: { fabricationQueue: [{ completesAt: NOW + 1 }] }, shipyard: { queue: [] }, military: { fleets: [{ transit: null }] } }, NOW)).toBe(false);
  });

  it("refinery: a run that has ended, or a record the model has not made yet for a building that stands", () => {
    const refinery = { name: "Refinery" };
    expect(refineryDue({ buildings: [refinery], refineries: [{ active: true, chainId: "c", endsAt: NOW }], synthesisArrays: [] }, NOW)).toBe(true);
    expect(refineryDue({ buildings: [refinery], refineries: [{ active: true, chainId: "c", endsAt: NOW + 1 }], synthesisArrays: [] }, NOW)).toBe(false);
    expect(refineryDue({ buildings: [refinery], refineries: [{ active: true, chainId: "c" }], synthesisArrays: [] }, NOW)).toBe(true); // no end: let the mutator see it
    expect(refineryDue({ buildings: [refinery], refineries: [], synthesisArrays: [] }, NOW)).toBe(true); // the record is owed
    expect(refineryDue({ buildings: [{ name: "Synthesis Array" }], refineries: [] }, NOW)).toBe(true);
    expect(refineryDue({ buildings: [], refineries: [{ active: false }], synthesisArrays: [] }, NOW)).toBe(false);
  });

  it("expeditions: only one out mines on every run; a belt emptied this run concerns those that scouted it", () => {
    expect(expeditionsActive({ asteroidMining: { activeExpeditions: [{ status: "active" }] } })).toBe(true);
    expect(expeditionsActive({ asteroidMining: { activeExpeditions: [{ status: "completed" }] } })).toBe(false);
    expect(scoutedAnyOf({ asteroidMining: { scoutedBelts: ["sol:belt"] } }, ["sol:belt"])).toBe(true);
    expect(scoutedAnyOf({ asteroidMining: { scoutedBelts: ["sol:belt"] } }, ["ac:belt"])).toBe(false);
  });
});
