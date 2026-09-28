// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { ECONOMY, npcBidFor, npcBidAfterRecovery } from "../../server/economy.js";
import { computeModel, leaseCatalog } from "../../scripts/economy-model.mjs";
import { bestRateAlongBid, npcBidFor as sharedBid, npcBidAfterRecovery as sharedRecovery } from "../../public/scripts/standingBid.js";
import { appState } from "../../public/scripts/state.js";
import { mineBestRate, mineProjectionText } from "../../public/scripts/views/station.js";

// AB#2480 (Board review item 11): a yard's throughput control opens at the rate the game's own model computes as best
// for the corporation's research and the prices, not at a fixed 40. The calculation is AB#2334's: a day's output sold
// along the standing bid, less the curved running cost, one copy in public/scripts/standingBid.js.
const silicates = ECONOMY.npcBuyers.find((b) => b.item === "Silicates");
const economy = (over = {}) => ({
  operations: ECONOMY.operations, buildings: ECONOMY.buildings, salesTaxPct: ECONOMY.exchange.salesTaxPct,
  silicateUnitPrice: silicates.unitPrice, silicateBasePrice: silicates.unitPrice, npcBid: ECONOMY.npcBid, ...over
});
const corp = (unlockedTech = []) => ({ unlockedTech, mining: { silicateExtractors: [{ id: "ext-1", tier: 1 }] }, miningLeases: [], buildings: [] });

beforeEach(() => {
  appState.economy = economy();
  appState.data = { corp: corp() };
});

describe("the throughput control opens at the computed best rate (AB#2480)", () => {
  it("is the economy model's best rate: the same walk AB#2334's fix reports, not a fixed value", () => {
    const model = computeModel(ECONOMY, leaseCatalog());
    expect(mineBestRate("ext-1")).toBe(model.best.throughput);
    expect(model.best.throughput).toBe(bestRateAlongBid({ operations: ECONOMY.operations, basePrice: silicates.unitPrice, taxPct: ECONOMY.exchange.salesTaxPct, npcBid: ECONOMY.npcBid, max: 250 }).throughputPerHour);
    expect(mineBestRate("ext-1")).not.toBe(40);
    // The hint beside the control agrees: the default is the best rate it names.
    expect(mineProjectionText(mineBestRate("ext-1"), "ext-1")).toContain("That is the best rate for your research and today's prices.");
  });

  it("follows the prices: a higher base price or a lower tax moves the best rate, and reopening shows it", () => {
    const at24 = mineBestRate("ext-1");
    appState.economy = economy({ silicateBasePrice: 40 });
    expect(mineBestRate("ext-1")).toBeGreaterThan(at24);
    appState.economy = economy({ silicateBasePrice: 14 });
    expect(mineBestRate("ext-1")).toBeLessThan(at24);
  });

  it("follows the research: a yield multiplier sells more tonnes along the bid, and the best rate moves with it", () => {
    const none = mineBestRate("ext-1");
    appState.data = { corp: corp(["tt-basic-extraction", "tt-energy-routing", "tt-material-compression"]) };
    const researched = mineBestRate("ext-1");
    expect(researched).not.toBe(none);
    // And it is exactly the model's walk at that efficiency, whatever the efficiency is.
    const pricing = mineProjectionText(researched, "ext-1");
    expect(pricing).toContain(`At ${researched} t/h`);
    expect(pricing).toContain("That is the best rate");
  });

  it("the server's bid rule is the shared one, so the model, the server and the panel cannot drift", () => {
    for (const sold of [0, 1, 1750, 3500, 6999, 7000, 20_000]) expect(npcBidFor(24, sold)).toBe(sharedBid(24, sold, ECONOMY.npcBid));
    for (const bid of [13, 18, 24]) expect(npcBidAfterRecovery(24, bid)).toBe(sharedRecovery(24, bid, ECONOMY.npcBid));
  });

  it("the tier-upgrade line beside it quotes the same best rate for the yard's current tier", async () => {
    const { yardUpgradeView } = await import("../../public/scripts/upgradeControl.js");
    const view = yardUpgradeView({ id: "ext-1", tier: 1, buildingId: "b-1" }, corp(), appState.economy);
    expect(view.next.before.rate).toBe(mineBestRate("ext-1"));
  });

  it("the form's field and its projection open at mineBestRate, and an empty field falls back to it", () => {
    const station = readFileSync("public/scripts/views/station.js", "utf8"); // jsdom: import.meta.url is not a file URL here
    expect(station).toContain('value="${startRate}"');
    expect(station).toContain("${escapeHtml(mineProjectionText(startRate, ex.id))}");
    expect(station).not.toMatch(/name="amount"[^>]*value="40"/);
  });
});
