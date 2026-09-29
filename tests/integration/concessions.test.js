import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { findConglomerate, inviteCorporation, answerInvitation } from "../../server/game/membership.js";
import { recordControlDay, resetControlHistory } from "../../server/controlService.js";
import { chargeUpkeep, concessionStatusFor, petitionConcession, publicConcession, relinquishConcession, renewConcessions, resetConcessions, reviewConcessions, upkeepFor } from "../../server/concessions.js";
import { CONGLOMERATE_CATALOG as CC } from "../../server/conglomerates.js";
import { WARFARE_CATALOG as W } from "../../server/warfare.js";

// ISP-227 (AB#922): the concession's life (docs/design/TERRITORY.md, the state list): petition, review, grant, renewal,
// upkeep, grace, challenge, relinquish and lapse, each transition tested, with the hostile inputs and the charter check.
const H = 3_600_000, DAY = 24 * H;
let app;
beforeAll(async () => { ({ app } = await getApp()); });
afterEach(() => { resetConcessions(); resetControlHistory(); });

async function corp({ systemId = "alpha-centauri", credits = 500_000 } = {}) {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - 8 * 86_400_000; // Bug #4801: registered long enough ago to join a conglomerate
  Object.assign(raw.state.corp, { currentSystemId: systemId });
  raw.state.corp.finances.credits = credits;
  const c = raw.state.corp;
  return { id: reg.account.id, raw, corp: c, holder: { type: "corp", id: c.publicId, name: c.corporationName }, api: authed(app, reg.accessToken), credits: () => Math.round(c.finances.credits) };
}
/** `n` daily control readings ending at `newestAt`: `systems` maps a system id to [[holder, score, extraction?], ...]. */
function readings(systems, newestAt, n = 14) {
  for (let i = n - 1; i >= 0; i -= 1) {
    const holders = Object.fromEntries(Object.entries(systems).map(([systemId, rows]) => [systemId, {
      live: ["extraction", "leases"],
      groups: rows.map(([h, score, extraction = score]) => ({ type: h.type, id: h.id, name: h.name, parts: { extraction, leases: 2 * score - extraction, sales: 0 } }))
    }]));
    recordControlDay({ computedAt: newestAt - i * DAY, holders });
  }
}
const stateOf = (systemId, holder) => publicConcession(systemId).holders.find((h) => h.holder.id === holder.id)?.state ?? null;

describe("petition, review and grant (AB#922)", () => {
  it("an eligible corporation, docked in the system, petitions for 25,000; after 72 hours of review it holds the concession for 30 days", async () => {
    const a = await corp(), b = await corp();
    const T = Date.now();
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2]] }, T - H);
    const before = a.credits();
    const r = petitionConcession(a.id, "alpha-centauri", T);
    expect(r.refused, JSON.stringify(r.refused)).toBeUndefined();
    expect(before - a.credits()).toBe(W.concessionPetitionFee);
    expect(publicConcession("alpha-centauri").petitions).toEqual([expect.objectContaining({ kind: "petition", holder: expect.objectContaining({ id: a.holder.id }), reviewEndsAt: T + 72 * H })]);
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2]] }, T + 71 * H - 60_000); // the daily readings go on
    reviewConcessions(T + 71 * H);
    expect(stateOf("alpha-centauri", a.holder)).toBeNull(); // still under review
    reviewConcessions(T + 72 * H);
    expect(publicConcession("alpha-centauri").holders).toEqual([expect.objectContaining({ state: "granted", grantedAt: T + 72 * H, termEndsAt: T + 72 * H + 30 * DAY, benefits: true })]);
  });

  it("refuses, charging nothing: ineligible, not docked, never concedable, a replay, and unreadable scores (fails closed)", async () => {
    const a = await corp(), b = await corp(), away = await corp({ systemId: "sol" });
    const T = Date.now();
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2], [away.holder, 0.1]], sol: [[away.holder, 1]] }, T - H);
    const credits = b.credits();
    expect(petitionConcession(b.id, "alpha-centauri", T).refused.code).toBe("not-eligible");
    expect(petitionConcession(away.id, "alpha-centauri", T).refused.code).toBe("not-docked");
    expect(petitionConcession(away.id, "sol", T).refused.code).toBe("never-concedable");
    expect(petitionConcession(a.id, "alpha-centauri", T).refused).toBeUndefined();
    expect(petitionConcession(a.id, "alpha-centauri", T + 1).refused.code).toBe("already-petitioned"); // a replay
    expect(b.credits()).toBe(credits);
    resetControlHistory();
    readings({ "barnards-star": [[b.holder, 0.9]] }, T - 30 * H, 7); // the newest reading is older than 26 hours
    b.corp.currentSystemId = "barnards-star";
    expect(petitionConcession(b.id, "barnards-star", T).refused).toMatchObject({ status: 503, code: "no-reading" });
  });

  it("over HTTP, the holder is the caller's own: a holder named in the body is ignored, and a hostile system id is 404", async () => {
    const a = await corp(), b = await corp();
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2]] }, Date.now() - H);
    const res = await b.api.post(`/api/accounts/${b.id}/concessions/alpha-centauri/petition`).send({ holder: a.holder, holderId: a.holder.id });
    expect(res.status).toBe(409); // b petitions for b, and b is not eligible
    expect((await a.api.post(`/api/accounts/${a.id}/concessions/alpha-centauri/petition`).send({})).status).toBe(201);
    expect((await a.api.post(`/api/accounts/${b.id}/concessions/alpha-centauri/petition`).send({})).status).toBe(403); // another's account
    expect((await a.api.post(`/api/accounts/${a.id}/concessions/atlantis/petition`).send({})).status).toBe(404);
    expect((await a.api.get("/api/systems/alpha-centauri/concession")).body.petitions[0].holder.id).toBe(a.holder.id);
  });

  it("two petitions for one system at once: exactly one wins", async () => {
    // Alpha Centauri has one place, and only one holder can be eligible there: the second is refused at the door.
    const a = await corp(), b = await corp();
    const T = Date.now();
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.3]] }, T - H);
    const both = [petitionConcession(a.id, "alpha-centauri", T), petitionConcession(b.id, "alpha-centauri", T)];
    expect(both.filter((r) => !r.refused)).toHaveLength(1);
    // 61 Cygni has two places, one held: two eligible petitioners in the same review, and the higher score wins the place.
    const x = await corp({ systemId: "61-cygni" }), y = await corp({ systemId: "61-cygni" }), z = await corp({ systemId: "61-cygni" });
    readings({ "61-cygni": [[x.holder, 0.45], [y.holder, 0.42], [z.holder, 0.1]] }, T - H);
    petitionConcession(x.id, "61-cygni", T);
    readings({ "61-cygni": [[x.holder, 0.45], [y.holder, 0.42], [z.holder, 0.1]] }, T + 71 * H);
    reviewConcessions(T + 72 * H);
    resetControlHistory();
    readings({ "61-cygni": [[y.holder, 0.46], [z.holder, 0.44], [x.holder, 0.05]] }, T + 72 * H);
    expect(petitionConcession(y.id, "61-cygni", T + 73 * H).refused).toBeUndefined();
    expect(petitionConcession(z.id, "61-cygni", T + 73 * H).refused).toBeUndefined();
    readings({ "61-cygni": [[y.holder, 0.46], [z.holder, 0.44], [x.holder, 0.05]] }, T + 144 * H);
    reviewConcessions(T + 73 * H + 72 * H);
    const holders = publicConcession("61-cygni").holders.map((h) => h.holder.id).sort();
    expect(holders).toEqual([x.holder.id, y.holder.id].sort());
  });

  it("a petitioner no longer eligible when review ends fails, and keeps no fee back", async () => {
    const a = await corp(), b = await corp();
    const T = Date.now();
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2]] }, T - H);
    petitionConcession(a.id, "alpha-centauri", T);
    readings({ "alpha-centauri": [[a.holder, 0.35], [b.holder, 0.3]] }, T + 71 * H, 1); // a slips below 40% on the last day
    const credits = a.credits();
    reviewConcessions(T + 72 * H);
    expect(stateOf("alpha-centauri", a.holder)).toBeNull();
    expect(publicConcession("alpha-centauri").register[0]).toMatchObject({ event: "petition-failed" });
    expect(a.credits()).toBe(credits);
  });

  it("in an unregulated system (Luyten 726-8) an eligible petition is granted at once", async () => {
    const a = await corp({ systemId: "luyten-726-8" });
    const T = Date.now();
    readings({ "luyten-726-8": [[a.holder, 0.8]] }, T - H);
    petitionConcession(a.id, "luyten-726-8", T);
    expect(stateOf("luyten-726-8", a.holder)).toBe("granted");
  });

  it("a conglomerate's founder petitions from the treasury; a director cannot", async () => {
    const f = await corp(), d = await corp();
    f.raw.createdAt = Date.now() - 8 * DAY;
    f.corp.currentStationId = CC.charterStationId;
    const res = await f.api.post(`/api/accounts/${f.id}/conglomerates`).send({ name: `Claimants ${Date.now() % 1e6}`, emblem: 1, colour: 1 });
    const c = findConglomerate(res.body.conglomerate.id);
    const inv = inviteCorporation(f.id, c.id, d.corp.publicId);
    answerInvitation(d.id, c.id, inv.invitation.id, "accept");
    c.members.find((m) => m.corp === d.corp.publicId).role = "director";
    await f.api.post(`/api/accounts/${f.id}/conglomerates/${c.id}/treasury/deposit`).send({ amount: 100_000 });
    f.corp.currentSystemId = "alpha-centauri";
    const holder = { type: "conglomerate", id: c.id, name: c.name };
    const T = Date.now();
    readings({ "alpha-centauri": [[holder, 0.7]] }, T - H);
    expect(petitionConcession(d.id, "alpha-centauri", T).refused.status).toBe(403);
    const treasury = c.treasury.credits;
    expect(petitionConcession(f.id, "alpha-centauri", T).refused).toBeUndefined();
    expect(treasury - c.treasury.credits).toBe(W.concessionPetitionFee);
  });
});

describe("renewal, upkeep, grace and lapse (AB#922)", () => {
  async function granted(systemId = "alpha-centauri", credits = 500_000) {
    const a = await corp({ systemId, credits });
    const T = Date.now();
    readings({ [systemId]: [[a.holder, 0.6]] }, T - H);
    petitionConcession(a.id, systemId, T);
    readings({ [systemId]: [[a.holder, 0.6]] }, T + 71 * H);
    reviewConcessions(T + 72 * H);
    return { a, T, grantedAt: T + 72 * H };
  }

  it("renews at the term's end while the holder keeps 25%, and lapses below it (then a cooldown before a new petition)", async () => {
    const { a, grantedAt } = await granted();
    const end = grantedAt + 30 * DAY;
    readings({ "alpha-centauri": [[a.holder, 0.3]] }, end - H, 1);
    renewConcessions(end);
    expect(publicConcession("alpha-centauri").holders[0].termEndsAt).toBe(end + 30 * DAY);
    readings({ "alpha-centauri": [[a.holder, 0.2]] }, end + 30 * DAY - H, 14);
    renewConcessions(end + 30 * DAY);
    expect(stateOf("alpha-centauri", a.holder)).toBeNull();
    readings({ "alpha-centauri": [[a.holder, 0.9]] }, end + 30 * DAY + H, 14);
    expect(petitionConcession(a.id, "alpha-centauri", end + 30 * DAY + 2 * H).refused.code).toBe("cooldown");
  });

  it("charges upkeep daily on the k-squared curve with the use discount, from the holder's credits", async () => {
    const one = await granted("alpha-centauri");
    const a = one.a;
    // a second concession for the same holder, in Luyten (granted at once)
    a.corp.currentSystemId = "luyten-726-8";
    readings({ "alpha-centauri": [[a.holder, 0.5]], "luyten-726-8": [[a.holder, 0.5]] }, one.grantedAt, 14);
    petitionConcession(a.id, "luyten-726-8", one.grantedAt + H);
    // k = 2: each costs 800 x 2, less 50% x 0.5 = 25% for the use discount: 1,200 a day, 2,400 in all (base x k² x 0.75)
    expect(upkeepFor(a.holder, "alpha-centauri", one.grantedAt + H)).toBe(1200);
    const before = a.credits();
    chargeUpkeep(one.grantedAt + DAY);
    expect(before - a.credits()).toBe(2400);
    // once a UTC day: an hour later, or the day's last millisecond when the run is in its last hour (Bug #4692)
    chargeUpkeep(Math.min(one.grantedAt + DAY + H, Math.floor((one.grantedAt + DAY) / DAY) * DAY + DAY - 1));
    expect(before - a.credits()).toBe(2400);
  });

  it("upkeep it cannot pay suspends the benefits (grace) without touching the balance; paid the next day it recovers; seven days unpaid, it lapses", async () => {
    const { a, grantedAt } = await granted();
    a.corp.finances.credits = 100;
    chargeUpkeep(grantedAt + DAY);
    expect(a.credits()).toBe(100); // never pushed below what it had
    expect(publicConcession("alpha-centauri").holders[0]).toMatchObject({ state: "grace", benefits: false });
    a.corp.finances.credits = 50_000;
    chargeUpkeep(grantedAt + 2 * DAY);
    expect(stateOf("alpha-centauri", a.holder)).toBe("granted");
    a.corp.finances.credits = 0;
    for (let d = 3; d <= 10; d += 1) chargeUpkeep(grantedAt + d * DAY);
    expect(a.credits()).toBe(0);
    expect(stateOf("alpha-centauri", a.holder)).toBeNull();
    expect(publicConcession("alpha-centauri").register[0]).toMatchObject({ event: "lapsed", why: "upkeep unpaid" });
  });

  it("a lapse takes the concession and nothing else: leases, buildings and inventory are unchanged", async () => {
    const { a } = await granted();
    a.corp.miningLeases = [{ id: "lease-1", body: "Earth" }];
    a.corp.buildings = [...(a.corp.buildings || []), { id: "bld-kept", name: "Refinery", tier: 1 }];
    a.corp.inventory = { "centauri-prime-station": { Nickel: 400 } };
    const snapshot = JSON.stringify({ l: a.corp.miningLeases, b: a.corp.buildings, i: a.corp.inventory });
    const credits = a.credits();
    expect(relinquishConcession(a.id, "alpha-centauri").refused).toBeUndefined();
    expect(stateOf("alpha-centauri", a.holder)).toBeNull();
    expect(JSON.stringify({ l: a.corp.miningLeases, b: a.corp.buildings, i: a.corp.inventory })).toBe(snapshot);
    expect(a.credits()).toBe(credits);
  });

  it("a challenger no longer clearing the bar when review ends fails, and the holder keeps the concession", async () => {
    const { a, grantedAt } = await granted();
    const c = await corp();
    readings({ "alpha-centauri": [[c.holder, 0.6, 0.5], [a.holder, 0.2, 0.2]] }, grantedAt + DAY);
    expect(petitionConcession(c.id, "alpha-centauri", grantedAt + DAY + H).refused).toBeUndefined();
    readings({ "alpha-centauri": [[a.holder, 0.5, 0.6], [c.holder, 0.3, 0.3]] }, grantedAt + DAY + 72 * H, 1); // the holder answers
    reviewConcessions(grantedAt + DAY + H + 72 * H);
    expect(stateOf("alpha-centauri", a.holder)).toBe("granted");
    expect(stateOf("alpha-centauri", c.holder)).toBeNull();
  });

  it("a term that ends in grace lapses rather than renewing", async () => {
    const { a, grantedAt } = await granted();
    a.corp.finances.credits = 0;
    chargeUpkeep(grantedAt + 29 * DAY);
    expect(stateOf("alpha-centauri", a.holder)).toBe("grace");
    readings({ "alpha-centauri": [[a.holder, 0.9]] }, grantedAt + 30 * DAY - H, 1);
    renewConcessions(grantedAt + 30 * DAY);
    expect(stateOf("alpha-centauri", a.holder)).toBeNull();
  });

  it("a challenge that beats the holder by the ADM margin takes the concession at review end; one that cannot is refused at the door", async () => {
    const { a, grantedAt } = await granted();
    const c = await corp();
    // c is eligible (50%, and at least 1.5 x 30%), but the holder mines half the tonnes (U = 0.5): the bar is
    // 30% x 1.5 x (1 + 0.5 x 0.5) = 56.25%, not beaten (Bug #4667: the margin on top of the lead)
    readings({ "alpha-centauri": [[c.holder, 0.5, 0.5], [a.holder, 0.3, 0.5]] }, grantedAt + DAY);
    expect(petitionConcession(c.id, "alpha-centauri", grantedAt + DAY + H).refused.code).toBe("below-bar");
    // c 60%; the holder 20% with a fifth of the tonnes: the bar is 20% x 1.5 x 1.1 = 33%
    resetControlHistory();
    readings({ "alpha-centauri": [[c.holder, 0.6, 0.5], [a.holder, 0.2, 0.2]] }, grantedAt + DAY);
    expect(petitionConcession(c.id, "alpha-centauri", grantedAt + DAY + H).refused).toBeUndefined();
    expect(publicConcession("alpha-centauri").petitions[0].kind).toBe("challenge");
    readings({ "alpha-centauri": [[c.holder, 0.6, 0.5], [a.holder, 0.2, 0.2]] }, grantedAt + DAY + 72 * H);
    reviewConcessions(grantedAt + DAY + H + 72 * H);
    expect(stateOf("alpha-centauri", a.holder)).toBeNull();
    expect(stateOf("alpha-centauri", c.holder)).toBe("granted");
  });
});

// ISP-229 (AB#924): what the starmap and the viewer's panel read.
describe("the starmap register and the viewer's own status (AB#924)", () => {
  it("lists every system's holders and open petitions publicly, and tells the viewer its own eligibility and costs", async () => {
    const a = await corp(), b = await corp();
    const T = Date.now();
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2]] }, T - H);
    const before = (await b.api.get(`/api/accounts/${b.id}/concessions/alpha-centauri`)).body;
    expect(before).toMatchObject({ concedable: true, eligible: false, petition: { kind: "petition", fee: W.concessionPetitionFee } });
    expect(before.petition.refusal).toMatch(/40% control/);
    const mine = (await a.api.get(`/api/accounts/${a.id}/concessions/alpha-centauri`)).body;
    expect(mine).toMatchObject({ eligible: true, streakDays: 14, petition: { refusal: null, upkeepIfGranted: expect.any(Number) } });
    petitionConcession(a.id, "alpha-centauri", T);
    const board = (await a.api.get("/api/starmap/concessions")).body;
    expect(board.systems["alpha-centauri"].petitions).toEqual([expect.objectContaining({ kind: "petition", name: a.holder.name })]);
    expect(board.systems.sol).toMatchObject({ concedable: false });
    expect(JSON.stringify(board)).not.toMatch(/acc-/);
    readings({ "alpha-centauri": [[a.holder, 0.6], [b.holder, 0.2]] }, T + 71 * H);
    reviewConcessions(T + 72 * H);
    const holds = concessionStatusFor(a.id, "alpha-centauri", T + 73 * H);
    expect(holds.holds).toMatchObject({ state: "granted", ownLeaseDiscountPct: 25, leaseDiscountPct: 0, leaseDiscountMaxPct: 25 });
    expect((await b.api.get(`/api/accounts/${b.id}/concessions/atlantis`)).status).toBe(404);
  });
});
