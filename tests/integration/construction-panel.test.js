import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { PLAYER_BUILDING_CATALOGUE } from "../../server/playerBuildings.js";
import { ECONOMY } from "../../server/economy.js";
import { RESEARCH_LIBRARY } from "../../server/game/catalog.js";
import { renderConstructionPanel } from "../../public/scripts/constructionPanel.js";

// ISP-95 (AB#785): the panel drawn into the game's own page markup, its Build button clicked, and the request it sends
// sent to the real POST /gameplay/build. The row and the slot counter are drawn again from the account that comes
// back, with no reload; a refusal shows the server's own words in the row.

const PAGE = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const ctx = { researchName: (id) => RESEARCH_LIBRARY[id]?.name || id, economy: { buildings: ECONOMY.buildings } };

async function player(setup) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 1_000_000;
    state.corp.unlockedTech = ["tt-assembly-fabrication"];
    state.corp.buildingSlots = 4;
    state.corp.buildings = [];
    setup?.(state.corp);
  });
  return { id: account.id, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp };
}

/** The Station page with the panel drawn for `p`, every request it sends recorded and sent to the real route. */
function stationPage(p) {
  const doc = new JSDOM(PAGE).window.document;
  const sent = [];
  const events = { built: [], errors: [] };
  let pending = Promise.resolve();
  const handlers = {
    accountId: () => p.id,
    request: (path, init) => {
      sent.push({ path, method: init.method, body: JSON.parse(init.body) });
      pending = (async () => {
        const res = await p.api.post(path).send(JSON.parse(init.body));
        if (res.status !== 200) throw new Error(res.body.error);
        return res.body;
      })();
      return pending;
    },
    onBuilt: (account) => {
      events.built.push(account);
      draw(account.state.corp); // what updateAllViews does on the page: draw again from the answer
    },
    onError: (error) => events.errors.push(error.message)
  };
  const draw = (corp) => renderConstructionPanel(doc, PLAYER_BUILDING_CATALOGUE, corp, handlers, ctx);
  draw(p.corp());
  return { doc, sent, events, settle: () => pending.catch(() => {}), row: (id) => doc.querySelector(`[data-building-row="${id}"]`) };
}

describe("the construction panel on the Station (ISP-95)", () => {
  it("is in the page, with a row per catalogue entry and the slot counter", async () => {
    const p = await player();
    const page = stationPage(p);
    expect(page.doc.getElementById("station-construction-section")).not.toBeNull();
    expect(page.doc.querySelectorAll("[data-building-row]")).toHaveLength(PLAYER_BUILDING_CATALOGUE.length);
    expect(page.doc.getElementById("construction-slots").textContent).toBe("Building slots: 0 of 4 in use.");
  });

  it("Build calls /gameplay/build, and the row and the slot counter change without a reload", async () => {
    const p = await player();
    const page = stationPage(p);
    page.row("assembly-facility").querySelector("[data-build-id]").click();
    await page.settle();
    expect(page.sent).toEqual([{ path: `/api/accounts/${encodeURIComponent(p.id)}/gameplay/build`, method: "POST", body: { buildingId: "assembly-facility" } }]);
    expect(page.events.errors).toEqual([]);
    expect(p.corp().buildings.map((b) => b.name)).toEqual(["Assembly Facility"]);
    expect(page.row("assembly-facility").querySelector("[data-build-id]")).toBeNull();
    expect(page.row("assembly-facility").textContent).toContain("Built: your corporation operates the most it may, 1.");
    expect(page.doc.getElementById("construction-slots").textContent).toBe("Building slots: 1 of 4 in use.");
  });

  it("a yard is built on the lease chosen in its row", async () => {
    const p = await player((corp) => {
      corp.miningLeases = [{ id: "lease-earth", body: "Earth", leaseType: "Silicate Extraction", buildingSlots: 2, extractorIds: [] }];
    });
    const page = stationPage(p);
    page.row("basic-extractor-yard").querySelector("[data-build-id]").click();
    await page.settle();
    expect(page.sent[0].body).toEqual({ buildingId: "basic-extractor-yard", leaseId: "lease-earth" });
    expect(p.corp().miningLeases[0].extractorIds).toHaveLength(1);
  });

  it("a refusal shows the server's message in the row, not a generic failure, and the button works again", async () => {
    const p = await player();
    const page = stationPage(p); // drawn while the corporation could afford it
    mutateAccountState(p.id, (state) => { state.corp.finances.credits = 10; });
    page.row("assembly-facility").querySelector("[data-build-id]").click();
    await page.settle();
    expect(page.events.errors).toHaveLength(1);
    expect(page.events.errors[0]).toMatch(/^Assembly Facility construction requires/);
    expect(page.row("assembly-facility").querySelector("[role=status]").textContent).toBe(page.events.errors[0]);
    expect(page.row("assembly-facility").querySelector("[data-build-id]").disabled).toBe(false);
    expect(p.corp().buildings).toEqual([]);
  });

  it("a double click sends one request", async () => {
    const p = await player();
    const page = stationPage(p);
    const button = page.row("assembly-facility").querySelector("[data-build-id]");
    button.click();
    button.click();
    await page.settle();
    expect(page.sent).toHaveLength(1);
  });
});
