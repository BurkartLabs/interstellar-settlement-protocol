import { describe, it, expect } from "vitest";
import { fileRate, levyOf, listingRate, rateAt, rateProblem, settle, tariffOn } from "../../server/game/tariffs.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-230 (AB#925): the tariff's rules (docs/design/WARFARE.md, "Tariffs"), with the catalog's own terms.
const T = WARFARE_CATALOG.tariffs;
const H = 3_600_000;

describe("a tariff's bounds, notice and levy (AB#925)", () => {
  it("takes a rate from 0 to the system's cap, in the catalog's steps, and nothing else", () => {
    expect(rateProblem(0, 3, T)).toBeNull();
    expect(rateProblem(2.75, 3, T)).toBeNull();
    expect(rateProblem(3.25, 3, T)).toBe("A tariff here is from 0% to 3%.");
    expect(rateProblem(-0.25, 3, T)).toBe("A tariff here is from 0% to 3%.");
    expect(rateProblem(1.1, 3, T)).toBe("A tariff is set in steps of 0.25 points.");
    expect(rateProblem(NaN, 3, T)).toBe("A tariff is a number of percentage points.");
    expect(rateProblem(1, 0, T)).toBe("This system allows no tariff.");
  });

  it("holds an increase for noticeHours, applies a decrease at once, and lets a new filing replace a pending one", () => {
    const up = fileRate(null, 2, 0, T);
    expect(up.pending).toEqual({ pct: 2, filedAt: 0, effectiveAt: T.noticeHours * H });
    expect(rateAt(up, T.noticeHours * H - 1)).toBe(0);
    expect(rateAt(up, T.noticeHours * H)).toBe(2);
    const settled = settle(up, T.noticeHours * H);
    expect(settled).toMatchObject({ pct: 2, pending: null });
    const down = fileRate(settled, 1, T.noticeHours * H + 1, T);
    expect(down).toMatchObject({ pct: 1, pending: null });
    const replaced = fileRate(fileRate(down, 3, 0, T), 2.5, H, T);
    expect(replaced.pending).toEqual({ pct: 2.5, filedAt: H, effectiveAt: H + T.noticeHours * H });
    expect(fileRate(fileRate(down, 3, 0, T), 1, H, T)).toMatchObject({ pct: 1, pending: null }); // no change cancels the increase
  });

  it("charges a listing the lower of its posted rate and today's", () => {
    expect(listingRate(1, 3)).toBe(1);
    expect(listingRate(3, 1)).toBe(1);
    expect(listingRate(null, 2)).toBe(2);
  });

  it("keeps a levy of 75% x rate / cap: nothing at 0, half of 75% at half the cap, 75% at the cap", () => {
    expect(tariffOn(24_000, 3)).toBe(720);
    expect(levyOf(720, 3, 3, T)).toBe(540);
    expect(levyOf(1_000, 1.5, 3, T)).toBe(375);
    expect(levyOf(1_000, 0, 3, T)).toBe(0);
    expect(levyOf(1_000, 2.5, 5, T)).toBe(375);
  });
});
