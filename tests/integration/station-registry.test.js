import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { SYSTEMS_BY_ID, dataDir } from "../../server/game/catalog.js";
import { addStation, allStations, builtStationProblem, catalogStations, loadBuiltStations, reloadStations, stationAtBody, stationById } from "../../server/game/stations.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";
import { jumpsBetween } from "../../server/transfers.js";

// ISP-209 (AB#904): one station registry for the NPC catalog and the stations built in play (docs/design/CONGLOMERATES.md
// Part 2). A built station is found everywhere a catalog one is, persists across a restart, cannot take a catalog
// station's id or an occupied body, and a registry that cannot load stops the server.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const unique = (stem) => `${stem}-${Date.now() % 1e6}-${(seq += 1)}`;
/** A body in `systemId` with no station yet: registry order, so each call after an add finds the next one. */
const freeBody = (systemId) => SYSTEMS_BY_ID.get(systemId).bodies.map((b) => b.name).find((name) => !stationAtBody(name));
const station = (over = {}) => ({ id: unique("test-station"), name: "Test Haven Station", systemId: "sol", body: freeBody("sol"), owner: { type: "conglomerate", id: "cg-test" }, ...over });

async function conglomerate() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  raw.state.corp.currentStationId = C.charterStationId;
  raw.state.corp.finances.credits = 250_000;
  const name = `Registry ${Date.now() % 1e6} ${(seq += 1)}`;
  const res = await authed(app, reg.accessToken).post(`/api/accounts/${reg.account.id}/conglomerates`).send({ name, emblem: 1, colour: 1 });
  expect(res.status, JSON.stringify(res.status)).toBe(201);
  return { app, name, id: accountsStore.conglomerates.find((c) => c.name === name).id };
}

describe("the station registry (ISP-209, AB#904)", () => {
  it("returns the catalog's stations, each owned by nobody, through one function", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/stations.json"), "utf8")).stations;
    expect(catalogStations().map((s) => s.id)).toEqual(catalog.map((s) => s.id));
    expect(allStations().slice(0, catalog.length).map((s) => s.id)).toEqual(catalog.map((s) => s.id));
    for (const s of catalogStations()) expect(s.owner).toEqual({ type: "npc", id: null });
    expect(stationById("earth-station-prime").name).toBe("Earth Station Prime");
    expect(stationAtBody("Earth").id).toBe("earth-station-prime");
    expect(stationById("nowhere")).toBeNull();
  });

  it("adds a built station that every lookup then finds: by id, by body, in the list, and in the transfer routes", () => {
    const s = station();
    const added = addStation(s);
    expect(added.ok, added.error).toBe(true);
    expect(added.station).toMatchObject({ id: s.id, jurisdiction: "conglomerate", tier: 3, owner: { type: "conglomerate", id: "cg-test" } });
    expect(added.station.designation).toMatch(/^SOL-CGL-\d{3}$/);
    expect(stationById(s.id)).toBe(added.station);
    expect(stationAtBody(s.body).id).toBe(s.id);
    expect(allStations().at(-1).id).toBe(s.id);
    expect(jumpsBetween("earth-station-prime", s.id)).toBe(0); // same system
  });

  it("refuses a built station with a catalog station's id, a taken id or body, an unknown system or body, or no conglomerate owner", () => {
    const before = allStations().length;
    const cases = [
      [{ id: "earth-station-prime" }, /catalog station's id/],
      [{ body: "Earth" }, /already has a station/],
      [{ systemId: "andromeda" }, /no system/],
      [{ body: "Pluto" }, /no body/],
      [{ body: "Centauri II" }, /no body/], // a real body, in another system
      [{ owner: { type: "npc", id: null } }, /conglomerate's/],
      [{ owner: null }, /conglomerate's/],
      [{ id: "Bad Id!" }, /lower-case/],
      [{ name: "<script>" }, /station name/],
      [{ id: "__proto__" }, /lower-case/]
    ];
    for (const [over, why] of cases) {
      const res = addStation(station(over));
      expect(res.ok, JSON.stringify(over)).toBe(false);
      expect(res.error, JSON.stringify(over)).toMatch(why);
    }
    const taken = addStation(station());
    expect(taken.ok).toBe(true);
    expect(addStation(station({ id: taken.station.id })).error).toMatch(/already a station/);
    expect(allStations().length).toBe(before + 1);
    expect(stationById("earth-station-prime").owner.type).toBe("npc");
  });

  it("persists a built station, and a restart (a new process on the same data directory) has it", () => {
    const s = station({ systemId: "alpha-centauri", body: freeBody("alpha-centauri"), name: "Centauri Relay" });
    expect(addStation(s).ok).toBe(true);
    const out = spawnSync(process.execPath, ["--input-type=module", "-e",
      'const m = await import("./server/game/stations.js"); console.log(JSON.stringify(m.stationById(process.argv[1])));', s.id],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, ISP_DATA_DIR: dataDir } });
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout.trim().split("\n").at(-1))).toMatchObject({ id: s.id, name: "Centauri Relay", systemId: "alpha-centauri", body: s.body, owner: { type: "conglomerate", id: "cg-test" } });
    reloadStations(); // and this process, reloaded from the file, is unchanged
    expect(stationById(s.id)?.name).toBe("Centauri Relay");
  });

  it("fails closed: a built-stations file that is unreadable, or names a catalog id, stops the server from starting", () => {
    for (const content of ["{ not json", JSON.stringify({ stations: [{ ...station({ id: "earth-station-prime" }), jurisdiction: "conglomerate" }] }), JSON.stringify({ nope: [] })]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isp-stations-bad-"));
      fs.writeFileSync(path.join(dir, "stations-built.json"), content);
      expect(() => loadBuiltStations(dir)).toThrow(/will not start/);
      const run = spawnSync(process.execPath, ["server/index.js"], {
        cwd: ROOT, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, ISP_DATA_DIR: dir, PORT: "0", NODE_ENV: "test", JWT_SECRET: "station-registry-test-secret-0123456789" }
      });
      expect(run.status, run.stdout).not.toBe(0);
      expect(run.stderr).toMatch(/stations-built\.json/);
      expect(run.stdout).not.toMatch(/listening on port/);
    }
    expect(builtStationProblem({ ...station(), jurisdiction: "conglomerate" }, [])).toBeNull();
  });
});

describe("GET /api/stations (ISP-209, AB#904)", () => {
  it("returns both kinds, each with its owner as a type and a public name only", async () => {
    const { app, name, id } = await conglomerate();
    const s = station({ owner: { type: "conglomerate", id }, name: "Registry Test Station" });
    expect(addStation(s).ok).toBe(true);
    const res = await (await import("supertest")).default(app).get("/api/stations");
    expect(res.status).toBe(200);
    const earth = res.body.stations.find((x) => x.id === "earth-station-prime");
    const built = res.body.stations.find((x) => x.id === s.id);
    expect(earth).toMatchObject({ ownerType: "npc", ownerName: null, jurisdiction: "neutral" });
    expect(built).toMatchObject({ ownerType: "conglomerate", ownerName: name, jurisdiction: "conglomerate", systemId: "sol", body: s.body });
    for (const x of res.body.stations) expect(x).not.toHaveProperty("owner");
    expect(JSON.stringify(res.body)).not.toContain(id);
    expect(res.body.logistics).toBeTruthy();
  });
});
