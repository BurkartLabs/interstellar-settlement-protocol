import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, longLivedAccessToken } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, mutateState, applyRefineryOperations, ensureBidShape } from "../../server/gameState.js";
import * as ticks from "../../server/ticks.js";
import { ECONOMY } from "../../server/economy.js";
import { HOUR, POLICIES, REFINERY_COUNTS, RULE_GAP_OPEN, VOLUMES, playWeek, trackShape, weekSupply } from "./chainProbe.js";

// ISP-141 (AB#835): does refining stay a decision? docs/design/tier3-recipes.md section 6. AB#2367 (the Director's
// ruling on AB#2366) replaced the three starting price states, which one corporation's market erases overnight, with a
// sweep of what the corporation does to its own market: how much it mines in a week (VOLUMES) and how many Refineries
// it runs (1 or 2). Every week starts from fresh bids. The bot (chainProbe.js) plays through the routes; this file sets
// up where each week starts. BOT NUMBERS (P-PROXY): they do not measure human pacing, player-to-player prices or other
// sellers.
//
// What is set up rather than played, and why:
//   - the corporation's research (granted), its dock (Earth Station Prime) and, for the tier-3 run, its Refineries' tier:
//     the plant a corporation on this track would already have. The Refineries themselves are built through the route.
//   - the week's raw supply, written once before the week starts (weekSupply in chainProbe.js), the same for every policy.
//     Some tracks' inputs have no source a bot can reach in a week through routes (Lithium and Rare Earths come from belt
//     expeditions in other systems; the cross-track chains' inputs are other tracks' products), and the supply is what
//     the sweep varies, not what it measures. Nothing writes inventory or credits once the week starts.
//   - fresh bids at the start of each week: every standing order at its base with its quota unsold, so one week's
//     selling does not carry into the next corporation's.
// Credits are never written: each corporation starts with the 250,000 a new one has, less the Refineries it builds.

afterAll(() => vi.useRealTimers());

const ALL_TRACKS = {
  "fuel": ["he3-chain", "fusion-fuel-chain", "cryogenics-chain"],
  "nickel-iron": ["smelting-chain", "pressure-vessel-chain"],
  "rare metals": ["rare-earths-chain", "magnet-chain", "thorium-fuel-chain"],
  "light metals": ["aluminium-chain", "al-li-chain", "battery-chain"],
  "cross-track": ["fusion-core-chain", "fission-module-chain", "spaceframe-chain", "ion-thruster-chain"]
};
// CHAIN_PROBE_TRACKS ("fuel,light metals") runs part of the sweep, for looking at one track without the whole table.
const TRACKS = Object.fromEntries(Object.entries(ALL_TRACKS).filter(([name]) => !process.env.CHAIN_PROBE_TRACKS || process.env.CHAIN_PROBE_TRACKS.split(",").includes(name)));
const STATION = "earth-station-prime";
const START = Date.UTC(2026, 2, 2, 11, 0, 0); // Monday 2 March 2026, 11:00 UTC: the day's reset (00:00 UTC) has run
const REFINERY_GATES = ["tt-material-compression", "tt-nano-lattice"];
const T3_MULTIPLIER = ECONOMY.buildings.refineryUpgrades.find((u) => u.toTier === 3).outputMultiplier;

/** Every standing order at its base, with today's quota unsold: the market a week starts from. */
function freshBids() {
  const today = new Date(Date.now()).toISOString().slice(0, 10); // ISP-249 (AB#945): the reset day is UTC's
  mutateState((draft) => {
    for (const order of draft.market.npcBuyOrders) {
      ensureBidShape(order);
      Object.assign(order, { soldToday: 0, remainingQty: order.totalQtyPerDay, unitPrice: order.basePrice, lastResetDate: today });
    }
  });
}

async function week(app, trackName, volume, refineries, policy, tier) {
  vi.setSystemTime(START);
  const shape = trackShape(ALL_TRACKS[trackName]);
  const { account } = await registerAccount(app);
  const id = account.id;
  const token = await longLivedAccessToken(id);
  const auth = { Authorization: `Bearer ${token}` };
  const research = [...new Set([...REFINERY_GATES, ...shape.chains.flatMap((c) => c.requiresTechIds)])];
  mutateAccountState(id, (s) => {
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...research])];
    s.corp.currentSystemId = "sol";
    s.corp.currentStationId = STATION;
    s.corp.buildingSlots = 20; // room for the Refineries, as the track tests give it
  }, { sanitize: false, settleMining: false });
  for (let i = 0; i < refineries; i += 1) {
    const built = await request(app).post(`/api/accounts/${id}/gameplay/build-refinery`).set(auth).send({});
    if (built.status !== 200) throw new Error(`building a Refinery: ${JSON.stringify(built.body)}`);
  }
  mutateAccountState(id, (s) => {
    if (tier === 3) for (const r of s.corp.refineries) r.tier = 3;
    s.corp.inventory = { ...(s.corp.inventory || {}), [STATION]: { ...weekSupply(shape, volume) } }; // the week's supply, once
  }, { sanitize: false, settleMining: false });
  freshBids();
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

/** A point of the sweep: a volume and a Refinery count. */
const POINTS = VOLUMES.flatMap((volume) => REFINERY_COUNTS.map((refineries) => ({ volume, refineries, key: `${volume}h x${refineries}` })));

async function sweep(app, tier, points = POINTS) {
  const out = {};
  for (const track of Object.keys(TRACKS)) {
    out[track] = {};
    for (const p of points) {
      out[track][p.key] = {};
      for (const policy of POLICIES) out[track][p.key][policy] = await week(app, track, p.volume, p.refineries, policy, tier);
    }
  }
  return out;
}

const best = (row) => POLICIES.reduce((a, b) => (row[b].gain > row[a].gain ? b : a));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
/** The design's rule is within 5% of the best policy's gain. */
/**
 * The design's rule ends close to the best policy: within `tolerance` of its gain. AB#2372 (the Director's ruling on
 * AB#2367, tier3-recipes.md section 6): 5%, widened to 11% where "refine to the end" is best, since there the Refinery
 * is idle anyway and a player finds the plain answer without the rule.
 */
const toleranceFor = (row) => (best(row) === "refine to the end" ? 0.11 : 0.05);
const ruleClose = (row, tolerance = toleranceFor(row)) => row[best(row)].gain - row["the design's rule"].gain <= tolerance * Math.abs(row[best(row)].gain);

function report(results, tier) {
  const lines = [`[chain probe, AB#835/AB#2367] tier-${tier} Refineries: credits gained over the week, by weekly supply (hours of one Refinery per chain) x Refineries run. BOT NUMBERS (P-PROXY)`];
  for (const [track, points] of Object.entries(results)) {
    lines.push(`  ${track}`);
    for (const [key, row] of Object.entries(points)) {
      const cells = POLICIES.map((p) => `${p} ${fmt(row[p].gain)}${Object.keys(row[p].unsold).length ? ` (unsold: ${Object.entries(row[p].unsold).map(([i, q]) => `${q} ${i}`).join(", ")})` : ""}`);
      const rule = row["the design's rule"].gain;
      const gap = row[best(row)].gain ? ((row[best(row)].gain - rule) / Math.abs(row[best(row)].gain)) * 100 : 0;
      lines.push(`    ${key.padEnd(10)} ${cells.join(" | ")}  -> best: ${best(row)}; rule ${gap.toFixed(1)}% below best`);
    }
  }
  console.log(lines.join("\n"));
}

// The whole sweep takes several minutes, so it runs on request: `npm run probe:chains` (CHAIN_PROBE=1). One track's
// week at one point runs in every suite, so the bot cannot rot unnoticed.
const FULL = Boolean(process.env.CHAIN_PROBE);

describe("the production-chain bot plays a week through the routes (AB#835)", () => {
  it("nickel-iron, 84 hours, two Refineries: every policy's week runs without a refused action, and refining is paid", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await getApp();
    const row = {};
    for (const policy of POLICIES) row[policy] = await week(app, "nickel-iron", 84, 2, policy, 1);
    for (const policy of POLICIES) expect(row[policy].refusals, policy).toEqual([]);
    expect(row["refine to the end"].gain).toBeGreaterThan(row["sell raw"].gain);
    expect(Object.keys(row["sell raw"].unsold)).toEqual([]);
  }, 120_000);
});

// AB#2144: not requested means not collected. `describe.runIf` would report these tests as skipped, and `npm test`
// fails any test that did not run (scripts/strict-pass.mjs), because a skip is how a file that never booted looks.
const describeFull = FULL ? describe : () => {};

describeFull("the production-chain probe, every track across the sweep (AB#835, AB#2367)", () => {
  let tier1;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await getApp();
    tier1 = await sweep(app, 1);
    report(tier1, 1);
  }, 1_800_000);

  it("at tier 1, every week of every track runs without a refused action", () => {
    for (const [track, points] of Object.entries(tier1)) {
      for (const [key, row] of Object.entries(points)) for (const p of POLICIES) expect(row[p].refusals, `${track} ${key} ${p}`).toEqual([]);
    }
  });

  // Section 6's target (AB#2367).
  it("at tier 1, on every track no fixed policy is best at every point of the sweep", () => {
    for (const [track, points] of Object.entries(tier1)) {
      const winners = Object.values(points).map(best);
      expect(winners.every((w) => w === "sell raw"), `${track}: "sell raw" best everywhere (${winners})`).toBe(false);
      expect(winners.every((w) => w === "refine to the end"), `${track}: "refine to the end" best everywhere (${winners})`).toBe(false);
    }
  });

  it("at tier 1, \"always refine to the end\" loses to \"always sell raw\" at one or more points", () => {
    const losses = Object.entries(tier1).flatMap(([track, points]) => Object.entries(points)
      .filter(([, row]) => row["refine to the end"].gain < row["sell raw"].gain).map(([key]) => `${track} ${key}`));
    expect(losses.length, "refine never lost to sell raw").toBeGreaterThan(0);
  });

  // AB#2372: a real assertion. On 2026-09-26 the rule was within 5% at the 24 points where another policy was best and
  // within 11% at the 16 where refine-to-end was (worst 10.7%, nickel-iron 84h x1). Worse than that anywhere goes red.
  it("at tier 1, the design's rule ends within 5% of the best policy, or 11% where refine-to-end is best", () => {
    for (const [track, points] of Object.entries(tier1)) {
      for (const [key, row] of Object.entries(points)) {
        expect(ruleClose(row), `${track} ${key}: rule ${fmt(row["the design's rule"].gain)} against ${best(row)} ${fmt(row[best(row)].gain)} (tolerance ${toleranceFor(row) * 100}%)`).toBe(true);
      }
    }
  });

  // AB#2372: RULE_GAP_OPEN (chainProbe.js) is what keeps the rule off every player-facing screen; this checks it
  // against the numbers: open while the rule is outside 5% anywhere, closed only when it is inside 5% everywhere.
  it("RULE_GAP_OPEN says what the sweep shows: open while the rule misses 5% anywhere", () => {
    const outside5 = Object.entries(tier1).flatMap(([track, points]) => Object.entries(points)
      .filter(([, row]) => !ruleClose(row, 0.05)).map(([key]) => `${track} ${key}`));
    expect(RULE_GAP_OPEN, `points outside 5%: ${outside5.join(", ") || "none"}`).toBe(outside5.length > 0);
  });

  it("at tier 3 the sweep's middle is reported, and \"always refine\" winning there is accepted (AB#823 section 8)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await getApp();
    const tier3 = await sweep(app, 3, POINTS.filter((p) => p.volume === 84));
    report(tier3, 3);
    for (const [track, points] of Object.entries(tier3)) {
      for (const [key, row] of Object.entries(points)) for (const p of POLICIES) expect(row[p].refusals, `${track} ${key} ${p}`).toEqual([]);
    }
  }, 600_000);
});
