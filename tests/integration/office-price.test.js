import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById } from "../../server/gameState.js";
import { officeLeaseCost, OFFICE_TERMS_DAYS } from "../../public/scripts/ceoEffects.js";

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

  // Source checks, weaker than rendering: the panel is drawn by app.js code the tests cannot call.
  it("leaves no second office price: none in the station data, none in the panel", () => {
    expect(read("data/stations.json")).not.toMatch(/officeCost/);
    const app = read("public/scripts/app.js");
    expect(app).not.toMatch(/officeCost/);
    expect(app).not.toMatch(/one-time\)<\/dd>[^\n]*\n[^\n]*Station<\/dt>/); // the old "(one-time)" office quote
    expect(app).toMatch(/officeLeaseCost\(days\)/); // the term select is priced by the shared function
    expect(app).toMatch(/JSON\.stringify\(\{ stationId: [^}]*durationDays \}\)/); // and sends the chosen term
  });
});
