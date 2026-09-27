import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ISP-209 (AB#904): every station lookup goes through server/game/stations.js, so a station built in play is found
// everywhere a catalog one is (P-HALF-FIX). A server file that reads data/stations.json itself, or keeps its own copy
// under one of the names the registry replaced, would see the catalog only; this fails on it.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = "server/game/stations.js";
const files = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []));
const SERVER = files("server");

describe("one station registry (ISP-209, AB#904)", () => {
  it("is the only server file that reads data/stations.json", () => {
    const readers = SERVER.filter((f) => f !== REGISTRY && /["'`/]stations\.json["'`]\s*\)/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(readers).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, REGISTRY), "utf8")).toMatch(/"stations\.json"\)/);
  });

  it("leaves no snapshot of the catalog under the names it replaced", () => {
    const old = /\b(STATIONS_RAW|STATIONS_DATA|STATION_REGISTRY|STATION_REGISTRY_CACHE|BODY_TO_STATION)\b/;
    expect(SERVER.filter((f) => old.test(fs.readFileSync(path.join(ROOT, f), "utf8")))).toEqual([]);
  });

  it("catches a reader written the ways the old ones were", () => {
    const re = /["'`/]stations\.json["'`]\s*\)/;
    for (const line of ['path.join(__dirname, "..", "data", "stations.json")', 'read("stations.json")', "new URL(`../data/stations.json`)"]) expect(re.test(line), line).toBe(true);
    expect(re.test('const FILE = { station: "stations.json", item: "items.json" };')).toBe(false); // a name in a message
  });
});
