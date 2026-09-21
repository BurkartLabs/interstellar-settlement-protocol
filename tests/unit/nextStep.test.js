import { describe, it, expect } from "vitest";
import { nextLevelRaising, employeeCapMessage, miningCreditsAdvice, missionShortMessage, LEVELS, MINING_CHEAPEST_THROUGHPUT } from "../../server/nextStep.js";

// Bug #1058: a refusal says what to do next, and names only what the game can do.
const names = { "earth-station-prime": "Earth Station Prime", "mars-orbital-dock": "Mars Orbital Dock", "luna-gateway": "Luna Gateway" };
const stationName = (id) => names[id] || id;

describe("the employee cap (Bug #1058)", () => {
  it("names the next level that raises it, and its cap", () => {
    expect(employeeCapMessage({ level: 0, employeeCount: 8, employeeCap: 8 }, LEVELS))
      .toBe("Employee cap reached: 8/8 on payroll. Reaching corporation level 1 raises the cap to 20; the Overview lists what the next level needs.");
    expect(employeeCapMessage({ level: 1, employeeCount: 20, employeeCap: 20 }, LEVELS)).toMatch(/level 2 raises the cap to 30/);
  });

  it("skips levels that would not raise it, and says when the top is reached", () => {
    expect(nextLevelRaising(LEVELS, { level: 1 }, "employeeCap", 50)).toEqual({ level: 4, value: 60 });
    expect(employeeCapMessage({ level: 10, employeeCount: 200, employeeCap: 200 }, LEVELS)).toBe("Employee cap reached: 200/200 on payroll. That is the highest cap in the game.");
  });
});

describe("a mining cycle's start-up cost (Bug #1058)", () => {
  it("the cheapest throughput matches start-mining's formula", () => {
    const startup = (t) => Math.max(500, Math.round(Math.max(600, Math.round(t * 16)) * 0.35));
    expect(startup(MINING_CHEAPEST_THROUGHPUT)).toBe(500);
    expect(startup(MINING_CHEAPEST_THROUGHPUT + 1)).toBeGreaterThan(500);
  });

  it("offers the cheaper throughput only when it would help, and always a way to raise credits", () => {
    expect(miningCreditsAdvice(1400)).toBe(`A throughput of ${MINING_CHEAPEST_THROUGHPUT} t/h or less starts for 500 credits. Selling stock to the standing buy orders on the Galactic Exchange raises credits.`);
    expect(miningCreditsAdvice(500)).toBe("Selling stock to the standing buy orders on the Galactic Exchange raises credits.");
  });
});

describe("a contract's delivery (Bug #1058)", () => {
  it("names the item, the amount, the station and what is here", () => {
    const msg = missionShortMessage({ resource: "Silicates", required: 400, stationId: "earth-station-prime", inventory: { "earth-station-prime": { Silicates: 120 } }, stationName });
    expect(msg).toBe("This contract needs 400 Silicates delivered where you are docked, Earth Station Prime; you have 120 here. Mine, refine or buy the rest on the Galactic Exchange.");
  });

  it("points to the station holding the most of it elsewhere, and how to bring it here", () => {
    const msg = missionShortMessage({ resource: "Silicates", required: 400, stationId: "earth-station-prime", inventory: { "earth-station-prime": { Silicates: 120 }, "luna-gateway": { Silicates: 50 }, "mars-orbital-dock": { Silicates: 900 } }, stationName });
    expect(msg).toMatch(/You hold 900 at Mars Orbital Dock: move it here with a Logistics transfer\.$/);
    // The page completes a contract only at the agent's station, so the advice never sends the player elsewhere.
    expect(msg).not.toMatch(/travel|complete the contract from/);
  });
});
