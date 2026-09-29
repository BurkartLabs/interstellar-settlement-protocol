import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { SYSTEMS_BY_ID } from "../../server/game/catalog.js";
import { getState } from "../../server/gameState.js";
import { answerInvitation, findConglomerate, inviteCorporation } from "../../server/game/membership.js";
import { setMemberRole } from "../../server/game/conglomerateRoles.js";
import { billOfMaterials, settleStationProjects } from "../../server/game/stationProjects.js";
import { proposeStationSetting, voteOnStationProposal } from "../../server/game/stationGovernance.js";
import { stationAtBody } from "../../server/game/stations.js";
import { stationTaxBreakdown, taxOnSale } from "../../public/scripts/exchangeTax.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";

// ISP-212b (AB#4655): the sales tax at a conglomerate's own station (docs/design/CONGLOMERATES.md Part 2, "An exchange
// the conglomerate governs"): members pay none; anyone else pays the rate the stake vote set from stationTaxOptions,
// and it goes to the treasury, in place of the ISA's exchange tax. Everywhere else the ISA's tax is unchanged, and the
// Exchange's quote (GET /tariffs, stationTaxBreakdown) is what the sale charges.
const DAY = 24 * 60 * 60 * 1000;
const EARTH = C.homeStationId;
const EA = "earth-assembly";
const BOM = billOfMaterials();
let g, station;

async function player({ leases = 0 } = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  Object.assign(raw.state.corp, { currentStationId: C.charterStationId, completedInsights: [] });
  raw.state.corp.finances.credits = 3_000_000;
  raw.state.corp.miningLeases = Array.from({ length: leases }, (_, i) => ({ id: `lease-st-${reg.account.id}-${i}`, body: "Earth" }));
  return { id: reg.account.id, raw, corp: () => raw.state.corp, corpId: raw.state.corp.publicId, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}
const stock = (p, stationId, item, n) => { const inv = ((p.corp().inventory ||= {})[stationId] ||= {}); inv[item] = (inv[item] || 0) + n; };

beforeAll(async () => {
  // a level-4 conglomerate whose member funds a station in a fresh system through the real project
  const f = await player();
  accountsStore.accounts[f.id].createdAt = Date.now() - 8 * DAY;
  const res = await f.api.post(`${f.base}/conglomerates`).send({ name: `Taxers ${Date.now() % 1e6}`, emblem: 1, colour: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const c = findConglomerate(res.body.conglomerate.id);
  const join = async (opts) => { const p = await player(opts); const inv = inviteCorporation(f.id, c.id, p.corpId); expect(answerInvitation(p.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined(); return p; };
  const d = await join();
  setMemberRole(f.id, c.id, d.corpId, "director");
  const m = await join({ leases: 2 }); // three leases with the site's below: at an ISA station it would pay the lease royalty
  c.level = C.stationMinLevel;
  const s = [...SYSTEMS_BY_ID.values()].find((x) => x.id !== "sol" && (x.bodies || []).filter((b) => !stationAtBody(b.name)).length >= 2);
  const bodies = s.bodies.map((b) => b.name).filter((n) => !stationAtBody(n));
  m.corp().miningLeases.push({ id: "lease-st-site", body: bodies[0], leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [], issuedAt: Date.now() });
  const url = (p) => `${p.base}/conglomerates/${c.id}/station-project`;
  expect((await f.api.post(url(f)).send({ systemId: s.id, body: bodies[1], suffix: 1 })).status).toBe(201);
  const contribute = (body) => m.api.post(`${url(m)}/contribute`).send(body);
  expect((await contribute({ source: "own", credits: BOM.credits })).status).toBe(200);
  for (const [item, n] of Object.entries(BOM.goods)) { stock(m, EARTH, item, n); expect((await contribute({ source: "own", item, quantity: n })).status).toBe(200); }
  const p = c.stationProject;
  settleStationProjects(p.completesAt);
  expect(c.station).toBeTruthy();
  station = c.station.id;
  g = { f, d, m, c };
});

/** Dock `p` at `stationId` with `n` Silicates there, sell `quantity` to the standing Silicates bid; the row and money. */
async function sellToBid(p, stationId, quantity = 100) {
  p.corp().currentStationId = stationId;
  stock(p, stationId, "Silicates", quantity);
  p.corp().finances.expensesByCategory = {};
  const before = { credits: p.corp().finances.credits, treasury: g.c.treasury.credits, ea: Number(p.corp().standing?.[EA]) || 0 };
  const quote = (await p.api.get(`${p.base}/tariffs`)).body.here;
  const npc = getState().market.npcBuyOrders.find((o) => o.item === "Silicates");
  const res = await p.api.post(`/api/market/npc-orders/${npc.id}/sell`).send({ quantity });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const row = p.corp().tradeHistory.find((t) => t.type === "sold-npc");
  return { res, row, quote, before, spent: p.corp().finances.expensesByCategory, treasuryGain: g.c.treasury.credits - before.treasury, eaGain: (Number(p.corp().standing?.[EA]) || 0) - before.ea };
}

describe("the sales tax at a conglomerate's station (ISP-212b, AB#4655)", () => {
  it("starts at 8%, the option nearest the ISA's own tax, so a station's opening changes nobody's price", () => {
    expect(g.c.station.settings.taxPct).toBe(8);
  });

  it("a member pays none: no tax, no lease royalty, nothing to the treasury, and the quote says so", async () => {
    const { row, quote, spent, treasuryGain } = await sellToBid(g.m, station);
    expect(quote.stationTax).toMatchObject({ member: true, pct: 0, votedPct: 8, conglomerateName: g.c.name });
    expect(row).toMatchObject({ taxPct: 0, taxAmount: 0 });
    expect(spent["station-tax"] || 0).toBe(0);
    expect(spent["exchange-tax"] || 0).toBe(0);
    expect(spent["lease-royalty"] || 0).toBe(0);
    expect(treasuryGain).toBe(0);
    expect(row.proceeds).toBe(row.total - (row.tariffAmount || 0));
  });

  it("a non-member pays the voted rate, all of it to the treasury, booked as station tax, earning no Earth Assembly standing", async () => {
    const outsider = await player({ leases: 3 });
    const { res, row, quote, spent, treasuryGain, eaGain } = await sellToBid(outsider, station);
    expect(quote.stationTax).toMatchObject({ member: false, pct: 8 });
    expect(row.taxPct).toBe(8);
    expect(row.taxAmount).toBe(Math.round(row.total * 8 / 100));
    expect(spent["station-tax"]).toBe(row.taxAmount);
    expect(spent["exchange-tax"] || 0).toBe(0);
    expect(spent["lease-royalty"] || 0).toBe(0); // the ISA's royalty is part of the ISA's tax, which this replaces
    expect(treasuryGain).toBe(row.taxAmount);
    expect(g.c.ledger.at(-1)).toMatchObject({ kind: "station-tax", amount: row.taxAmount });
    expect(eaGain).toBe(0);
    expect(res.body.receipt.grants.find((x) => x.label === "Station tax").value).toContain(`to ${g.c.name}`);
    // the Exchange's quote, drawn from GET /tariffs with the shared arithmetic, is what was charged
    expect(taxOnSale(row.total, stationTaxBreakdown(quote.stationTax)).tax).toBe(row.taxAmount);
  });

  it("the rate is only ever one of stationTaxOptions, and changes by the stake vote", async () => {
    expect(proposeStationSetting(g.f.id, g.c.id, { setting: "tax", value: 3 }).refused).toMatchObject({ status: 400, code: "unknown-tax" });
    expect(proposeStationSetting(g.f.id, g.c.id, { setting: "tax", value: 8 }).refused).toMatchObject({ code: "already-set" });
    expect(proposeStationSetting(g.m.id, g.c.id, { setting: "tax", value: 2 }).refused).toMatchObject({ status: 403 }); // a member proposes nothing
    const proposed = proposeStationSetting(g.f.id, g.c.id, { setting: "tax", value: 2 });
    expect(proposed.proposal).toMatchObject({ state: "open", text: "Sales tax for non-members: 2% (members pay none)" });
    expect(g.c.station.settings.taxPct).toBe(8); // nothing changes until the stake decides
    const voted = voteOnStationProposal(g.m.id, g.c.id, proposed.proposal.id, "yes"); // the member holds the whole stake
    expect(voted.proposal.state).toBe("passed");
    expect(voted.settings).toMatchObject({ taxPct: 2, taxOptions: C.stationTaxOptions });

    const outsider = await player();
    const { row, quote, treasuryGain } = await sellToBid(outsider, station);
    expect(quote.stationTax.pct).toBe(2);
    expect(row.taxAmount).toBe(Math.round(row.total * 2 / 100));
    expect(treasuryGain).toBe(row.taxAmount);
  });

  it("the route takes a tax proposal as taxPct, and refuses one outside the options", async () => {
    const url = `${g.f.base}/conglomerates/${g.c.id}/station/proposals`;
    expect((await g.f.api.post(url).send({ setting: "tax", taxPct: 4 })).body).toMatchObject({ code: "unknown-tax" });
    const res = await g.f.api.post(url).send({ setting: "tax", taxPct: 5 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.proposal).toMatchObject({ setting: "tax", value: 5, state: "open" });
    expect(voteOnStationProposal(g.m.id, g.c.id, res.body.proposal.id, "yes").settings.taxPct).toBe(5);
  });

  it("a listing filled at the station pays the same: the seller's station tax to the treasury", async () => {
    const outsider = await player();
    const buyer = await player();
    outsider.corp().currentStationId = station;
    stock(outsider, station, "Silicates", 40);
    outsider.corp().finances.expensesByCategory = {};
    const listed = await outsider.api.post("/api/market/orders").send({ type: "sell", item: "Silicates", quantity: 40, unitPrice: 30 });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const orderId = getState().market.orderBook.find((o) => o.sellerAccountId === outsider.id)?.id;
    const before = g.c.treasury.credits;
    const bought = await buyer.api.post(`/api/market/orders/${orderId}/buy`).send({ quantity: 40 });
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    const sold = outsider.corp().tradeHistory.find((t) => t.type === "sold");
    expect(sold).toMatchObject({ total: 1200, taxPct: g.c.station.settings.taxPct, taxAmount: Math.round(1200 * g.c.station.settings.taxPct / 100) });
    expect(outsider.corp().finances.expensesByCategory["station-tax"]).toBe(sold.taxAmount);
    expect(g.c.treasury.credits - before).toBe(sold.taxAmount);
  });

  it("everywhere else the ISA's tax is unchanged, for members and non-members alike", async () => {
    for (const p of [g.m, await player({ leases: 3 })]) {
      const { row, quote, spent, treasuryGain } = await sellToBid(p, EARTH);
      expect(quote.stationTax).toBeNull();
      expect(row.taxPct).toBe(10); // 8% and 2 royalty points for three leases (ISP-302), as before
      expect(spent["lease-royalty"]).toBe(Math.round(row.total * 2 / 100));
      expect(spent["exchange-tax"]).toBe(row.taxAmount - spent["lease-royalty"]);
      expect(spent["station-tax"] || 0).toBe(0);
      expect(treasuryGain).toBe(0);
    }
  });
});
