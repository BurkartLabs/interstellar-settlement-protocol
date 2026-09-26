import { describe, it, expect } from "vitest";
import { counterpartyHtml, npcEntry, npcProfileView } from "../../public/scripts/npcProfile.js";
import { marketView } from "../../server/marketView.js";
import { NPC_CATALOG } from "../../server/npcCorporations.js";

// ISP-124 (AB#818): an NPC order's counterparty is badged, "NPC" or "Authority", and its name opens a profile card
// with the catalog's fields; a player's name never carries the badge.
const directory = marketView({ orderBook: [], buyOrders: [], npcBuyOrders: [] }).npcDirectory;
const rows = [
  { who: "Meridian Glassworks", npc: true },
  { who: "Synthorium Trading House", npc: true },
  { who: "GEX Commodities Authority", npc: true },
  { who: "Kessler Ore Brokers", npc: false },
  { who: "Halvorsen Refining", npc: false },
  { who: "<img src=x onerror=alert(1)>", npc: false }
];

describe("the NPC badge and profile card (AB#818)", () => {
  it("the market carries the catalog's directory: every corporation and authority, with the card's fields", () => {
    expect(directory.corporations.map((c) => c.name)).toEqual(NPC_CATALOG.corporations.map((c) => c.name));
    expect(directory.authorities.map((a) => a.name)).toEqual(NPC_CATALOG.authorities.map((a) => a.name));
    for (const c of directory.corporations) expect(Object.keys(c).sort()).toEqual(["flavour", "homeStation", "id", "name", "trades"]); // by name: no station id in the view (Bug #1171)
  });

  it("from a fixture with both, every NPC row has the badge and no player row does", () => {
    for (const { who, npc } of rows) {
      const html = counterpartyHtml(who, directory);
      expect(html.includes("data-npc-badge"), who).toBe(npc);
      expect(html.includes("data-npc-profile"), who).toBe(npc);
    }
    expect(counterpartyHtml("Meridian Glassworks", directory)).toMatch(/data-npc-badge>NPC</);
    expect(counterpartyHtml("GEX Commodities Authority", directory)).toMatch(/data-npc-badge>Authority</);
  });

  it("escapes a player's name and adds nothing to it", () => {
    const html = counterpartyHtml("<img src=x onerror=alert(1)>", directory);
    expect(html).not.toContain("<img");
    expect(html).toBe('<span data-counterparty-name>&lt;img src=x onerror=alert(1)&gt;</span>');
  });

  it("the card shows the catalog's flavour, home station and trades for a corporation, and the role for an authority", () => {
    const stationName = (id) => ({ "earth-station-prime": "Earth Station Prime", "luna-gateway": "Luna Gateway", "mars-orbital-dock": "Mars Orbital Dock" })[id];
    for (const c of NPC_CATALOG.corporations) {
      const view = npcProfileView(npcEntry(c.name, directory));
      expect(view.title).toBe(c.name);
      expect(view.heading).toBe("NPC corporation");
      expect(view.bodyHtml).toContain(c.flavour.replace(/'/g, "&#39;"));
      expect(view.bodyHtml).toContain(`data-npc-field="home">${stationName(c.homeStationId)}<`);
      expect(view.bodyHtml).toContain(`data-npc-field="trades">${c.trades.join(", ")}<`);
    }
    const gex = npcProfileView(npcEntry("GEX Commodities Authority", directory));
    expect(gex.heading).toBe("Authority");
    expect(gex.bodyHtml).toContain("Settles every trade");
    expect(npcProfileView(npcEntry("Kessler Ore Brokers", directory))).toBeNull();
  });
});
