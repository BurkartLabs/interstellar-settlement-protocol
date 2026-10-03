import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getState, mutateAccountState, getAccountById, peekCorp } from "../../server/gameState.js";
import { DAY_MS } from "../../server/finances.js";
import { SYSTEMS_DATA } from "../../server/game/catalog.js";
import { ensureBeltState, recordBeltScouted } from "../../server/game/belts.js";
import { applySurveyPayoff, drawEntry, openPacket } from "../../server/game/deskDraws.js";

// AB#4689 slice 6: what a correct Survey publishes (docs/design/desk-work.md section 5, the Board's decision 5).

async function deskCorp() {
  const { app } = await getApp();
  ensureBeltState(getState());
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.offices = [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 7 * DAY_MS }];
  });
  const api = authed(app, accessToken);
  const base = `/api/accounts/${account.id}/gameplay`;
  return {
    id: account.id,
    get: () => api.get(`${base}/desk`),
    answer: (body) => api.post(`${base}/desk/answer`).send(body),
    belts: () => api.get(`${base}/belt-compositions`),
    corp: () => getAccountById(account.id).state.corp
  };
}

/** Put a Survey of the wanted shape on the corporation's Desk, as slice 8 will draw at tier 2: the first draw whose subject fits. */
function openSurvey(desk, tier, wants) {
  const corp = peekCorp(desk.id);
  for (let draw = 1; draw < 2000; draw += 1) {
    const entry = { draw, kind: "survey", tier };
    const { key } = openPacket(desk.id, entry, { corp, belts: getState().belts });
    if (key.kind === "survey" && wants(key)) {
      mutateAccountState(desk.id, (state) => {
        state.corp.desk = { next: 5000, open: [entry, drawEntry(desk.id, 4998), drawEntry(desk.id, 4999)], paidDay: 0, paidToday: 0 };
      });
      return key;
    }
  }
  throw new Error("no such survey in 2000 draws");
}
const right = (key) => (key.tier === 1 ? { pick: key.truth[0].resource } : { ranking: key.truth.map((t) => t.resource), rarity: key.rarity, reserve: key.remaining });
const wrong = (key) => (key.tier === 1 ? { pick: "Not A Resource" } : { ranking: [...key.truth.map((t) => t.resource)].reverse() });
async function answer(desk, key, body) {
  const p = (await desk.get()).body.packets.find((x) => x.packet.ref === key.ref);
  return desk.answer({ draw: p.draw, fingerprint: p.fingerprint, answer: body });
}
const leaseBody = (key) => !key.subject.beltKey && Number(SYSTEMS_DATA.find((s) => s.id === key.subject.systemId).bodies.find((b) => b.id === key.subject.bodyId).leaseCost) > 0;

describe("a correct tier-2 belt survey scouts the belt (AB#4689 slice 6)", () => {
  it("shows the belt scouted for its current generation exactly as a probe's scouting does, and unscouted once it respawns", async () => {
    const surveyor = await deskCorp();
    const key = openSurvey(surveyor, 2, (k) => Boolean(k.subject.beltKey));
    const res = await answer(surveyor, key, right(key));
    expect(res.body.result).toMatchObject({ correct: true, published: { beltKey: key.subject.beltKey, scouted: true } });
    const surveyed = (await surveyor.belts()).body.belts[key.subject.beltKey];
    expect(surveyed.scouted).toBe(true);
    expect(surveyed.generation).toBe(key.subject.generation);

    // A probe's scouting writes the same field (scout-belt calls recordBeltScouted); the two views are the same.
    const prober = await deskCorp();
    mutateAccountState(prober.id, (state) => { state.corp.asteroidMining ||= {}; recordBeltScouted(state.corp.asteroidMining, getState().belts[key.subject.beltKey]); });
    expect((await prober.belts()).body.belts[key.subject.beltKey]).toEqual(surveyed);

    // The belt mined out and spawned again: a new generation, which this survey never saw.
    const belt = getState().belts[key.subject.beltKey];
    getState().belts[key.subject.beltKey] = { ...belt, generation: belt.generation + 1 };
    try {
      expect((await surveyor.belts()).body.belts[key.subject.beltKey].scouted).toBe(false);
    } finally {
      getState().belts[key.subject.beltKey] = belt;
    }
  });

  it("publishes nothing for a wrong answer", async () => {
    const desk = await deskCorp();
    const key = openSurvey(desk, 2, (k) => Boolean(k.subject.beltKey));
    const res = await answer(desk, key, wrong(key));
    expect(res.body.result).toMatchObject({ correct: false, published: null });
    const corp = desk.corp();
    expect(corp.asteroidMining?.scoutedBelts || []).not.toContain(key.subject.beltKey);
    expect(corp.surveys).toBeUndefined();
    expect((await desk.belts()).body.belts[key.subject.beltKey].scouted).toBe(false);
  });
});

describe("a correct survey of a lease body is stored for that corporation only", () => {
  it("tier 1 stores the dominant resource; another corporation learns nothing", async () => {
    const desk = await deskCorp();
    const other = await deskCorp();
    const key = openSurvey(desk, 1, leaseBody);
    const res = await answer(desk, key, right(key));
    expect(res.body.result.correct).toBe(true);
    const where = `${key.subject.systemId}:${key.subject.bodyId}`;
    expect(desk.corp().surveys[where]).toMatchObject({ tier: 1, dominant: key.truth[0].resource });
    expect(other.corp().surveys).toBeUndefined();
  });

  it("tier 2 stores the body's whole profile, and a later tier-1 survey does not shrink it", async () => {
    const desk = await deskCorp();
    const key = openSurvey(desk, 2, leaseBody);
    expect((await answer(desk, key, right(key))).body.result.correct).toBe(true);
    const where = `${key.subject.systemId}:${key.subject.bodyId}`;
    const body = SYSTEMS_DATA.find((s) => s.id === key.subject.systemId).bodies.find((b) => b.id === key.subject.bodyId);
    expect(desk.corp().surveys[where].profile).toEqual(body.resourceProfile.map((p) => ({ item: p.item, concentration: p.concentration })));
    const corp = desk.corp();
    applySurveyPayoff(corp, { ...key, tier: 1, truth: key.truth.slice(0, 1) }, getState().belts);
    expect(corp.surveys[where].profile).toBeDefined();
  });
});

describe("applySurveyPayoff", () => {
  it("does not scout a belt that respawned after the packet was drawn, and ignores any key but a survey's", () => {
    ensureBeltState(getState());
    const [beltKey, belt] = Object.entries(getState().belts).find(([, b]) => b.remaining > 0);
    const stale = { kind: "survey", tier: 2, subject: { systemId: beltKey.split(":")[0], bodyId: beltKey.split(":")[1], beltKey, generation: belt.generation - 1 }, truth: [{ resource: "Silicates" }] };
    const corp = {};
    expect(applySurveyPayoff(corp, stale, getState().belts)).toBeNull();
    expect(corp.asteroidMining).toBeUndefined();
    expect(applySurveyPayoff(corp, { kind: "audit", broken: [] }, getState().belts)).toBeNull();
    expect(corp).toEqual({});
  });
});
