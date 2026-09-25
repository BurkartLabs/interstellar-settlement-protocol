import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { renderStationFacilities, facilityCardsHtml, constructBlocker } from "../../public/scripts/stationFacilities.js";

// Bug #1253: Construct Assembly Facility was drawn into #station-facility-buildings and its listener was looked up in
// #station-player-buildings, so a click did nothing and no request was sent. A test that only drives the route could
// not see that: this one draws the cards into the game's own page markup, clicks the button a player sees, captures
// the request it sends, and sends that request to the real route.
const PAGE = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

function stationPage() {
  return new JSDOM(PAGE).window.document; // markup only; the page's scripts do not run
}

async function researcher() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.unlockedTech = ["tt-assembly-fabrication"];
    state.corp.finances.credits = 100_000;
  });
  return { app, account, api: authed(app, accessToken), corp: () => getAccountById(account.id).state.corp };
}

/**
 * The Station as a player with the research sees it, with every request the page sends recorded and forwarded.
 *
 * `settle()` awaits the actual in-flight request rather than guessing how long it takes (AB#1744, P-STOPWATCH-TEST):
 * a fixed 50ms wait missed the click handler's own `await request(...)` under load, since a wall-clock guess is not
 * a signal tied to the request completing. `request` itself is synchronous up to the point where it creates and
 * records that promise, so by the time `button.click()` returns to the test, `settle()` is already bound to the
 * one request the click just sent — and because `bindFacilityGrid`'s `await request(...)` attaches its own
 * continuation (the one that calls `onBuilt`/`onError`) to that same promise *before* the test's `await settle()`
 * does, the two continuations run in that order: `onBuilt`/`onError` has always fired by the time `settle()`
 * resolves. No request means `settle()` resolves immediately against its initial no-op promise.
 */
function playerPage(p, overrides = {}) {
  const doc = stationPage();
  const sent = [];
  const events = { built: [], errors: [], entered: [] };
  let pending = Promise.resolve();
  const handlers = {
    accountId: () => p.account.id,
    request: (path, init) => {
      sent.push({ path, method: init.method });
      pending = (async () => {
        const res = await p.api.post(path).send({});
        if (res.status !== 200) throw new Error(res.body.error);
        return res.body;
      })();
      return pending;
    },
    onEnter: (name) => events.entered.push(name),
    onBuilt: (account) => events.built.push(account),
    onError: (error) => events.errors.push(error.message),
    ...overrides
  };
  renderStationFacilities(doc, p.corp(), handlers);
  const settle = () => pending.catch(() => {});
  return { doc, sent, events, handlers, settle };
}

describe("Construct Assembly Facility (Bug #1253)", () => {
  it("draws the Construct button in the page's facilities section, which it shows", async () => {
    const p = await researcher();
    const { doc } = playerPage(p);
    const button = doc.getElementById("build-assembly-btn");
    expect(button).not.toBeNull();
    expect(button.textContent).toBe("Construct (¤60,000)");
    expect(doc.getElementById("station-facility-buildings").contains(button)).toBe(true);
    expect(doc.getElementById("station-facilities-section").hidden).toBe(false);
  });

  it("a click sends one POST to build-assembly-facility, and the facility is built", async () => {
    const p = await researcher();
    const { doc, sent, events, settle } = playerPage(p);
    doc.getElementById("build-assembly-btn").click();
    await settle();

    expect(sent).toEqual([{ path: `/api/accounts/${p.account.id}/gameplay/build-assembly-facility`, method: "POST" }]);
    expect(events.errors).toEqual([]);
    expect(events.built).toHaveLength(1);
    expect(p.corp().buildings.map((b) => b.name)).toContain("Assembly Facility");
    expect(p.corp().finances.credits).toBe(40_000);
  });

  it("a double click while the request is out sends one request, not two", async () => {
    const p = await researcher();
    const { doc, sent, settle } = playerPage(p);
    const button = doc.getElementById("build-assembly-btn");
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Constructing…");
    button.click();
    await settle();
    expect(sent).toHaveLength(1);
  });

  it("a refusal the page could not foresee gives the server's reason and the button back", async () => {
    const p = await researcher();
    const { doc, sent, events, settle } = playerPage(p);
    // Credits spent elsewhere after the Station was drawn: the page still offers Construct, the server refuses.
    mutateAccountState(p.account.id, (state) => { state.corp.finances.credits = 10_000; });
    const button = doc.getElementById("build-assembly-btn");
    button.click();
    await settle();
    expect(sent).toHaveLength(1);
    expect(events.errors).toHaveLength(1);
    expect(events.errors[0]).toMatch(/Assembly Facility construction/);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Construct (¤60,000)");
    expect(p.corp().buildings.map((b) => b.name)).not.toContain("Assembly Facility");
  });

  it("once built, the card offers Enter instead of Construct, and Enter opens the facility", async () => {
    const p = await researcher();
    await p.api.post(`/api/accounts/${p.account.id}/gameplay/build-assembly-facility`).send({});
    const { doc, sent, events } = playerPage(p);
    expect(doc.getElementById("build-assembly-btn")).toBeNull();
    doc.querySelector('[data-corp-building="Assembly Facility"]').click();
    expect(events.entered).toEqual(["Assembly Facility"]);
    expect(sent).toEqual([]);
  });

  it("re-rendering does not stack handlers: one click after three renders is still one request", async () => {
    const p = await researcher();
    const { doc, sent, handlers, settle } = playerPage(p);
    renderStationFacilities(doc, p.corp(), handlers);
    renderStationFacilities(doc, p.corp(), handlers);
    doc.getElementById("build-assembly-btn").click();
    await settle();
    expect(sent).toHaveLength(1);
  });

  // The Station has no feedback line, so a refusal must be on the card before the click, not only after it.
  it("short of credits, the card says so and Construct sends nothing", async () => {
    const p = await researcher();
    mutateAccountState(p.account.id, (state) => { state.corp.finances.credits = 10_000; });
    const { doc, sent, settle } = playerPage(p);
    const button = doc.getElementById("build-assembly-btn");
    expect(button.disabled).toBe(true);
    expect(doc.querySelector(".facility-blocked").textContent).toBe("Needs ¤60,000; you have ¤10,000.");
    button.click();
    await settle();
    expect(sent).toEqual([]);
  });

  it("with every building slot in use, the card says so, and the server agrees", async () => {
    const p = await researcher();
    mutateAccountState(p.account.id, (state) => {
      state.corp.buildingSlots = 2;
      state.corp.buildings = [{ name: "Headquarters", status: "Operational" }, { name: "Refinery", status: "Operational" }];
    });
    const { doc } = playerPage(p);
    expect(doc.getElementById("build-assembly-btn").disabled).toBe(true);
    expect(doc.querySelector(".facility-blocked").textContent).toBe("Needs a free building slot: 2 of 2 in use.");
    const res = await p.api.post(`/api/accounts/${p.account.id}/gameplay/build-assembly-facility`).send({});
    expect(res.status).toBe(400);
  });

  it("with exactly enough credits and a free slot, nothing blocks it", () => {
    expect(constructBlocker({ buildings: [{ name: "Headquarters" }], buildingSlots: 2, finances: { credits: 60_000 } })).toBe("");
  });

  it("without the research there is nothing to construct, and the section stays hidden", () => {
    const doc = stationPage();
    expect(facilityCardsHtml({ unlockedTech: [], buildings: [] })).toBe("");
    renderStationFacilities(doc, { unlockedTech: [], buildings: [] }, { accountId: () => "x", request: async () => ({}), onEnter() {}, onBuilt() {}, onError() {} });
    expect(doc.getElementById("station-facilities-section").hidden).toBe(true);
  });
});
