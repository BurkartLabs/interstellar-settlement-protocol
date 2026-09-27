import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { getAccountById, mutateAccountState, saveAccountsNow } from "../../server/gameState.js";
import { financialSnapshotTick } from "../../server/ticks.js";
import { accountsSnapshotPath } from "../../server/game/catalog.js";

// ISP-147 (AB#841): the rating is computed on the server, by the existing financial snapshot tick, from the
// corporation's own statements, and stored; nothing a request carries reaches it.
const DAY = 86_400_000;
let app, account, token;
const corp = () => getAccountById(account.id).state.corp;

/** `n` closed statements before today, filed the way closeDueDays files them (state.statements, then the file). */
function seedStatements(n) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  mutateAccountState(account.id, (s) => {
    s.statements = Array.from({ length: n }, (_, i) => ({
      day: new Date(today - (n - i) * DAY).toISOString().slice(0, 10), dayStart: today - (n - i) * DAY,
      pnl: { income: {}, expenses: {}, totalIncome: 30_000, totalExpenses: 26_500, net: 3_500 },
      cashFlow: { opening: 0, inflows: 30_000, outflows: 26_500, closing: 150_000, unrecorded: 0 },
      balanceSheet: { credits: 150_000, facilities: 180_000, inventory: 0, liabilities: 20_000, totalAssets: 330_000, netWorth: 310_000 }
    }));
    delete s.corp.creditRating; // a fresh basis, as a statement closing gives one
  }, { sanitize: false, settleMining: false });
}

beforeAll(async () => {
  ({ app } = await getApp());
  const r = await registerAccount(app);
  account = r.account;
  token = r.accessToken;
});

describe("ISP-147 the snapshot tick rates every corporation and keeps the rating", () => {
  it("a new corporation, with no statements, is NR", () => {
    financialSnapshotTick();
    expect(corp().creditRating).toMatchObject({ grade: "NR", inputs: null });
  });

  it("with 30 statements it is rated from them, and the rating is saved with the account", () => {
    seedStatements(30);
    financialSnapshotTick();
    expect(corp().creditRating).toMatchObject({ grade: "AA", score: 814 });
    saveAccountsNow();
    const saved = JSON.parse(fs.readFileSync(accountsSnapshotPath, "utf8")).accounts[account.id].state.corp.creditRating;
    expect(saved).toMatchObject({ grade: "AA", score: 814 });
  });
});

/** Every route Express has registered, as route-auth.test.js enumerates them. */
function routes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) return Object.keys(layer.route.methods).map((m) => ({ method: m.toUpperCase(), path: prefix + layer.route.path }));
    if (layer.name === "router" && layer.handle?.stack) {
      const mount = (layer.regexp.source.match(/^\^\\\/([^\\?]+)/) || [])[1];
      return routes(layer.handle.stack, mount ? `${prefix}/${mount.replace(/\\\//g, "/")}` : prefix);
    }
    return [];
  });
}

describe("ISP-147 no request can set the rating", () => {
  it("a crafted creditRating posted to every account route leaves the stored rating as the server computed it", async () => {
    seedStatements(30);
    financialSnapshotTick();
    const before = JSON.stringify(corp().creditRating);
    const forged = { grade: "AAA", score: 1000, forged: true, inputs: {}, computedAt: Date.now() };
    const writes = routes(app._router.stack).filter((r) => r.path.includes(":accountId") && ["POST", "PUT", "PATCH", "DELETE"].includes(r.method));
    expect(writes.length).toBeGreaterThan(30);
    for (const r of writes) {
      const url = r.path.replace(/:accountId/g, account.id).replace(/:[A-Za-z]+/g, "x");
      await request(app)[r.method.toLowerCase()](url).set("Authorization", `Bearer ${token}`)
        .send({ creditRating: forged, corp: { creditRating: forged }, state: { corp: { creditRating: forged } } });
      const now = getAccountById(account.id)?.state?.corp?.creditRating;
      expect(JSON.stringify(now ?? null), `${r.method} ${r.path}`).not.toContain("forged");
    }
    financialSnapshotTick();
    expect(JSON.stringify(corp().creditRating)).toBe(before);
  });
});
