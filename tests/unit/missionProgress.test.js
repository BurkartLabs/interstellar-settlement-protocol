import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { hoursText, missionProgress, missionTarget } from "../../public/scripts/missionProgress.js";
import { materializeOffer, salvageAssignmentOffer } from "../../server/game/corporation.js";

// AB#2484 (Board review item 31): every mission shows its target before it is accepted and what remains while it is
// active, from one module, so a new mission kind follows the same pattern.
const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 12, 0);
const quota = { id: "ms-log-001", agentId: "elara-voss", quota: { resource: "Silicates", amount: 400 } };

describe("a mining quota (AB#2484)", () => {
  it("states its target before it is accepted", () => {
    expect(missionTarget(quota)).toEqual({ amount: 400, unit: "Silicates", text: "400 Silicates" });
  });

  it("counts what remains from the stock at the station it is handed in at, and falls as stock is mined", () => {
    const at = (n) => missionProgress(quota, { inventory: { "earth-station-prime": { Silicates: n }, "mars-orbital-dock": { Silicates: 999 } }, stationId: "earth-station-prime" });
    expect(at(150)).toMatchObject({ done: 150, remaining: 250, pct: 37, complete: false, remainingText: "250 Silicates still needed", doneText: "150 of 400 Silicates in stock" });
    expect(at(399).remaining).toBe(1);
    expect(at(400)).toMatchObject({ remaining: 0, complete: true, remainingText: "Quota met: 400 Silicates" });
    expect(at(1800)).toMatchObject({ done: 400, remaining: 0, pct: 100 });
    expect(missionProgress(quota, { inventory: {}, stationId: "earth-station-prime" })).toMatchObject({ done: 0, remaining: 400 });
  });

  it("every template in data/missions.json yields a target, as offered", () => {
    const templates = JSON.parse(fs.readFileSync(new URL("../../data/missions.json", import.meta.url), "utf8")).templates;
    for (const t of templates) expect(missionTarget(materializeOffer(t))?.amount, t.id).toBeGreaterThan(0);
  });
});

describe("a time-served contract follows the same pattern (AB#2484)", () => {
  it("states its hours before it is accepted, and counts down what remains", () => {
    const salvage = salvageAssignmentOffer();
    expect(missionTarget(salvage).unit).toBe("hours");
    const hours = salvage.hoursRequired;
    const p = missionProgress({ ...salvage, acceptedAt: NOW - H }, { now: NOW });
    expect(p).toMatchObject({ complete: false, remainingText: `${hoursText((hours - 1) * H)} still to serve` });
    expect(missionProgress({ ...salvage, acceptedAt: NOW - (hours + 1) * H }, { now: NOW })).toMatchObject({ complete: true, remaining: 0, remainingText: "Time served" });
  });
});
