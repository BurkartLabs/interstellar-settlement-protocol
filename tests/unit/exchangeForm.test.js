import { describe, it, expect } from "vitest";
import { tradeNumbers } from "../../public/scripts/exchangeView.js";
import { wholeNumber as clientWholeNumber } from "../../public/scripts/wholeNumber.js";
import { wholeNumber as serverWholeNumber } from "../../server/gameplayInput.js";

// AB#1164: the Exchange forms read their numbers with Math.max(1, Number(value || 1)), so a blank, 0, negative or
// non-numeric price became $1 and was listed at once, and the server's input rules (AB#732) never saw what was typed.
// Now the form sends what was typed. tradeNumbers only decides whether the values are whole numbers of at least 1,
// which is when a confirmation is worth showing; anything else goes to the server as typed and its refusal is shown.

describe("tradeNumbers (AB#1164)", () => {
  it("accepts whole numbers of at least 1, as typed, trimmed", () => {
    expect(tradeNumbers({ quantity: "2", unitPrice: " 30 " })).toEqual({ ok: true, values: { quantity: 2, unitPrice: 30 } });
    expect(tradeNumbers({ quantity: "1000000000" })).toEqual({ ok: true, values: { quantity: 1_000_000_000 } });
  });
  for (const bad of ["", "   ", "0", "-5", "abc", "2.5", "1e3", "1".repeat(40), undefined, null]) {
    it(`does not turn ${JSON.stringify(bad)} into a number`, () => {
      const r = tradeNumbers({ quantity: "1", unitPrice: bad });
      expect(r.ok).toBe(false);
      expect(r.values.unitPrice).toBeNull();
      expect(r.values.quantity).toBe(1);
    });
  }
});

describe("one reading of a whole number, in the browser and on the server (AB#1164)", () => {
  it("the server's input check uses the same function the form does", () => {
    expect(serverWholeNumber).toBe(clientWholeNumber);
  });
});
