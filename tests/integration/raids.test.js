import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { createAccount, getAccountById, getState, listAccountNotifications, mutateAccountState } from "../../server/gameState.js";
import { accountsStore, saveAccountsNow, saveStateNow } from "../../server/game/store.js";
import { dataDir } from "../../server/game/catalog.js";
import { settleFleets } from "../../server/fleets.js";
import { settleContracts } from "../../server/mercenaries.js";
import { RAID_RULES, declareRaid, recallRaid } from "../../server/raids.js";

// ISP-178 (AB#872): declaring a raid (docs/design/v0.10-raids-mercenaries.md, sections 2 and 4; the Board on AB#705:
// "14 day new player protection. No offline protection."). Time is passed in (P-TEST-TIME) where a boundary is tested.
const EARTH = "earth-station-prime";
const HOUR = 3_600_000, DAY = 24 * HOUR;

/** Backdate an account's creation: protection is 14 days from it. */
const age = (id, ms, now = Date.now()) => { accountsStore.accounts[id].createdAt = now - ms; };

async function corporation({ units = { lf: 10, ds: 2 }, credits = 1_000_000, days = 30, goods = null } = {}) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const id = reg.account.id;
  mutateAccountState(id, (state) => {
    state.corp.currentStationId = EARTH;
    state.corp.finances.credits = credits;
    state.corp.military = { units };
    if (goods) state.corp.inventory = { ...(state.corp.inventory || {}), [EARTH]: goods };
  }, { sanitize: false, settleMining: false });
  age(id, days * DAY);
  const api = authed(app, reg.accessToken);
  const at = (p) => `/api/accounts/${id}/gameplay${p}`;
  const corp = () => getAccountById(id).state.corp;
  return { id, reg, api, at, corp, publicId: corp().publicId, state: () => JSON.stringify(getAccountById(id).state) };
}
const fleet = async (c, units = { lf: 4, ds: 1 }) => (await c.api.post(c.at("/fleets/form")).send(units)).body.fleet.id;
const target = (goods = { Silicates: 500 }) => corporation({ units: {}, goods });
const raid = (a, body) => a.api.post(a.at("/raids")).send(body);
const raidsInState = () => getState()?.market?.raids || [];

describe("ISP-178 declaring a raid", () => {
  it("sends the fleet at once, arrives after max(travel, 4 hours), and warns the defender with who, where, when and what", async () => {
    const a = await corporation();
    const d = await target();
    const fleetId = await fleet(a);
    const r = await raid(a, { fleetId, targetCorpId: d.publicId, targetStationId: EARTH });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const view = r.body.raid;
    expect(view).toMatchObject({ attackerCorpId: a.publicId, targetCorpId: d.publicId, targetStationId: EARTH, originStationId: EARTH, state: "inbound", units: { lf: 4, ds: 1, se: 0, at: 0 } });
    expect(view.arrivesAt - view.declaredAt).toBe(RAID_RULES.warningFloorHours * HOUR); // same station: travel is under the floor
    expect(JSON.stringify(r.body)).not.toContain(a.id);
    const f = a.corp().military.fleets.find((x) => x.id === fleetId);
    expect(f).toMatchObject({ stationId: null, transit: { toStationId: EARTH, raidId: view.id, arrivesAt: view.arrivesAt } });
    expect(raidsInState().find((x) => x.id === view.id)).toMatchObject({ state: "inbound" });
    const warning = listAccountNotifications(d.id).notifications.find((n) => n.title === "Raid incoming");
    expect(warning.body).toContain(a.corp().corporationName);
    expect(warning.body).toContain("Earth Station Prime");
    expect(warning.body).toContain(new Date(view.arrivesAt).toUTCString().replace(/:\d\d GMT$/, " UTC"));
    expect(warning.body).toContain("4 Light Fighter, 1 Destroyer");
    // the fleet takes no other order while it is out
    expect((await a.api.post(a.at(`/fleets/${fleetId}/deploy`)).send({ toStationId: "luna-gateway" })).status).not.toBe(200);
    // an arrival does not station a raiding fleet at its target
    const corp = structuredClone(a.corp());
    settleFleets(corp, view.arrivesAt + 1);
    expect(corp.military.fleets.find((x) => x.id === fleetId).stationId).toBeNull();
  });

  it("never reads whether the defender is online: a corporation that has never signed in is raided the same way", async () => {
    const a = await corporation();
    const { account } = await createAccount({ email: `offline-${Date.now()}@example.test`, password: "never signs in 123", ceoName: "Absent", corpName: `Absent Co ${Date.now() % 100_000}` });
    mutateAccountState(account.id, (s) => { s.corp.inventory = { [EARTH]: { Silicates: 50 } }; }, { sanitize: false, settleMining: false });
    age(account.id, 20 * DAY);
    const r = await raid(a, { fleetId: await fleet(a), targetCorpId: getAccountById(account.id).state.corp.publicId, targetStationId: EARTH });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe("ISP-178 who may be raided", () => {
  it("new-player protection: 13 days 23 hours is refused, 14 days is accepted (server time); an attacker inside its own 14 days is refused", async () => {
    const now = Date.now();
    const a = await corporation();
    const young = await target(), grown = await target();
    age(young.id, 14 * DAY - HOUR, now);
    age(grown.id, 14 * DAY, now);
    const f1 = await fleet(a), f2 = await fleet(a);
    const refused = declareRaid(a.id, { fleetId: f1, targetCorpId: young.publicId, targetStationId: EARTH }, now);
    expect(refused).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/new-player protection/) });
    expect(declareRaid(a.id, { fleetId: f2, targetCorpId: grown.publicId, targetStationId: EARTH }, now).ok).toBe(true);

    const newcomer = await corporation({ days: 13 });
    const r = await raid(newcomer, { fleetId: await fleet(newcomer), targetCorpId: grown.publicId, targetStationId: EARTH });
    expect(r.body.error).toMatch(/cannot raid until its first 14 days/);
  });

  it("refuses, changing nothing: itself, an unknown corporation, a station where the target holds nothing, a fleet travelling or under contract", async () => {
    const a = await corporation();
    const d = await target();
    const f = await fleet(a);
    const before = a.state(), raids = raidsInState().length;
    expect((await raid(a, { fleetId: f, targetCorpId: a.publicId, targetStationId: EARTH })).status).toBe(400);
    expect((await raid(a, { fleetId: f, targetCorpId: "corp-nope", targetStationId: EARTH })).status).toBe(404);
    expect((await raid(a, { fleetId: f, targetCorpId: d.publicId, targetStationId: "not-a-station" })).status).toBe(400);
    expect((await raid(a, { fleetId: f, targetCorpId: d.publicId, targetStationId: "luna-gateway" })).body.error).toMatch(/holds nothing/);
    expect((await raid(a, { fleetId: "flt-nope", targetCorpId: d.publicId, targetStationId: EARTH })).status).toBe(404);
    expect(a.state()).toBe(before);
    expect(raidsInState().length).toBe(raids);
    await a.api.post(a.at(`/fleets/${f}/deploy`)).send({ toStationId: "luna-gateway" });
    expect((await raid(a, { fleetId: f, targetCorpId: d.publicId, targetStationId: EARTH })).body.error).toMatch(/travelling/);
    const g = await fleet(a, { lf: 2 });
    await a.api.post(a.at("/mercenaries/offer")).send({ fleetId: g, termHours: 24, price: 5_000, collateral: 1, allowedUse: "raids" });
    expect((await raid(a, { fleetId: g, targetCorpId: d.publicId, targetStationId: EARTH })).body.error).toMatch(/under contract|offered or hired/);
  });

  it("the post-raid cooldown: a target raided until now + 1 is refused, until now is accepted", async () => {
    const now = Date.now();
    const a = await corporation();
    const d = await target();
    mutateAccountState(d.id, (s) => { s.corp.raidCooldownUntil = now + 1; }, { sanitize: false, settleMining: false });
    expect(declareRaid(a.id, { fleetId: await fleet(a), targetCorpId: d.publicId, targetStationId: EARTH }, now).error).toMatch(/raided recently/);
    mutateAccountState(d.id, (s) => { s.corp.raidCooldownUntil = now; }, { sanitize: false, settleMining: false });
    expect(declareRaid(a.id, { fleetId: await fleet(a), targetCorpId: d.publicId, targetStationId: EARTH }, now).ok).toBe(true);
  });

  it("the repeat limit: 2 raids on one target in 7 days; the third is refused until the first is 7 days old", async () => {
    const now = Date.now();
    const a = await corporation({ units: { lf: 12 } });
    const d = await target();
    const f = [await fleet(a, { lf: 2 }), await fleet(a, { lf: 2 }), await fleet(a, { lf: 2 })];
    const first = declareRaid(a.id, { fleetId: f[0], targetCorpId: d.publicId, targetStationId: EARTH }, now - 7 * DAY + 1);
    expect(first.ok).toBe(true);
    expect(declareRaid(a.id, { fleetId: f[1], targetCorpId: d.publicId, targetStationId: EARTH }, now).ok).toBe(true);
    expect(declareRaid(a.id, { fleetId: f[2], targetCorpId: d.publicId, targetStationId: EARTH }, now).error).toMatch(/At most 2 raids on the same corporation in 7 days/);
    expect(declareRaid(a.id, { fleetId: f[2], targetCorpId: d.publicId, targetStationId: EARTH }, now + 1).ok).toBe(true); // the first is now 7 days old
  });

  it("the rate limit: 6 declarations an hour, then 429", async () => {
    const a = await corporation({ units: { lf: 14 } });
    const targets = [await target(), await target(), await target(), await target()];
    const fleets = [];
    for (let i = 0; i < 7; i++) fleets.push(await fleet(a, { lf: 2 }));
    const order = [0, 0, 1, 1, 2, 2, 3];
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await raid(a, { fleetId: fleets[i], targetCorpId: targets[order[i]].publicId, targetStationId: EARTH })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });
});

describe("ISP-178 recall", () => {
  it("turns the fleet round before arrival; it is home after the time it had flown; after arrival it cannot", async () => {
    const now = Date.now();
    const a = await corporation();
    const d = await target();
    const f = await fleet(a);
    const r = declareRaid(a.id, { fleetId: f, targetCorpId: d.publicId, targetStationId: EARTH }, now).raid;
    const back = recallRaid(a.id, r.id, now + HOUR);
    expect(back.raid).toMatchObject({ state: "recalled", returnsAt: now + 2 * HOUR });
    expect(recallRaid(a.id, r.id, now + HOUR).status).toBe(409);
    const corp = structuredClone(a.corp());
    settleFleets(corp, now + 2 * HOUR);
    expect(corp.military.fleets.find((x) => x.id === f)).toMatchObject({ stationId: EARTH, transit: null });
    expect(listAccountNotifications(d.id).notifications.some((n) => n.title === "Raid called off")).toBe(true);
    const r2 = declareRaid(a.id, { fleetId: await fleet(a), targetCorpId: d.publicId, targetStationId: EARTH }, now + 3 * HOUR).raid;
    expect(recallRaid(a.id, r2.id, r2.arrivesAt).status).toBe(409);
    expect(recallRaid(d.id, r2.id, now + 3 * HOUR).status).toBe(404); // only the attacker's
  });
});

describe("ISP-178 hired fleets", () => {
  it("a raids contract's fleet may be sent; a defense-only one may not; its term waits while it is out", async () => {
    const owner = await corporation();
    const renter = await corporation();
    const d = await target();
    const offerFor = async (allowedUse) => {
      const fid = await fleet(owner, { lf: 2 });
      return (await owner.api.post(owner.at("/mercenaries/offer")).send({ fleetId: fid, termHours: 12, price: 5_000, collateral: 1, allowedUse })).body.offer.id;
    };
    const defense = await offerFor("defense"), raids = await offerFor("raids");
    for (const o of [defense, raids]) expect((await renter.api.post(renter.at(`/mercenaries/${o}/hire`)).send({})).status).toBe(200);
    expect((await raid(renter, { contractId: defense, targetCorpId: d.publicId, targetStationId: EARTH })).body.error).toMatch(/does not permit raids/);
    const r = await raid(renter, { contractId: raids, targetCorpId: d.publicId, targetStationId: EARTH });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.raid.hired).toBe(true);
    expect((await raid(renter, { contractId: raids, targetCorpId: owner.publicId, targetStationId: EARTH })).status).not.toBe(200);
    // the 12-hour term has ended, but the fleet is still out: the contract waits
    settleContracts(Date.now() + 13 * HOUR);
    const offer = getState().market.mercenaryOffers.find((o) => o.id === raids);
    expect(offer.state).toBe("hired");
  });
});

describe("ISP-178 a raid survives a restart mid-flight", () => {
  const children = [];
  afterAll(() => { for (const child of children) child.kill(); });

  it("a second server on the same save shows the raid inbound and the fleet still out", async () => {
    const a = await corporation();
    const d = await target();
    const r = (await raid(a, { fleetId: await fleet(a), targetCorpId: d.publicId, targetStationId: EARTH })).body.raid;
    await saveAccountsNow();
    saveStateNow();
    const dir = fs.mkdtempSync(path.join(process.env.ISP_TEST_DATA_ROOT, "raid-restart-"));
    for (const file of ["accounts-snapshot.json", "state.json"]) fs.copyFileSync(path.join(dataDir, file), path.join(dir, file));
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.resolve(import.meta.dirname, "..", ".."),
      env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", ISP_DISABLE_TICKERS: "1", ISP_DEV: "", NODE_ENV: "test", JWT_SECRET: "raid-restart-secret-0123456789abcdef" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(child);
    const url = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`server did not listen: ${out}`)), 20_000);
      const read = (chunk) => { out += chunk; const port = out.match(/listening on port (\d+)/)?.[1]; if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
    });
    const login = await request(url).post("/api/auth/login").send({ email: a.reg.body.email, password: a.reg.body.password });
    expect(login.status).toBe(200);
    const auth = (req) => req.set("Authorization", `Bearer ${login.body.accessToken}`);
    const raids = await auth(request(url).get(`/api/accounts/${a.id}/gameplay/raids`));
    expect(raids.body.outgoing.find((x) => x.id === r.id)).toMatchObject({ state: "inbound", arrivesAt: r.arrivesAt });
    const account = await auth(request(url).get(`/api/accounts/${a.id}`));
    expect(account.body.state.corp.military.fleets.find((x) => x.transit?.raidId === r.id)).toMatchObject({ stationId: null, transit: { arrivesAt: r.arrivesAt } });
  }, 60_000);
});
