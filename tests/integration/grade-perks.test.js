import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";
import { ECONOMY } from "../../server/economy.js";
import { officeLeaseCost, officeRenewalCost } from "../../public/scripts/ceoEffects.js";

// AB#4689 slice 8: priority processing at Valued, on the routes that charge an ISA fee (design section 4).

const PCT = ECONOMY.desk.priorityProcessingPct;
const discounted = (price) => Math.round((price * (100 - PCT)) / 100);

async function corpAt(points) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 500000;
    state.corp.agentReputation = { "elara-voss": { points } };
  });
  const api = authed(app, accessToken);
  const base = `/api/accounts/${account.id}/gameplay`;
  return {
    id: account.id,
    post: (path, body) => api.post(`${base}/${path}`).send(body),
    credits: () => getAccountById(account.id).state.corp.finances.credits
  };
}

describe("priority processing (AB#4689 slice 8)", () => {
  for (const [points, grade, price] of [[299, "below Valued", (p) => p], [300, "at Valued", discounted]]) {
    it(`charges ${grade} ${grade === "at Valued" ? `${PCT}% less` : "the full price"} to rent and renew an office and to buy a lease`, async () => {
      const corp = await corpAt(points);
      let before = corp.credits();
      expect((await corp.post("rent-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
      expect(before - corp.credits()).toBe(price(officeLeaseCost(7)));

      before = corp.credits();
      expect((await corp.post("renew-office", { stationId: "earth-station-prime", durationDays: 7 })).status).toBe(200);
      expect(before - corp.credits()).toBe(price(officeRenewalCost([], 7)));

      mutateAccountState(corp.id, (state) => { state.corp.employeeCount = 5; });
      before = corp.credits();
      const lease = await corp.post("purchase-lease", { body: "Earth" });
      expect(lease.status).toBe(200);
      expect(before - corp.credits()).toBe(price(20000));
      expect(getAccountById(corp.id).state.corp.miningLeases.at(-1).cost).toBe(price(20000));
    });
  }
});
