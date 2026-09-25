import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";

// AB#743 (ISP-57): the six core-loop actions answer with a receipt built from the values the server used, and an action
// that reaches a level answers with that level's unlocks, so the confirmation modal never recomputes a figure. A new
// corporation is walked through them in the order a player takes them: rent, hire five (Level 1), lease Earth, build an
// extractor, renew, start a cycle.
const MILESTONES = JSON.parse(readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8"));
const LEVELS = Array.isArray(MILESTONES) ? MILESTONES : MILESTONES.levels;
const LEVEL_1_UNLOCKS = Object.keys(LEVELS.find((l) => l.level === 1).unlocks);

let api;
let accountId;
const steps = {};

/** Every string in a receipt or a level list, for the register checks. */
const strings = (value) => (typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []);
const credits = (res) => res.body.state.corp.finances.credits;

beforeAll(async () => {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  accountId = account.id;
  api = authed(app, accessToken);
  const post = (path, body = {}) => api.post(`/api/accounts/${accountId}/gameplay/${path}`).send(body);

  const start = await api.get(`/api/accounts/${accountId}`);
  steps.start = start;
  steps.refused = await post("hire", { count: 1 }); // no office yet
  steps.rent = await post("rent-office", { stationId: "earth-station-prime", durationDays: 7 });
  steps.hire4 = await post("hire", { count: 4 });
  steps.hire5 = await post("hire", { count: 1 }); // the fifth: Level 1
  steps.hire6 = await post("hire", { count: 1 });
  steps.lease = await post("purchase-lease", { body: "Earth" });
  const leaseId = steps.lease.body.state.corp.miningLeases[0].id;
  steps.build = await post(`lease/${leaseId}/build-extractor`);
  steps.renew = await post("renew-office", { stationId: "earth-station-prime", durationDays: 7 });
  const extractorId = steps.renew.body.state.corp.mining.silicateExtractors[0].id;
  steps.start = start;
  steps.mine = await post(`lease/${leaseId}/start-mining`, { extractorId, amount: 40, hours: 12 });
});

describe("receipts on the six core-loop actions (AB#743)", () => {
  const ORDER = [
    ["rent", "rent-office", "start"],
    ["hire4", "hire", "rent"],
    ["hire5", "hire", "hire4"],
    ["hire6", "hire", "hire5"],
    ["lease", "purchase-lease", "hire6"],
    ["build", "build-extractor", "lease"],
    ["renew", "renew-office", "build"],
    ["mine", "start-mining", "renew"]
  ];

  it.each(ORDER)("%s answers 200 with a %s receipt: title, summary, cost, grants and a next action", (step, action) => {
    const res = steps[step];
    expect(res.status, JSON.stringify(res.body?.error)).toBe(200);
    const r = res.body.receipt;
    expect(r.action).toBe(action);
    for (const field of ["title", "summary", "cost", "next"]) expect(typeof r[field], field).toBe("string");
    expect(r.grants.length).toBeGreaterThan(0);
    for (const g of r.grants) expect(Object.keys(g).sort()).toEqual(["label", "value"]);
  });

  it.each(ORDER)("%s's receipt charges what the account actually lost", (step, _action, before) => {
    const res = steps[step];
    const lost = credits(steps[before]) - credits(res);
    expect(res.body.receipt.costCredits).toBe(Math.round(lost));
    expect(res.body.receipt.cost).toBe(`${Math.round(lost).toLocaleString("en-US")} credits`);
    expect(lost).toBeGreaterThan(0);
  });

  it("reports figures from the account it returns: employees after the hire, the cycle's own end", () => {
    const corp5 = steps.hire5.body.state.corp;
    expect(steps.hire5.body.receipt.grants).toContainEqual({ label: "Employees", value: `${corp5.employeeCount} / ${corp5.employeeCap}` });
    const ex = steps.mine.body.state.corp.mining.silicateExtractors[0];
    const ends = new Date(ex.endsAt);
    const hh = String(ends.getUTCHours()).padStart(2, "0");
    const mm = String(ends.getUTCMinutes()).padStart(2, "0");
    expect(steps.mine.body.receipt.grants.find((g) => g.label === "Cycle ends").value).toMatch(new RegExp(`^${ends.getUTCDate()} \\w{3}, ${hh}:${mm} UTC$`));
  });

  it("a refused action answers with its error and no receipt", () => {
    expect(steps.refused.status).toBe(400);
    expect(steps.refused.body.receipt).toBeUndefined();
    expect(steps.refused.body.error).toMatch(/office/);
  });

  it("is written in the ISA's register: no exclamation marks, no congratulations", () => {
    const all = ORDER.flatMap(([step]) => [...strings(steps[step].body.receipt), ...strings(steps[step].body.levelsReached)]);
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((s) => /!|congratulat/i.test(s))).toEqual([]);
  });
});

describe("the first level-up (AB#743)", () => {
  it("the fifth hire answers with Level 1 and every unlock milestones.json gives it, at the values the account now has", () => {
    const [reached, ...more] = steps.hire5.body.levelsReached;
    expect(more).toEqual([]);
    expect(reached.level).toBe(1);
    expect(reached.title).toBe("Corporation Level 1");
    expect(reached.unlocks.map((u) => u.key)).toEqual(LEVEL_1_UNLOCKS);
    const corp = steps.hire5.body.state.corp;
    const value = (key) => reached.unlocks.find((u) => u.key === key).value;
    expect(value("employeeCap")).toBe(String(corp.employeeCap));
    expect(value("buildingSlots")).toBe(String(corp.buildingSlots));
    expect(corp.fleet.cap).toBe(8); // the sidebar's Fleet Cap (fleetStatus), which the modal must agree with
    expect(value("maxFleetSize")).toBe(String(corp.fleet.cap));
    expect(value("marketSectors")).toBe(LEVELS.find((l) => l.level === 1).unlocks.marketSectors.join(", "));
    for (const u of reached.unlocks) expect(u.label).not.toBe(u.key); // every catalogue key has a player-facing label
  });

  it("no other step reaches a level, and the level is not announced twice", () => {
    for (const step of ["rent", "hire4", "hire6", "lease", "build", "renew", "mine"]) {
      expect(steps[step].body.levelsReached, step).toEqual([]);
    }
  });
});
