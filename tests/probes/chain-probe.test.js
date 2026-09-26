import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, longLivedAccessToken } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, mutateState, applyRefineryOperations, ensureBidShape } from "../../server/gameState.js";
import * as ticks from "../../server/ticks.js";
import { ECONOMY, npcBidFor } from "../../server/economy.js";
import { HOUR, POLICIES, playWeek, trackShape, weekSupply } from "./chainProbe.js";

// ISP-141 (AB#835): does refining stay a decision? docs/design/tier3-recipes.md section 6: a week of each track under
// three policies from three price states. The bot (chainProbe.js) plays through the routes; this file sets up where
// each week starts. BOT NUMBERS (P-PROXY): they do not measure human pacing, player-to-player prices or other sellers.
//
// What is set up rather than played, and why:
//   - the corporation's research (granted), its dock (Earth Station Prime) and, for the tier-3 run, its Refineries' tier:
//     the plant a corporation on this track would already have. The two Refineries themselves are built through the route.
//   - the week's raw supply, written once before the week starts (weekSupply in chainProbe.js), the same for every policy.
//     Some tracks' inputs have no source a bot can reach in a week through routes (Lithium and Rare Earths come from belt
//     expeditions in other systems; the cross-track chains' inputs are other tracks' products), and the supply is not
//     what this measures. Nothing writes inventory or credits once the week starts.
//   - the market's starting price state (the standing orders' volume sold today), as section 6 defines the three states.
// Credits are never written: each corporation starts with the 250,000 a new one has, less the two Refineries it builds.

afterAll(() => vi.useRealTimers());

const TRACKS = {
  "fuel": ["he3-chain", "fusion-fuel-chain", "cryogenics-chain"],
  "nickel-iron": ["smelting-chain", "pressure-vessel-chain"],
  "rare metals": ["rare-earths-chain", "magnet-chain", "thorium-fuel-chain"],
  "light metals": ["aluminium-chain", "al-li-chain", "battery-chain"],
  "cross-track": ["fusion-core-chain", "fission-module-chain", "spaceframe-chain", "ion-thruster-chain"]
};
const STATES = ["fresh", "raw glut", "product glut"];
const STATION = "earth-station-prime";
const START = Date.UTC(2026, 2, 2, 11, 0, 0); // Monday 2 March 2026, 06:00 in New York: the day's reset has run
const REFINERY_GATES = ["tt-material-compression", "tt-nano-lattice"];
const T3_MULTIPLIER = ECONOMY.buildings.refineryUpgrades.find((u) => u.toTier === 3).outputMultiplier;

/** Section 6's starting states: at the floor means sold into today until the bid reaches its floor. */
function setPriceState(state, shape) {
  const floorShare = (1 - ECONOMY.npcBid.floorPct / 100) / (ECONOMY.npcBid.driftAtFullQuotaPct / 100);
  const today = new Date(Date.now()).toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
  const glutted = new Set(state === "raw glut" ? shape.raw : state === "product glut" ? shape.made : []);
  mutateState((draft) => {
    for (const order of draft.market.npcBuyOrders) {
      ensureBidShape(order);
      const quota = order.totalQtyPerDay; // each order's own quota, whatever the server sets it to
      const sold = glutted.has(order.item) ? Math.ceil(quota * floorShare) : 0;
      Object.assign(order, { soldToday: sold, remainingQty: quota - sold, totalQtyPerDay: quota, unitPrice: npcBidFor(order.basePrice, sold, { ...ECONOMY.npcBid, quotaPerDay: quota }), lastResetDate: today });
    }
  });
}

async function week(app, trackName, state, policy, tier) {
  vi.setSystemTime(START);
  const shape = trackShape(TRACKS[trackName]);
  const { account } = await registerAccount(app);
  const id = account.id;
  const token = await longLivedAccessToken(id);
  const auth = { Authorization: `Bearer ${token}` };
  const research = [...new Set([...REFINERY_GATES, ...shape.chains.flatMap((c) => c.requiresTechIds)])];
  mutateAccountState(id, (s) => {
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...research])];
    s.corp.currentSystemId = "sol";
    s.corp.currentStationId = STATION;
    s.corp.buildingSlots = 20; // room for the two Refineries, as the track tests give it
  }, { sanitize: false, settleMining: false });
  for (let i = 0; i < 2; i += 1) {
    const built = await request(app).post(`/api/accounts/${id}/gameplay/build-refinery`).set(auth).send({});
    if (built.status !== 200) throw new Error(`building a Refinery: ${JSON.stringify(built.body)}`);
  }
  mutateAccountState(id, (s) => {
    if (tier === 3) for (const r of s.corp.refineries) r.tier = 3;
    s.corp.inventory = { ...(s.corp.inventory || {}), [STATION]: { ...weekSupply(shape) } }; // the week's supply, once
  }, { sanitize: false, settleMining: false });
  setPriceState(state, shape);
  const startCredits = Number(getAccountById(id).state.corp.finances.credits);

  const io = {
    corp: () => getAccountById(id).state.corp,
    bid: (item) => getState().market.npcBuyOrders.find((o) => o.item === item),
    startRefinery: (body) => request(app).post(`/api/accounts/${id}/gameplay/start-refinery`).set(auth).send(body),
    sell: (orderId, quantity) => request(app).post(`/api/market/npc-orders/${orderId}/sell`).set(auth).send({ quantity }),
    tick: () => {
      ticks.checkAndResetNpcBuyOrders();
      mutateAccountState(id, (s) => applyRefineryOperations(s.corp, Date.now()), { sanitize: false, settleMining: false });
    },
    advance: (ms) => vi.setSystemTime(Date.now() + ms)
  };
  const result = await playWeek({ shape, policy, station: STATION, outputMultiplier: tier === 3 ? T3_MULTIPLIER : 1, io });
  return { ...result, gain: result.credits - startCredits };
}

async function table(app, tier) {
  const out = {};
  for (const track of Object.keys(TRACKS)) {
    out[track] = {};
    for (const state of STATES) {
      out[track][state] = {};
      for (const policy of POLICIES) out[track][state][policy] = await week(app, track, state, policy, tier);
    }
  }
  return out;
}

const best = (row) => POLICIES.reduce((a, b) => (row[b].gain > row[a].gain ? b : a));
const fmt = (n) => Math.round(n).toLocaleString("en-US");

function report(results, tier) {
  const lines = [`[chain probe, AB#835] tier-${tier} Refineries: credits gained over the week, BOT NUMBERS (P-PROXY)`];
  for (const [track, states] of Object.entries(results)) {
    lines.push(`  ${track}`);
    for (const [state, row] of Object.entries(states)) {
      const cells = POLICIES.map((p) => `${p} ${fmt(row[p].gain)}${Object.keys(row[p].unsold).length ? ` (unsold: ${Object.entries(row[p].unsold).map(([i, q]) => `${q} ${i}`).join(", ")})` : ""}`);
      lines.push(`    ${state.padEnd(12)} ${cells.join(" | ")}  -> best: ${best(row)}`);
    }
  }
  console.log(lines.join("\n"));
}

// The whole table is about two and a half minutes, so it runs on request: `npm run probe:chains` (CHAIN_PROBE=1). One
// track's three weeks run in every suite, so the bot cannot rot unnoticed.
const FULL = Boolean(process.env.CHAIN_PROBE);

describe("the production-chain bot plays a week through the routes (AB#835)", () => {
  it("nickel-iron, fresh bids: every policy's week runs without a refused action, and refining is paid", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await getApp();
    const row = {};
    for (const policy of POLICIES) row[policy] = await week(app, "nickel-iron", "fresh", policy, 1);
    for (const policy of POLICIES) expect(row[policy].refusals, policy).toEqual([]);
    expect(row["refine to the end"].gain).toBeGreaterThan(row["sell raw"].gain);
    expect(Object.keys(row["sell raw"].unsold)).toEqual([]);
  }, 120_000);
});

// AB#2144: not requested means not collected. `describe.runIf` would report these tests as skipped, and `npm test`
// fails any test that did not run (scripts/strict-pass.mjs), because a skip is how a file that never booted looks.
const describeFull = FULL ? describe : () => {};

describeFull("the production-chain probe, every track (AB#835)", () => {
  let tier1;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await getApp();
    tier1 = await table(app, 1);
    report(tier1, 1);
  }, 600_000);

  it("at tier 1, every week of every track runs without a refused action", () => {
    for (const [track, states] of Object.entries(tier1)) {
      for (const [state, row] of Object.entries(states)) for (const p of POLICIES) expect(row[p].refusals, `${track} ${state} ${p}`).toEqual([]);
    }
  });

  // Section 6's target. Bug #2366: on main it is not met; "refine to the end" has the most credits in every state of
  // every track. This is `it.fails` so the suite says so without going red; when the design or the data changes and the
  // target is met, this fails, and it becomes `it`.
  it.fails("at tier 1, no fixed policy wins every price state on any track (section 6; not met, Bug #2366)", () => {
    for (const [track, states] of Object.entries(tier1)) {
      const winners = STATES.map((s) => best(states[s]));
      expect(winners.every((w) => w === "sell raw"), `${track}: "sell raw" best in every state (${winners})`).toBe(false);
      expect(winners.every((w) => w === "refine to the end"), `${track}: "refine to the end" best in every state (${winners})`).toBe(false);
    }
  });

  it("at tier 3 the same weeks are reported, and \"always refine\" winning there is accepted (AB#823 section 8)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await getApp();
    const tier3 = await table(app, 3);
    report(tier3, 3);
    for (const [track, states] of Object.entries(tier3)) {
      for (const [state, row] of Object.entries(states)) for (const p of POLICIES) expect(row[p].refusals, `${track} ${state} ${p}`).toEqual([]);
    }
  }, 600_000);
});
