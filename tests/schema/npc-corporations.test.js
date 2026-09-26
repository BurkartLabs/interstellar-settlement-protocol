import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NPC_CATALOG, NPC_NAMES, readNpcCatalog, reservedNamesError } from "../../server/npcCorporations.js";
import { RESERVED_CORPORATION_NAMES } from "../../server/gameState.js";
import { PRICE_HISTORY_ITEMS } from "../../server/priceHistory.js";

// ISP-121 (AB#813): data/npc-corporations.json is docs/design/npc-corporations.md's roster (AB#812).
const read = (rel) => JSON.parse(fs.readFileSync(new URL(`../../data/${rel}`, import.meta.url), "utf8"));
const stations = read("stations.json");
const STATIONS = new Map((Array.isArray(stations) ? stations : stations.stations).map((s) => [s.id, s]));
const DESIGN = fs.readFileSync(new URL("../../docs/design/npc-corporations.md", import.meta.url), "utf8");

describe("the NPC corporation catalog (AB#813)", () => {
  it("loads, and holds every corporation the design's roster names, no more", () => {
    expect(reservedNamesError).toBeNull();
    const roster = [...DESIGN.matchAll(/^\| \*\*([^*]+)\*\* \| /gm)].map((m) => m[1]);
    expect(roster).toHaveLength(6);
    expect(NPC_CATALOG.corporations.map((c) => c.name).sort()).toEqual([...roster].sort());
  });

  it("puts every corporation at a station in Sol that exists", () => {
    for (const c of NPC_CATALOG.corporations) {
      expect(STATIONS.get(c.homeStationId), `${c.name}: ${c.homeStationId}`).toBeDefined();
      expect(STATIONS.get(c.homeStationId).systemId, c.name).toBe("sol");
    }
  });

  it("gives each an id, a flavour line and goods the exchange trades, with no name or id twice", () => {
    const ids = NPC_CATALOG.corporations.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(NPC_NAMES.map((n) => n.toLowerCase())).size).toBe(NPC_NAMES.length);
    for (const c of NPC_CATALOG.corporations) {
      expect(c.id, c.name).toMatch(/^[a-z0-9-]+$/);
      expect(c.flavour.length, c.name).toBeGreaterThan(20);
      expect(c.trades.length, c.name).toBeGreaterThan(0);
      for (const item of c.trades) expect(PRICE_HISTORY_ITEMS.has(item), `${c.name}: ${item}`).toBe(true);
    }
  });

  it("keeps the GEX and the ISA as authorities, not corporations, and every name in it is reserved", () => {
    const authorities = NPC_CATALOG.authorities.map((a) => a.name);
    expect(authorities).toEqual(expect.arrayContaining(["GEX Commodities Authority", "ISA Materials Exchange", "Galactic Exchange"]));
    expect(NPC_CATALOG.corporations.map((c) => c.name)).not.toContain("GEX Commodities Authority");
    for (const name of NPC_NAMES) expect(RESERVED_CORPORATION_NAMES, name).toContain(name);
  });

  it("refuses a catalog it cannot use, rather than reading it as empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npc-catalog-"));
    const file = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };
    expect(() => readNpcCatalog(path.join(dir, "missing.json"))).toThrow();
    expect(() => readNpcCatalog(file("bad.json", "{ not json"))).toThrow();
    expect(() => readNpcCatalog(file("empty.json", JSON.stringify({ corporations: [], authorities: [{ name: "X Authority" }] })))).toThrow(/no corporations/);
    expect(() => readNpcCatalog(file("nameless.json", JSON.stringify({ corporations: [{ id: "a" }], authorities: [{ name: "X" }] })))).toThrow(/without a name/);
  });
});
