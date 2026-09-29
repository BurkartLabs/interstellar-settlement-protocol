import { describe, it, expect } from "vitest";
import { LEDGER_KINDS, hangarHtml, hqTabsHtml, ledgerHtml, treasuryHtml } from "../../public/scripts/conglomerateTreasury.js";
import { ledgerPage } from "../../server/game/treasury.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-206 (AB#901): the Treasury and Hangar screens. A member is offered deposit only; a role that may withdraw sees
// what it may still take before it asks; the ledger shows who, what, how much, the balance after and when, newest
// first, a page at a time; and server refusals reach the form's own line.
const T = Date.UTC(2026, 8, 27, 9, 52);
const row = (i, over = {}) => ({ id: `r${i}`, at: T + i * 60_000, kind: "deposit", corp: "corp-a", corpName: "Halcyon Freight", item: "credits", amount: 100 * i, balanceAfter: 1000 + i, by: "corp-a", ...over });
const ledger = (rows, over = {}) => ({ scope: "all", rows, total: rows.length, offset: 0, limit: 25, ...over });
const treasury = (over = {}) => ({ balance: 57_500, upkeepPerDay: 300, nextUpkeepAt: T + 3_600_000, arrears: null, custodyFeePct: 2, noticePct: 10, allowance: { cap: 2_000, used: 1_500, remaining: 500, opening: 10_000 }, pending: [], ledger: ledger([row(2), row(1)]), me: "corp-a", ...over });
const ALL = ["view", "contribute", "withdraw-credits", "withdraw-goods", "block-withdrawal"];
const MEMBER = ["view", "contribute", "withdraw-goods"];
const roles = (html) => [...html.matchAll(/data-role="(cong-[a-z-]+)"/g)].map((m) => m[1]);

describe("the Treasury screen (AB#901)", () => {
  it("offers a member deposit only, and says who withdraws", () => {
    const html = treasuryHtml(treasury({ allowance: null }), { may: MEMBER });
    expect(roles(html)).toContain("cong-treasury-deposit");
    expect(roles(html)).not.toContain("cong-treasury-withdraw");
    expect(html).toContain("Members deposit; the founder and directors withdraw, within a daily cap.");
  });

  it("shows a role that may withdraw what it may still take today before it asks, and where announcement starts", () => {
    const html = treasuryHtml(treasury(), { may: ALL });
    expect(html).toMatch(/You may withdraw <strong>500<\/strong> more credits today, of 2,000/);
    expect(html).toContain("More than 5,750 (10% of the balance) is announced");
    const spent = treasuryHtml(treasury({ allowance: { cap: 500, used: 500, remaining: 0, opening: 10_000 } }), { may: ALL });
    expect(spent).toMatch(/<button type="submit" class="ui-button ui-button--secondary" disabled aria-describedby="cong-withdraw-none">Withdraw<\/button>/);
    expect(spent).toContain("Nothing more can be withdrawn today. The allowance resets at 00:00 UTC.");
  });

  it("puts a refusal on the form's own line in the warning tone, and what happened in the success tone", () => {
    const refused = treasuryHtml(treasury(), { may: ALL, status: { withdraw: { text: "Your role may withdraw 500 credits today; the cap resets at 00:00 UTC." } } });
    expect(refused).toMatch(/<p class="cong-form-status" data-role="cong-treasury-withdraw-status" role="status">Your role may withdraw 500 credits today; the cap resets at 00:00 UTC.<\/p>/);
    const done = treasuryHtml(treasury(), { may: ALL, status: { deposit: { text: "Deposited 50,000 credits.", ok: true } } });
    expect(done).toContain('class="cong-form-status cong-form-status--ok" data-role="cong-treasury-deposit-status"');
  });

  it("shows arrears, and offers Block on another corporation's announced withdrawal only", () => {
    const pending = [{ id: "w1", corp: "corp-b", corpName: "Meridian", amount: 9_000, completesAt: T, blockedBy: [] }, { id: "w2", corp: "corp-a", corpName: "Halcyon", amount: 7_000, completesAt: T, blockedBy: [] }];
    const html = treasuryHtml(treasury({ pending, arrears: { owed: 600, since: T } }), { may: ALL });
    expect(html).toContain("In arrears: 600 credits of upkeep unpaid");
    expect([...html.matchAll(/data-role="cong-withdrawal-block" data-withdrawal="([^"]+)"/g)].map((m) => m[1])).toEqual(["w1"]);
  });
});

describe("the ledger (AB#901)", () => {
  it("shows actor, entry, amount, balance after and time, newest first, and pages", () => {
    const html = ledgerHtml(ledger([row(3, { kind: "withdrawal", amount: -1_500 }), row(2)], { total: 60, offset: 25 }), { which: "treasury" });
    for (const col of ["Time", "Corporation", "Entry", "Credits", "Balance after"]) expect(html).toContain(`<th scope="col"`) && expect(html).toContain(col);
    expect(html).toContain("Rows 26 to 27 of 60, newest first");
    expect(html).toContain("−1,500");
    expect(html).toContain("cong-ledger__amount--out");
    expect(html).toMatch(/data-role="cong-ledger-page" data-which="treasury" data-offset="0">Newer/);
    expect(html).toMatch(/data-role="cong-ledger-page" data-which="treasury" data-offset="50">Older/);
    expect(ledgerHtml(ledger([row(1)]), { which: "treasury" })).toMatch(/data-offset="0" disabled>Newer.*data-offset="25" disabled>Older/s);
  });

  it("names every kind of row the server writes", () => {
    for (const kind of ["opening", "charter-deposit", "deposit", "custody-fee", "withdrawal", "withdrawal-announced", "withdrawal-blocked", "withdrawal-failed", "upkeep", "upkeep-unpaid", "arrears-paid", "level", "level-lost", "dissolution"]) {
      expect(LEDGER_KINDS[kind], kind).toBeTruthy();
    }
  });

  it("tells a member why its own ledger can be empty while the treasury is not", () => {
    expect(ledgerHtml(ledger([], { scope: "own" }), { which: "treasury" })).toContain("The founder and directors see every member's movements.");
  });

  it("is paged on the server: newest first, from an offset, 1 to 100 rows", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i));
    const page = ledgerPage(rows, { offset: 25, limit: 25 });
    expect(page).toMatchObject({ total: 60, offset: 25, limit: 25 });
    expect(page.rows.map((r) => r.id)).toEqual(Array.from({ length: 25 }, (_, i) => `r${59 - 25 - i}`));
    expect(ledgerPage(rows, { limit: 1000 }).limit).toBe(100);
    expect(ledgerPage(rows, { offset: -3, limit: 0 })).toMatchObject({ offset: 0, limit: 25 });
  });
});

describe("the Hangar screen (AB#901)", () => {
  const hangar = { stationId: "earth-station-prime", stationName: "Earth Station Prime", items: { Silicates: 3_000 }, allowance: { Silicates: { cap: 150, remaining: 150 } }, ledger: ledger([row(1, { item: "Silicates", amount: 3_000, balanceAfter: 3_000 })]) };

  it("shows each item's stock and what the caller may take today, and deposits only what the caller holds there", () => {
    const html = hangarHtml(hangar, { may: ALL, own: { Nickel: 800, Iron: 0 }, docked: true });
    expect(html).toMatch(/<td data-label="In the hangar" class="ui-table__num">3,000<\/td><td data-label="You may take today" class="ui-table__num">150<\/td>/);
    expect(html).toContain('<option value="Nickel">Nickel (you hold 800)</option>');
    expect(html).not.toContain('<option value="Iron"');
    expect(html).toContain('<option value="Silicates">Silicates (up to 150 today)</option>');
    expect(html).toMatch(/<th scope="col">Item<\/th>/);
  });

  it("tells a corporation away from the station, with nothing there, how to take part", () => {
    const html = hangarHtml(hangar, { may: MEMBER, own: {}, docked: false });
    expect(html).toContain("Dock there, or ship goods there, first.");
    expect(roles(html)).not.toContain("cong-hangar-deposit");
    expect(roles(html)).not.toContain("cong-hangar-withdraw");
  });

  it("offers an empty hangar a next step", () => {
    expect(hangarHtml({ ...hangar, items: {}, allowance: {}, ledger: ledger([]) }, { may: ALL, docked: true })).toContain("The hangar is empty");
  });
});

describe("the Conglomerate tab's own tabs (AB#901)", () => {
  it("draws Roster, Treasury and Hangar as tabs, with only the active panel shown", () => {
    const html = hqTabsHtml("treasury", { roster: "R", treasury: "T", hangar: "H" });
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/id="cong-tab-treasury" aria-controls="cong-panel-treasury" aria-selected="true" tabindex="0"/);
    expect(html).toMatch(/id="cong-panel-roster" aria-labelledby="cong-tab-roster" hidden>/);
    expect(html).toMatch(/id="cong-panel-treasury" aria-labelledby="cong-tab-treasury">T</);
    expect(html).not.toMatch(/\sstyle=/);
  });
});

// ISP-254 slice C1b (AB#4821): each form's line, an announced withdrawal and a screen that did not load carry the
// protocol line after their plain words, with the Conglomerate screen's code.
describe("the Treasury and Hangar's protocol line (AB#4821)", () => {
  const LINE = (phrase) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // CGL-ADM-1</span></span>`;
  const withCodes = (fn) => { setSectionCodes({ screens: [{ id: "conglomerate", code: "CGL-ADM-1" }] }); try { fn(); } finally { setSectionCodes(null); } };

  it("a form's line: the plain words, then the phrase it carries; none without one", () => withCodes(() => {
    const refused = treasuryHtml(treasury(), { may: ALL, status: { deposit: { text: "Your corporation holds 10 credits; it cannot deposit 20. Deposit 10 or less.", protocol: { meaning: "unfunded", screen: "conglomerate" } } } });
    expect(refused).toContain(`Deposit 10 or less. ${LINE("Unfunded, balance insufficient")}</p>`);
    const announced = treasuryHtml(treasury(), { may: ALL, status: { withdraw: { text: "Announced.", ok: true, protocol: { meaning: "pending", screen: "conglomerate" } } } });
    expect(announced).toContain(`Announced. ${LINE("Filed, awaiting review")}</p>`);
    const moved = hangarHtml({ stationId: "earth-station-prime", items: {}, allowance: {}, ledger: ledger([]) }, { may: ALL, docked: true, own: { "Iron Ore": 5 }, status: { deposit: { text: "Deposited 5 Iron Ore.", ok: true, protocol: { meaning: "complete", screen: "conglomerate" } } } });
    expect(moved).toContain(`Deposited 5 Iron Ore. ${LINE("Concluded")}</p>`);
    expect(treasuryHtml(treasury(), { may: ALL, status: { deposit: { text: "Deposited." } } })).not.toContain("protocol-line");
  }));

  it("an announced withdrawal is Filed, awaiting review; a screen that did not load is Unsuccessful", () => withCodes(() => {
    const pending = [{ id: "w1", corp: "corp-b", corpName: "Meridian", amount: 9_000, completesAt: T, blockedBy: [] }];
    expect(treasuryHtml(treasury({ pending }), { may: ALL })).toContain(`unless blocked ${LINE("Filed, awaiting review")}</p>`);
    expect(treasuryHtml({ error: "The Bureau did not answer." })).toContain(`Nothing has changed. ${LINE("Unsuccessful")}</p>`);
    expect(hangarHtml({ error: "The Bureau did not answer." })).toContain(`Nothing has changed. ${LINE("Unsuccessful")}</p>`);
  }));
});
