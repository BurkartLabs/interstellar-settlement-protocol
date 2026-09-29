import { describe, it, expect, beforeEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getState, mutateAccountState, applyRefineryOperations, RESEARCH_LIBRARY } from "../../server/gameState.js";
import { processRndCompletions } from "../../server/ticks.js";
import { rndItemEndsAt } from "../../public/scripts/rndQueue.js";
import { filePatent, patentTick, resetPatentsForTests } from "../../server/patents.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";
import { ECONOMY } from "../../server/economy.js";

// ISP-236 (AB#931): a non-holder's use of a patented node or chain pays the holder the royalty at the rate in force when
// it happened (docs/design/WARFARE.md, Lawfare): a node's research cost times the rate, a run's outputs at their
// standing bids' base times the rate. The holder pays nothing; nothing after the term; a user who cannot pay is never
// refused, owes the rest, and has it withheld from later sales. Both P&Ls name it.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = WARFARE_CATALOG.patents;
const BEDS = ECONOMY.npcBuyers.find((b) => b.item === "Catalyst Beds").unitPrice; // 1,125
beforeEach(() => resetPatentsForTests());

async function corp({ credits = 200_000, chains = {}, research = {} } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.currentStationId = "earth-station-prime";
    s.corp.chainFirstRunAt = { ...chains };
    s.corp.researchCompletedAt = { ...research };
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...Object.keys(research)])];
  }, { sanitize: false, settleMining: false });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp };
}
/** One Synthesis Array run of Catalyst Beds (5 units) delivering at `at`, through the real run completion. */
const runBeds = (c, at) => mutateAccountState(c.id, (s) => {
  s.corp.synthesisArrays = [{ id: "syn-1", name: "Synthesis Array", tier: 1, active: true, chainId: "catalyst-bed-chain", stationId: "earth-station-prime",
    cycleScale: 1, startedAt: at - 8 * HOUR, lastTickAt: at - 8 * HOUR, endsAt: at, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0,
    inputs: [], outputs: [{ item: "Catalyst Beds", quantity: 5 }] }];
  applyRefineryOperations(s.corp, at + 1);
}, { sanitize: false, settleMining: false });
const book = (c) => c.corp().finances.dayBook;
// Each holder completed before every corporation an earlier test made, so it is the first (the accounts persist).
let earlier = 0;
const holding = async (rate) => {
  const holder = await corp({ chains: { "catalyst-bed-chain": Date.now() - HOUR - (++earlier) * 60_000 } });
  const filed = filePatent(holder.id, { kind: "chain", subjectId: "catalyst-bed-chain", ratePct: rate });
  expect(filed.patent, JSON.stringify(filed)).toBeTruthy();
  return holder;
};

describe("ISP-236 royalties on a patented chain", () => {
  it("a non-holder's run pays rate x its outputs at base, to the holder, and both P&Ls name it", async () => {
    const holder = await holding(5);
    const user = await corp();
    const [h0, u0] = [holder.corp().finances.credits, user.corp().finances.credits];
    runBeds(user, Date.now() + HOUR);
    expect(user.corp().inventory["earth-station-prime"]["Catalyst Beds"]).toBe(5);
    patentTick(Date.now() + HOUR);
    const royalty = Math.round(5 * BEDS * 5 / 100); // 5,625 x 5% = 281
    expect(royalty).toBe(281);
    expect(user.corp().finances.credits).toBe(u0 - royalty);
    expect(holder.corp().finances.credits).toBe(h0 + royalty);
    expect(book(user).expenses["patent-royalty"]).toBe(royalty);
    expect(book(holder).income["patent-royalty-revenue"]).toBe(royalty);
  });

  it("the holder pays nothing on its own patent", async () => {
    const holder = await holding(5);
    const before = holder.corp().finances.credits;
    runBeds(holder, Date.now() + HOUR);
    patentTick(Date.now() + HOUR);
    expect(holder.corp().finances.credits).toBe(before);
    expect(holder.corp().patentUses || []).toEqual([]);
    // Not charged and paid back to itself: nothing booked either way (a self-payment would leave the balance flat too).
    expect(book(holder).expenses["patent-royalty"]).toBeUndefined();
    expect(book(holder).income["patent-royalty-revenue"]).toBeUndefined();
  });

  it("a run inside the term pays and a run after it does not (the boundary crossed)", async () => {
    await holding(5);
    const user = await corp();
    const endsAt = Date.now() + T.termDays * DAY;
    const before = user.corp().finances.credits;
    runBeds(user, endsAt - 60_000);
    patentTick(endsAt);
    expect(user.corp().finances.credits).toBe(before - 281);
    runBeds(user, endsAt + 60_000);
    patentTick(endsAt + 2 * 60_000);
    expect(user.corp().finances.credits).toBe(before - 281);
  });

  it("a user who cannot pay still gets its run, owes the rest, and has it withheld from its next sale", async () => {
    const holder = await holding(5);
    const user = await corp({ credits: 100 });
    runBeds(user, Date.now() + HOUR);
    patentTick(Date.now() + HOUR);
    expect(user.corp().inventory["earth-station-prime"]["Catalyst Beds"]).toBe(5); // never blocked
    expect(user.corp().finances.credits).toBe(0);
    const owed = Object.values(user.corp().patentDebts);
    expect(owed).toEqual([181]);
    const h0 = holder.corp().finances.credits; // after the first tick paid it the 100 the user had
    // A sale into the standing bid: half of what it nets is withheld toward the debt, the rest paid out as usual.
    const npc = getState().market.npcBuyOrders.find((o) => o.item === "Catalyst Beds");
    const sold = await user.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity: 1 });
    expect(sold.status, JSON.stringify(sold.body)).toBe(200);
    const last = user.corp().tradeHistory[0];
    expect(last.royaltyWithheld).toBe(Math.min(181, Math.floor((last.proceeds + last.royaltyWithheld) * T.withholdPct / 100)));
    expect(Object.values(user.corp().patentDebts || {}).reduce((a, b) => a + b, 0)).toBe(181 - last.royaltyWithheld);
    patentTick(Date.now() + 2 * HOUR);
    expect(holder.corp().finances.credits).toBe(h0 + last.royaltyWithheld); // h0 already has the 100 paid at the run
  });
});

describe("ISP-236 royalties on a patented node", () => {
  it("researching it pays rate x its research cost when the research completes", async () => {
    // Filed two hours ago, so research the user completes an hour ago falls inside the term.
    const holder = await corp({ research: { "tt-actinide-handling": Date.now() - 3 * HOUR } });
    expect(filePatent(holder.id, { kind: "research", subjectId: "tt-actinide-handling", ratePct: 20 }, Date.now() - 2 * HOUR).patent).toBeTruthy();
    const user = await corp();
    const before = user.corp().finances.credits;
    mutateAccountState(user.id, (s) => {
      s.queues.corporateRnD = [{ id: "rnd-u", techId: "tt-actinide-handling", name: "Actinide Handling", durationHours: 24, startedAt: Date.now() - 24 * HOUR + 60_000 }];
    }, { sanitize: false, settleMining: false });
    processRndCompletions(); // not done yet: nothing charged
    expect(user.corp().finances.credits).toBe(before);
    mutateAccountState(user.id, (s) => { s.queues.corporateRnD[0].startedAt = Date.now() - 25 * HOUR; }, { sanitize: false, settleMining: false });
    processRndCompletions();
    patentTick(Date.now());
    expect(user.corp().unlockedTech).toContain("tt-actinide-handling");
    expect(user.corp().finances.credits).toBe(before - 30_000 * 20 / 100); // 6,000
  });
});

// Bug #4857: queuing a patented node said nothing of the royalty; 120 credits were taken at completion, unannounced. The
// queue's receipt now quotes it, and the quote is the number the completion charges.
describe("the royalty on a patented node, quoted when it is queued (Bug #4857)", () => {
  const NODE = "tt-actinide-handling"; // tier 4, 30,000 credits
  /** A corporation that may queue NODE: every node below its tier done, and the level for it. */
  const ready = async (credits = 200_000) => {
    const c = await corp({ credits });
    mutateAccountState(c.id, (s) => {
      s.corp.level = 30;
      s.corp.unlockedTech = Object.values(RESEARCH_LIBRARY).filter((n) => n.tier < RESEARCH_LIBRARY[NODE].tier).map((n) => n.id);
      s.queues.corporateRnD = [];
    }, { sanitize: false, settleMining: false });
    return c;
  };
  const queue = (c) => c.api.post(`/api/accounts/${c.id}/gameplay/queue-rnd`).send({ techId: NODE });

  it("the receipt names the holder, the rate and the credits, and completion charges exactly that", async () => {
    const holder = await corp({ research: { [NODE]: Date.now() - 4 * HOUR } }); // before the earlier test's holder, so first
    expect(filePatent(holder.id, { kind: "research", subjectId: NODE, ratePct: 20 }, Date.now() - 2 * HOUR).patent).toBeTruthy();
    const user = await ready();
    const res = await queue(user);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const line = res.body.receipt.grants.find((g) => g.label === "Patent royalty");
    expect(line?.value).toBe(`6,000 credits to ${holder.corp().corporationName} (20% of the research cost), charged when it completes. What your credits do not cover is owed to the holder.`);

    // it completes when the queue says it does, inside the patent's term, through the real R&D tick
    const afterQueue = user.corp().finances.credits;
    const endsAt = rndItemEndsAt(getAccountById(user.id).state.queues.corporateRnD[0]);
    vi.spyOn(Date, "now").mockReturnValue(endsAt + 1_000);
    try { processRndCompletions(); patentTick(endsAt + 1_000); } finally { vi.restoreAllMocks(); }
    expect(user.corp().unlockedTech).toContain(NODE);
    expect(afterQueue - user.corp().finances.credits).toBe(6_000);
  });

  it("an unpatented node's receipt says nothing of a royalty", async () => {
    const user = await ready();
    const res = await queue(user);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.receipt.grants.map((g) => g.label)).not.toContain("Patent royalty");
  });
});
