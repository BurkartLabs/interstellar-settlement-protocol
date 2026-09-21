import { describe, it, expect } from "vitest";
import { directInvestmentRecords } from "../../server/legacyInvestments.js";

// Bug #689: investments made through the removed route are reported for the PM, not refunded or deleted.
describe("directInvestmentRecords (Bug #689)", () => {
  it("lists each stored investment as account id, amount and time, and nothing the player typed", () => {
    const accounts = [
      { id: "acc-1", state: { corp: { investments: [{ id: "inv-1", targetCorp: "<img onerror=x>", amount: 50000, instrument: "equity", createdAt: 111 }] } } },
      { id: "acc-2", state: { corp: { investments: [] } } },
      { id: "acc-3", state: { corp: {} } },
      { id: "acc-4" }
    ];
    expect(directInvestmentRecords(accounts)).toEqual([{ accountId: "acc-1", amount: 50000, createdAt: 111 }]);
  });

  it("reports nothing for a clean install", () => {
    expect(directInvestmentRecords([])).toEqual([]);
  });
});
