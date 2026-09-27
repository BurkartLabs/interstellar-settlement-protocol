import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById, getStatements, fleetStatus } from "../../server/gameState.js";
import { K_PER_SHIPYARD_TIER, dailyUpkeep, logisticsCapacity, settleAccountUpkeep, settleUpkeep, totalSupply } from "../../server/upkeep.js";
import { UNITS } from "../../server/game/units.js";
import { combatModifiersFor, resolveBattle } from "../../server/game/combat.js";

// ISP-173 (AB#867): upkeep for ships and troops on the design's curve (docs/design/v0.10-combat.md section 7), charged
// by the ticker after payroll, booked as military-upkeep; unpaid upkeep lowers readiness and takes nothing away.

const DAY = 86_400_000;
const fleet = (units, extra = {}) => ({ military: { units }, buildings: [{ name: "Headquarters" }], finances: { credits: 10_000_000 }, ...extra });

describe("the curve (AB#867)", () => {
  it("costs more per unit the larger the fleet: 10, 50 and 100 fighters against K = 40", () => {
    const perUnit = [10, 50, 100].map((n) => dailyUpkeep(fleet({ lf: n })) / n);
    // base 20 a fighter-day x (1 + (n / 40)^2)
    expect(perUnit).toEqual([20 * (1 + (10 / 40) ** 2), 20 * (1 + (50 / 40) ** 2), 20 * (1 + (100 / 40) ** 2)]);
    expect(perUnit[0]).toBeLessThan(perUnit[1]);
    expect(perUnit[1]).toBeLessThan(perUnit[2]);
  });

  it("counts every unit by its supply, troops and garrisons included, and a shipyard tier widens K", () => {
    const corp = fleet({ ds: 5, dt: 10 });
    expect(totalSupply(corp)).toBe(5 * UNITS.ds.supply + 10 * UNITS.dt.supply);
    expect(logisticsCapacity(corp)).toBe(K_PER_SHIPYARD_TIER);
    expect(logisticsCapacity({ buildings: [{ name: "Orbital Shipyard", tier: 3 }] })).toBe(3 * K_PER_SHIPYARD_TIER);
    const base = 5 * UNITS.ds.upkeepPerDay + 10 * UNITS.dt.upkeepPerDay;
    expect(dailyUpkeep(corp)).toBe(base * (1 + (30 / 40) ** 2));
  });

  it("has a best fleet size well below the Fleet Cap: net earnings at the design's 45 a supply-day peak at an interior size", () => {
    // A proxy for the v0.10-20 probe target (ISP-183, AB#877, not built here): the curve, not a bot, is what is checked.
    const cap = fleetStatus({ level: 10, unlocks: { maxFleetSize: 140 }, unlockedTech: ["tt-fleet-coordination"], asteroidMining: {} }).cap;
    const net = (n) => 45 * n - dailyUpkeep(fleet({ lf: n }));
    const best = Array.from({ length: cap }, (_, i) => i + 1).reduce((a, b) => (net(b) > net(a) ? b : a), 1);
    expect(best).toBe(26); // K sqrt((r/u - 1)/3) = 40 x 0.645
    expect(best).toBeLessThan(cap * 0.8);
    expect(net(cap)).toBeLessThan(0);
  });
});

describe("settling (AB#867)", () => {
  it("charges a day's upkeep once a day has passed, whether in one slice or 1,440, booked as military-upkeep", () => {
    const t0 = 1_700_000_000_000;
    const once = fleet({ lf: 10 }), sliced = fleet({ lf: 10 });
    settleUpkeep(once, t0); settleUpkeep(sliced, t0);
    settleUpkeep(once, t0 + DAY);
    for (let i = 1; i <= 1440; i += 1) settleUpkeep(sliced, t0 + i * 60_000);
    expect(once.finances.expensesByCategory["military-upkeep"]).toBe(212); // 212.5 a day; the half carries
    expect(sliced.finances.expensesByCategory["military-upkeep"]).toBe(212);
    expect(once.military.readiness).toBe(100);
  });

  it("charges nothing, and starts no clock, for a corporation with no units", () => {
    const corp = fleet({});
    settleUpkeep(corp, 1); settleUpkeep(corp, 1 + 10 * DAY);
    expect(corp.finances.expensesByCategory?.["military-upkeep"]).toBeUndefined();
    expect(corp.military.upkeep).toBeUndefined();
  });

  it("appears on the day's statement through the ticker's settlement", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const now = Date.now();
    mutateAccountState(account.id, (state) => {
      state.corp.military = { units: { lf: 10, dt: 5 } };
      state.corp.military.upkeep = { paidThrough: now - DAY / 2, remainder: 0, short: false };
      state.corp.finances.credits = 1_000_000;
    }, { sanitize: false, settleMining: false });
    const result = settleAccountUpkeep(account.id, now);
    expect(result.paid).toBeGreaterThan(0);
    expect(getStatements(account.id).today.expenses["military-upkeep"]).toBe(result.paid);
  });
});

describe("unpaid upkeep lowers readiness and takes nothing (AB#867)", () => {
  it("after 30 unpaid days: readiness at the floor of 40, every unit, building, lease and unlock still there, and the account still answers", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const t0 = Date.now() - 30 * DAY;
    mutateAccountState(account.id, (state) => {
      const corp = state.corp;
      corp.military = { units: { lf: 20, ds: 3, dt: 10 }, garrisons: { "earth-station-prime": 10 } };
      corp.military.upkeep = { paidThrough: t0, remainder: 0, short: false };
      corp.miningLeases = [{ id: "lease-e", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: t0 }];
      corp.finances.credits = 0;
    }, { sanitize: false, settleMining: false });
    const before = getAccountById(account.id).state.corp;
    const keep = (c) => JSON.stringify({ units: c.military.units, garrisons: c.military.garrisons, buildings: c.buildings, leases: c.miningLeases, tech: c.unlockedTech, unlocks: c.unlocks, station: c.currentStationId, offices: c.offices });
    for (let d = 1; d <= 30; d += 1) settleAccountUpkeep(account.id, t0 + d * DAY);
    const after = getAccountById(account.id).state.corp;
    expect(after.military.readiness).toBe(40);
    expect(keep(after)).toBe(keep(before));
    expect(after.finances.credits).toBe(0);
    expect(after.finances.payrollArrears || 0).toBe(0); // unpaid upkeep is not a debt
    expect((await authed(app, accessToken).get(`/api/accounts/${account.id}`)).status).toBe(200);
    expect(combatModifiersFor(after)).toMatchObject({ attack: 0.4 });
  });

  it("falls 10 points a day and climbs back 20 a day once paid, with a notice each way", () => {
    const t0 = 1_700_000_000_000;
    const corp = fleet({ lf: 10 }, { finances: { credits: 0 } });
    settleUpkeep(corp, t0);
    const short = settleUpkeep(corp, t0 + 2 * DAY);
    expect(short.becameShort).toBe(true);
    expect(corp.military.readiness).toBe(80);
    corp.finances.credits = 100_000;
    settleUpkeep(corp, t0 + 3 * DAY);
    expect(corp.military.readiness).toBe(100);
  });

  it("is what the resolver reads: at 60 readiness the same fleet deals 60% of its damage", () => {
    const tired = fleet({ ds: 10 }); tired.military.readiness = 60;
    const fresh = fleet({ ds: 10 });
    const hit = (m) => resolveBattle({ ds: 10 }, { ds: 10 }, { attacker: m }).rounds[0].defender.lost.ds;
    expect(combatModifiersFor(tired)).toMatchObject({ attack: 0.6 });
    expect(combatModifiersFor(tired).accuracy).toBeCloseTo(0.6, 12);
    expect(hit(combatModifiersFor(tired))).toBeLessThan(hit(combatModifiersFor(fresh)));
  });
});
