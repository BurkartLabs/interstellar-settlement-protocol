import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { officeLeaseCost, OFFICE_TERMS_DAYS } from "../../public/scripts/ceoEffects.js";
import { clientCode } from "../helpers/clientSource.js";

// Bug #1032: the Suites panel quoted data/stations.json's officeCost ($20,000 "one-time") and the server charged
// $1,000 a day for 7 days. Both now use officeLeaseCost; the server charges exactly it for every term the panel offers.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the office costs what the Suites panel quotes (Bug #1032)", () => {
  for (const days of OFFICE_TERMS_DAYS) {
    it(`a ${days}-day lease charges officeLeaseCost(${days}) and runs ${days} days`, async () => {
      const { app } = await getApp();
      const { account, accessToken } = await registerAccount(app);
      const before = getAccountById(account.id).state.corp.finances.credits;
      const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/rent-office`)
        .send({ stationId: "earth-station-prime", durationDays: days });
      expect(res.status).toBe(200);
      const corp = getAccountById(account.id).state.corp;
      expect(before - corp.finances.credits).toBe(officeLeaseCost(days));
      const office = corp.offices[0];
      expect(Math.round((office.rentedUntil - office.rentedAt) / 86_400_000)).toBe(days);
    });
  }

  it("prices 1,000 a day, the figure the walkthrough quotes", () => {
    expect(OFFICE_TERMS_DAYS.map(officeLeaseCost)).toEqual([7000, 14000, 21000, 28000]);
  });

  // AB#1809: formatCredits() already appends "credits" (Bug #1201); rent-office and renew-office each appended
  // a second literal " credits" after it, so a refusal read "Current reserves: 0 credits credits."
  it("does not say the word 'credits' twice when a lease is refused for lack of funds", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    mutateAccountState(account.id, (state) => { state.corp.finances.credits = 0; });
    const res = await authed(app, accessToken).post(`/api/accounts/${account.id}/gameplay/rent-office`)
      .send({ stationId: "earth-station-prime", durationDays: 28 });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/credits credits/);
    expect(res.body.error).toMatch(/Current reserves: [\d,]+ credits\.$/);
  });

  it("renewing does not say the word 'credits' twice either", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const api = authed(app, accessToken);
    await api.post(`/api/accounts/${account.id}/gameplay/rent-office`).send({ stationId: "earth-station-prime", durationDays: 7 });
    mutateAccountState(account.id, (state) => { state.corp.finances.credits = 0; });
    const res = await api.post(`/api/accounts/${account.id}/gameplay/renew-office`).send({ stationId: "earth-station-prime", durationDays: 28 });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/credits credits/);
    expect(res.body.error).toMatch(/Current reserves: [\d,]+ credits\.$/);
  });

  // Source checks, weaker than rendering: the panel is drawn by client code the tests cannot call (the station view,
  // which app.js loads - AB#739).
  it("leaves no second office price: none in the station data, none in the panel", () => {
    expect(read("data/stations.json")).not.toMatch(/officeCost/);
    const app = clientCode();
    // Code only: ceoEffects.js, now in the scan, has a comment recounting where the old officeCost came from.
    const code = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/officeCost/);
    expect(code).not.toMatch(/one-time\)<\/dd>[^\n]*\n[^\n]*Station<\/dt>/); // the old "(one-time)" office quote
    expect(app).toMatch(/officeLeaseCost\(days\)/); // the term select is priced by the shared function
    expect(app).toMatch(/JSON\.stringify\(\{ stationId: [^}]*durationDays \}\)/); // and sends the chosen term
  });
});
