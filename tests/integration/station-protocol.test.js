import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { ECONOMY } from "../../server/economy.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";
import { upgradeRefusal } from "../../server/upgrades.js";
import { repairRefusal } from "../../server/buildingRepair.js";
import { formatCredits } from "../../server/receipts.js";
import { facilityProtocolHtml } from "../../public/scripts/stationFacilities.js";

// ISP-254Bc (AB#4818): the Station's protocol line, through the running server. Its refusals send their code, so a
// refusal for want of credits reads as Unfunded whatever its words; each says what to do next (ISP-6); and its
// notifications carry their protocol on the Station screen, beside the plain title.
const EARTH = "earth-station-prime";
let api, accountId;
const seed = (fn) => mutateAccountState(accountId, fn, { sanitize: false, settleMining: false });
const at = (p) => `/api/accounts/${accountId}/gameplay${p}`;
/** The refusal as the page's API client throws it (public/scripts/apiClient.js keeps code and status). */
const asError = (res) => Object.assign(new Error(res.body.error), { code: res.body.code, status: res.status });
const noteTitled = async (title) => (await api.get(`/api/accounts/${accountId}/notifications`)).body.notifications.find((n) => n.title === title);

beforeAll(async () => {
  const { app } = await getApp();
  const me = await registerAccount(app);
  accountId = me.account.id;
  api = authed(app, me.accessToken);
});

describe("the Station's refusals and notifications (ISP-254Bc, AB#4818)", () => {
  it("renting an office: unfunded with the next step, then In force once confirmed", async () => {
    seed((s) => { s.corp.currentStationId = EARTH; s.corp.finances.credits = 0; s.corp.offices = []; });
    const refused = await api.post(at("/rent-office")).send({ stationId: EARTH, durationDays: 7 });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("insufficient-credits");
    expect(refusalMeaning(asError(refused))).toBe("unfunded");
    expect(refused.body.error).toMatch(/Rent for fewer days, or sell goods to raise the credits\.$/);
    seed((s) => { s.corp.finances.credits = 5_000_000; });
    expect((await api.post(at("/rent-office")).send({ stationId: EARTH, durationDays: 7 })).status).toBe(200);
    expect(await noteTitled("Office Lease Confirmed")).toMatchObject({ protocol: { meaning: "active", screen: "building-orbital-executive-suites" } });
  });

  it("hiring: without an office it says where to rent one; for credits it quotes the hire it would make (Bug #4823)", async () => {
    seed((s) => { s.corp.offices = []; });
    const noOffice = await api.post(at("/hire")).send({ count: 1 });
    expect(noOffice.body).toMatchObject({ code: "no-office" });
    expect(refusalMeaning(asError(noOffice))).toBe("refused");
    expect(noOffice.body.error).toMatch(/Rent one at the Orbital Executive Suites first\.$/);
    expect((await api.post(at("/rent-office")).send({ stationId: EARTH, durationDays: 7 })).status).toBe(200);
    // asks for more than there is room for, and holds enough for all but one of those it could hire
    const hireCost = ECONOMY.employees.hireCost;
    const corp = getAccountById(accountId).state.corp;
    const room = Math.max(0, corp.employeeCap - corp.employeeCount);
    expect(room).toBeGreaterThan(1);
    seed((s) => { s.corp.finances.credits = (room - 1) * hireCost; });
    const short = await api.post(at("/hire")).send({ count: room + 7 });
    expect(short.body.code).toBe("insufficient-credits");
    expect(refusalMeaning(asError(short))).toBe("unfunded");
    expect(short.body.error).toContain(`Hiring requires ${formatCredits(room * hireCost)}.`); // the ones it would hire, not the count asked x 2,000
    expect(short.body.error).toMatch(/Hire fewer, or sell goods to raise the credits\.$/);
    seed((s) => { s.corp.finances.credits = 5_000_000; });
    expect((await api.post(at("/hire")).send({ count: 1 })).status).toBe(200);
    expect(await noteTitled("Hiring Order Confirmed")).toMatchObject({ protocol: { meaning: "complete", screen: "building-orbital-executive-suites" } });
  });

  it("building: unfunded with the next step, then Concluded once built", async () => {
    seed((s) => {
      s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), "tt-assembly-fabrication"])];
      s.corp.buildings = (s.corp.buildings || []).filter((b) => b.name !== "Assembly Facility");
      s.corp.buildingSlots = 8;
      s.corp.finances.credits = 0;
    });
    const refused = await api.post(at("/build")).send({ buildingId: "assembly-facility" });
    expect(refused.body.code).toBe("insufficient-credits");
    expect(refusalMeaning(asError(refused))).toBe("unfunded");
    expect(refused.body.error).toMatch(/Sell goods or finish an assignment to raise the credits, then build it\.$/);
    seed((s) => { s.corp.finances.credits = 5_000_000; });
    expect((await api.post(at("/build")).send({ buildingId: "assembly-facility" })).status).toBe(200);
    expect(await noteTitled("Assembly Facility Online")).toMatchObject({ protocol: { meaning: "complete", screen: "building-assembly-facility" } }); // slice Bd's (AB#4819)
  });

  it("an upgrade or a repair refused for credits says what to do next", () => {
    expect(upgradeRefusal({ outcome: "insufficient-credits", cost: 12_000 }, formatCredits, String)).toBe("The upgrade costs 12,000 credits. Sell goods or finish an assignment to raise the credits, then upgrade.");
    expect(upgradeRefusal({ outcome: "insufficient-goods", need: 40, item: "Catalyst Beds", have: 12 }, formatCredits, String)).toMatch(/Bring more here, then upgrade\.$/);
    expect(repairRefusal({ outcome: "insufficient-credits", name: "Refinery", cost: 2_000, credits: 10 }, formatCredits)).toMatch(/Sell goods to raise the credits, then repair it\.$/);
  });

  it("a facility's status reads In force while operational and Suspended while offline for an upgrade", () => {
    expect(facilityProtocolHtml("Operational")).toContain("In force");
    expect(facilityProtocolHtml("Upgrading")).toContain("Suspended");
    expect(facilityProtocolHtml("Under construction")).toBe("");
  });
});
